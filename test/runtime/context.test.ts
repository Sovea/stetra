import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { contextInstructions } from '../../src/runtime/context.js';
import { MAX_CONTEXT_BYTES, MAX_INSTRUCTIONS_BYTES, MAX_SELECTION } from '../../src/runtime/context/limits.js';
import type { ContextResult, SessionKey } from '../../src/runtime/context/types.js';
import type { MemoryInput } from '../../src/runtime/knowledge/types.js';
import { Workspace } from '../../src/runtime/workspace.js';

const session: SessionKey = { host: 'codex', sessionId: 'native-session' };
const memory = (changes: Partial<MemoryInput> = {}): MemoryInput => ({ title: 'Cache contract', body: 'Return lookup failures to the caller.', source: 'developer', paths: ['src/cache'], ...changes });
const selected = (context: ContextResult) => context.knowledge.memories.map(item => item.id).sort();

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'stetra context '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workspace: new Workspace(root) };
}

test('an unselected session supplies no knowledge and creates no project state', async t => {
  const { root, workspace } = await fixture(t);
  for (const input of [{}, { session }, { session, reset: true }]) {
    const result = await workspace.context(input);
    assert.deepEqual(result.selection, { ids: [], paths: [] });
    assert.deepEqual(result.knowledge, { memories: [], unavailable: [], issues: [] });
    assert.deepEqual(result.library, { activeCount: 0 });
  }
  assert.deepEqual(await readdir(root), []);
  const created = await workspace.memories.create(memory());
  const fresh = await workspace.context({ session });
  assert.deepEqual(selected(fresh), []);
  assert.deepEqual(fresh.library, { activeCount: 1 });
  const searched = await workspace.context({ query: 'cache' });
  assert.deepEqual(selected(searched), [created.id]);
  assert.equal(searched.library, undefined);
  assert.deepEqual(selected(await workspace.context({ session })), [], 'Stateless retrieval must not attach to another session.');
  await assert.rejects(readFile(join(root, '.stetra/cache/contexts')), { code: 'ENOENT' });
});

test('an empty selection reports available project knowledge without choosing or exposing its bodies', async t => {
  const { root, workspace } = await fixture(t);
  const relevant = await workspace.memories.create(memory());
  const unrelated = await workspace.memories.create(memory({ title: 'Authentication', paths: ['src/auth'], body: 'A rule for another module.' }));
  await workspace.memories.create(memory({ status: 'withdrawn' }));
  const legacy = await workspace.memories.create(memory({ title: 'Former task direction' }));
  const raw = await readFile(legacy.path, 'utf8');
  await writeFile(legacy.path, raw.replace('scope:\n  kind: project', `scope:\n  kind: task\n  taskId: ${randomUUID()}`));
  const invalid = join(root, '.stetra/memory', `${randomUUID()}.md`);
  await writeFile(invalid, 'Missing metadata');

  const context = await workspace.context({ session });
  assert.deepEqual(context.library, { activeCount: 2 });
  assert.deepEqual(context.selection, { ids: [], paths: [] });
  assert.deepEqual(context.knowledge.memories, []);
  assert.ok(context.knowledge.issues.some(issue => issue.path === invalid));
  assert.ok(!JSON.stringify(context).includes(relevant.body));
  assert.ok(!JSON.stringify(context).includes(unrelated.body));
  const state = await readdir(join(root, '.stetra'));
  assert.ok(!state.includes('cache') && !state.includes('index.sqlite'), 'Discovery must not create a selection or a search index.');

  await workspace.memories.delete(relevant.id, relevant.revision);
  assert.deepEqual((await workspace.context()).library, { activeCount: 1 });
  const selectedContext = await workspace.context({ session, ids: [unrelated.id] });
  assert.equal(selectedContext.library, undefined);
  assert.equal((await workspace.context({ session })).library, undefined, 'Refresh remains limited to the existing selection.');
});

test('query and paths select matching knowledge without widening later refreshes', async t => {
  const { root, workspace } = await fixture(t);
  const relevant = await workspace.memories.create(memory());
  const unrelated = await workspace.memories.create(memory({ title: 'Retry policy', body: 'Attempt twice before reporting failure.' }));
  await workspace.memories.create(memory({ title: 'Cache display', paths: ['src/cache-tools'] }));
  const first = await workspace.context({ session, query: 'contract', paths: ['src/cache/client.ts'] });
  assert.deepEqual(selected(first), [relevant.id]);
  const newer = await workspace.memories.create(memory({ title: 'Cache freshness contract' }));
  assert.deepEqual(selected(await new Workspace(root).context({ session })), [relevant.id], 'Refreshing a selection must not silently expand it.');
  const replaced = await workspace.context({ session, paths: ['src/cache/client.ts'] });
  assert.deepEqual(selected(replaced), [relevant.id, unrelated.id, newer.id].sort());
  const narrower = await workspace.context({ session, ids: [unrelated.id] });
  assert.deepEqual(selected(narrower), [unrelated.id]);
  assert.deepEqual(narrower.changes.map(change => [change.id, change.kind]).sort(), [[relevant.id, 'unselected'], [newer.id, 'unselected']].sort());
  assert.deepEqual(narrower.selection.paths, []);
  assert.deepEqual(selected(await workspace.context({ session: { ...session, host: 'claude' } })), []);
  assert.deepEqual(selected(await workspace.context({ session: { ...session, sessionId: 'another' } })), []);
  assert.deepEqual(selected(await workspace.context({ session, reset: true })), []);
  assert.deepEqual(selected(await workspace.context({ session })), []);
});

test('refresh returns current revisions and stops supplying withdrawn or deleted knowledge', async t => {
  const { root, workspace } = await fixture(t);
  const first = await workspace.memories.create(memory());
  await workspace.context({ session, ids: [first.id] });
  const revised = await workspace.memories.update(first.id, first.revision, memory({ body: 'A cache miss is empty; a failed lookup still rejects.' }));
  const refreshed = await new Workspace(root).context({ session });
  assert.equal(refreshed.knowledge.memories[0]?.body, revised.body);
  assert.deepEqual(refreshed.changes, [{ id: first.id, kind: 'updated', previousRevision: first.revision, revision: revised.revision }]);
  assert.deepEqual((await workspace.context({ session })).changes, []);
  const withdrawn = await workspace.memories.update(first.id, revised.revision, memory({ status: 'withdrawn' }));
  const inactive = await workspace.context({ session });
  assert.deepEqual(selected(inactive), []);
  assert.equal(inactive.changes[0]?.kind, 'unavailable');
  assert.match(inactive.knowledge.unavailable[0]!.reason, /withdrawn/);
  await workspace.memories.delete(withdrawn.id, withdrawn.revision);
  const removed = await workspace.context({ session });
  assert.deepEqual(selected(removed), []);
  assert.equal(removed.knowledge.unavailable[0]?.id, first.id);
});

test('session caches contain selection and supplied-body revisions without query text or knowledge content', async t => {
  const { root, workspace } = await fixture(t);
  const item = await workspace.memories.create(memory({ title: 'Private concern', body: 'Sensitive engineering explanation.' }));
  await workspace.context({ session, query: 'Private concern', paths: ['src/cache/client.ts'] });
  const directory = join(root, '.stetra/cache/contexts');
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const raw = await readFile(join(directory, files[0]!), 'utf8');
  assert.deepEqual(JSON.parse(raw), { schemaVersion: 1, selection: { ids: [item.id], paths: ['src/cache/client.ts'] }, provided: { [item.id]: item.revision } });
  assert.doesNotMatch(raw, /native-session|Private concern|Sensitive engineering explanation/);
  assert.match(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), /^\/cache\/$/m);
});

test('explicit IDs and query results are capped before recall validation', async t => {
  const { workspace } = await fixture(t);
  const item = await workspace.memories.create(memory());
  const ids = Array.from({ length: MAX_SELECTION }, () => randomUUID());
  const result = await workspace.context({ ids, query: 'cache' });
  assert.deepEqual(result.selection.ids, ids);
  assert.ok(!selected(result).includes(item.id));
  assert.ok(result.omittedCount >= 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_CONTEXT_BYTES);
});

test('large records are omitted whole and do not advance the last supplied body revision', async t => {
  const { workspace } = await fixture(t);
  const first = await workspace.memories.create(memory());
  await workspace.context({ session, ids: [first.id] });
  const revised = await workspace.memories.update(first.id, first.revision, memory({ body: '完整正文。'.repeat(2_000) }));
  for (let i = 0; i < 2; i++) {
    const context = await workspace.context({ session });
    assert.deepEqual(context.knowledge.memories, []);
    assert.deepEqual(context.omitted, [{ id: first.id, title: revised.title, revision: revised.revision }]);
    assert.equal(context.omittedCount, 1);
    assert.deepEqual(context.changes, [{ id: first.id, kind: 'updated', previousRevision: first.revision, revision: revised.revision }]);
    assert.ok(Buffer.byteLength(JSON.stringify(context)) <= MAX_CONTEXT_BYTES);
  }
  assert.equal((await workspace.memories.get(first.id)).body, revised.body, 'An omitted body remains fully inspectable through memory read.');
  const small = await workspace.memories.update(first.id, revised.revision, memory({ body: 'Revised concise understanding.' }));
  assert.equal((await workspace.context({ session })).knowledge.memories[0]?.revision, small.revision);
  assert.deepEqual((await workspace.context({ session })).changes, []);
});

test('instruction budgets include long installation paths and preserve complete JSON and memory bodies', async t => {
  const { root } = await fixture(t);
  const nested = join(root, ...Array.from({ length: 10 }, (_, i) => `${i}-${'a'.repeat(150)}`));
  await mkdir(nested, { recursive: true });
  const workspace = new Workspace(nested);
  const item = await workspace.memories.create(memory({ body: '知识。'.repeat(1_000) }));
  const cli = join(nested, '.stetra/runtime/cli.js');
  const { text } = await contextInstructions(nested, cli, session, { ids: [item.id] });
  assert.ok(Buffer.byteLength(text) <= MAX_INSTRUCTIONS_BYTES);
  const result = JSON.parse(text.split('\n').at(-1)!) as ContextResult;
  assert.deepEqual(result.selection.ids, [item.id]);
  assert.deepEqual(result.knowledge.memories, []);
  assert.equal(result.omitted[0]?.id, item.id);
});
