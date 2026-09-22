import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { stringify } from 'yaml';
import { MemoryStore } from '../../src/runtime/knowledge/store.js';
import { type MemoryInput, type MemorySearchOptions, type MemoryRecallOptions, type MemorySearchResult } from '../../src/runtime/knowledge/types.js';
import { StetraError } from '../../src/runtime/shared.js';

function input(changes: Partial<MemoryInput> = {}): MemoryInput {
  return { title: 'Failure behavior', body: 'Keep cache failures visible to callers.', source: 'developer', scope: { kind: 'project' }, ...changes };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'stetra knowledge '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new MemoryStore(root), index: join(root, '.stetra/index.sqlite') };
}

function ids(result: MemorySearchResult): string[] { return result.matches.map(match => match.memory.id).sort(); }
function hasCode(code: string) { return (error: unknown) => error instanceof StetraError && error.code === code; }

async function legacyMemory(root: string, changes: Partial<MemoryInput> = {}) {
  const id = randomUUID();
  const { body, ...metadata } = input(changes);
  const directory = join(root, '.stetra/memory');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.md`), `---\n${stringify({ id, ...metadata, scope: { kind: 'task', taskId: randomUUID() } })}---\n${body}\n`);
  return new MemoryStore(root).get(id);
}

async function runWorkers(t: TestContext, inputs: string[][]): Promise<string[]> {
  const workers = inputs.map(args => {
    const child = fork(new URL('./knowledge-worker.ts', import.meta.url), args, { execArgv: ['--import', 'tsx'], silent: true });
    let diagnostics = '';
    child.stderr?.on('data', data => { diagnostics += String(data); });
    let readyReceived = false;
    let resultReceived = false;
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', message => { if ((message as { ready?: boolean }).ready) { readyReceived = true; resolve(); } });
      child.once('error', reject);
      child.once('close', (code, signal) => { if (!readyReceived) reject(new Error(`Worker closed before ready (${code}, ${signal}): ${diagnostics}`)); });
    });
    const result = new Promise<string>((resolve, reject) => {
      child.on('message', message => {
        const value = (message as { result?: string }).result;
        if (value) { resultReceived = true; resolve(value); }
      });
      child.once('error', reject);
      child.once('close', (code, signal) => { if (!resultReceived) reject(new Error(`Worker closed before result (${code}, ${signal}): ${diagnostics}`)); });
    });
    const closed = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code !== 0 || signal !== null) reject(new Error(`Worker failed (${code}, ${signal}): ${diagnostics}`));
        else resolve();
      });
    });
    // Errors may arrive while waiting for the other worker's readiness.
    void ready.catch(() => {});
    void result.catch(() => {});
    void closed.catch(() => {});
    return { child, ready, result, closed };
  });
  const stop = () => { for (const { child } of workers) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  t.signal.addEventListener('abort', stop, { once: true });
  try {
    await Promise.all(workers.map(worker => worker.ready));
    for (const { child } of workers) child.send({ start: true });
    const results = await Promise.all(workers.map(worker => worker.result));
    await Promise.all(workers.map(worker => worker.closed));
    return results;
  } finally {
    stop();
    await Promise.allSettled(workers.map(worker => worker.closed));
    t.signal.removeEventListener('abort', stop);
  }
}

test('knowledge reads stay non-mutating in an empty project and old inputs receive metadata defaults', async t => {
  const { root, store } = await fixture(t);
  const missing = randomUUID();
  assert.deepEqual(await store.list(), { memories: [], issues: [] });
  await assert.rejects(store.get(missing), hasCode('not_found'));
  assert.deepEqual(await store.search({ query: 'cache' }), { matches: [], issues: [] });
  assert.deepEqual(await store.recall(), { memories: [], unavailable: [], issues: [] });
  const unavailable = await store.recall({ ids: [missing] });
  assert.equal(unavailable.unavailable[0]?.id, missing);
  assert.deepEqual(await readdir(root), []);
  const { scope: _scope, ...withoutScope } = input();
  const memory = await store.create(withoutScope);
  assert.deepEqual(memory.scope, { kind: 'project' });
  assert.equal(memory.kind, 'observation');
  assert.equal(memory.applicability, '');
  assert.deepEqual(memory.paths, []);
  assert.equal(memory.status, 'active');
  assert.deepEqual(memory.references, []);
  assert.deepEqual((await store.recall()).memories, [], 'A general project read must not inject every knowledge body.');
  const selected = await store.recall({ ids: [memory.id] });
  assert.deepEqual(selected.memories, [memory]);
});

test('English retrieval uses real FTS5 token matching and weighted ranking', async t => {
  const { store, index } = await fixture(t);
  const titleHit = await store.create(input({ title: 'Cache', body: 'Preserve failure behavior for existing callers.' }));
  const bodyHit = await store.create(input({ title: 'Failure policy', body: 'The cache must preserve failure behavior for existing callers.' }));
  const partialHit = await store.create(input({ title: 'Cacheable values', body: 'Cacheable successful responses can be reused.' }));
  const result = await store.search({ query: 'cache' });
  assert.deepEqual(ids(result), [titleHit.id, bodyHit.id, partialHit.id].sort());
  assert.equal(result.matches[0]?.memory.id, titleHit.id, 'A direct title match should rank before a body-only match.');
  assert.equal(result.matches[2]?.memory.id, partialHit.id, 'Token matches should precede substring-only matches.');
  assert.equal('body' in result.matches[0]!.memory, false, 'Search results use summaries and bounded snippets.');
  assert.match(result.matches[0]!.snippet, /failure behavior/);
  assert.deepEqual(ids(await store.search({ query: 'cache failure', limit: 1 })), [titleHit.id]);
  assert.deepEqual((await store.search({ query: '" NEVERMATCH OR *' })).matches, [], 'User input must not become an FTS expression.');
  const database = new DatabaseSync(index, { readOnly: true });
  try {
    const table = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'knowledge_fts'").get();
    assert.match(String(table?.sql), /USING fts5/i);
  } finally { database.close(); }
});

test('Unicode substring retrieval handles unsegmented text and single characters without language detection', async t => {
  const { store } = await fixture(t);
  const chinese = await store.create(input({ title: '调用行为', body: '网络查询失败必须保留错误，不能当作空结果。', applicability: '适用于现有查询调用方。' }));
  await store.create(input({ title: '另一条知识', body: '新的接口允许缓存空结果。' }));
  for (const query of ['查询', '错误', '调用方', '错']) {
    const result = await store.search({ query });
    assert.deepEqual(ids(result), [chinese.id]);
    assert.match(result.matches[0]!.snippet, /网络查询失败/);
  }
  const japanese = await store.create(input({ title: '通信', body: 'ネットワークが失敗したら再試行する。' }));
  assert.deepEqual(ids(await store.search({ query: 'ネット' })), [japanese.id]);
  assert.deepEqual(ids(await store.search({ query: '再' })), [japanese.id]);
  assert.deepEqual(ids(await store.search({ query: '再 失敗' })), [japanese.id]);
  assert.deepEqual((await store.search({ query: '再 unknown' })).matches, []);
});

test('search excludes legacy task scopes and filters status and directory boundaries before its result limit', async t => {
  const { root, store } = await fixture(t);
  const project = await store.create(input());
  const scoped = await store.create(input({ paths: ['src/cache'] }));
  await store.create(input({ paths: ['src/cache-tools'] }));
  const legacy = await legacyMemory(root);
  await legacyMemory(root);
  const withdrawn = await store.create(input({ status: 'withdrawn' }));
  assert.equal((await store.search({ query: 'cache' })).matches.length, 3);
  assert.deepEqual(ids(await store.search({ query: 'cache', paths: ['src/cache/client.ts'] })), [project.id, scoped.id].sort());
  assert.equal((await store.search({ query: 'cache', paths: ['src/cache/client.ts'], limit: 1 })).matches.length, 1);
  const all = await store.search({ query: 'cache', allScopes: true, includeWithdrawn: true });
  assert.equal(all.matches.length, 6);
  assert.ok(ids(all).includes(withdrawn.id));
  assert.ok(ids(all).includes(legacy.id));
});

test('focused recall uses only matching paths and explicit IDs without reviving legacy or withdrawn knowledge', async t => {
  const { root, store } = await fixture(t);
  const project = await store.create(input());
  const path = await store.create(input({ paths: ['src/cache'] }));
  const wrongPath = await store.create(input({ paths: ['src/storage'] }));
  const legacy = await legacyMemory(root, { paths: ['src/cache'] });
  const withdrawn = await store.create(input({ status: 'withdrawn', paths: ['src/cache'] }));
  assert.deepEqual((await store.recall()).memories, []);
  assert.deepEqual((await store.recall({ paths: ['src/cache/client.ts'] })).memories.map(memory => memory.id), [path.id]);
  const missing = randomUUID();
  const result = await store.recall({ paths: ['src/cache/client.ts'], ids: [project.id, path.id, wrongPath.id, legacy.id, withdrawn.id, missing] });
  assert.deepEqual(result.memories.map(memory => memory.id).sort(), [project.id, path.id].sort());
  assert.deepEqual(result.unavailable.map(item => item.id).sort(), [wrongPath.id, legacy.id, withdrawn.id, missing].sort());
  assert.match(result.unavailable.find(item => item.id === legacy.id)!.reason, /Legacy task-scoped/);
  assert.ok(result.unavailable.every(item => item.reason.length > 0));
  assert.equal(new Set(result.memories.map(memory => memory.id)).size, result.memories.length);
});

test('legacy task knowledge remains inspectable and deletable without an implicit project-scope upgrade', async t => {
  const { root, store } = await fixture(t);
  const legacy = await legacyMemory(root, { paths: ['src/cache'], applicability: 'Only the earlier experiment.' });
  const original = await readFile(legacy.path, 'utf8');
  assert.equal(legacy.scope.kind, 'task');
  assert.deepEqual((await store.list()).memories, []);
  assert.deepEqual((await store.list({ allScopes: true })).memories.map(memory => memory.id), [legacy.id]);
  assert.equal((await store.get(legacy.id)).applicability, 'Only the earlier experiment.');
  assert.deepEqual((await store.recall({ paths: ['src/cache/file.ts'] })).memories, []);
  await assert.rejects(store.create({ ...input(), scope: legacy.scope } as unknown as MemoryInput), hasCode('invalid'));
  await assert.rejects(store.update(legacy.id, legacy.revision, input()), hasCode('invalid'));
  const { scope: _scope, ...withoutScope } = input();
  await assert.rejects(store.update(legacy.id, legacy.revision, withoutScope), hasCode('invalid'));
  assert.equal(await readFile(legacy.path, 'utf8'), original);
  const taskId = legacy.scope.kind === 'task' ? legacy.scope.taskId : randomUUID();
  await assert.rejects(store.search({ query: 'cache', taskId } as MemorySearchOptions), hasCode('invalid'));
  await assert.rejects(store.recall({ taskId } as MemoryRecallOptions), hasCode('invalid'));
  await assert.rejects(store.delete(legacy.id, '0'.repeat(64)), hasCode('conflict'));
  await store.delete(legacy.id, legacy.revision);
  assert.deepEqual((await store.list({ allScopes: true })).memories, []);
  await assert.rejects(store.update(legacy.id, legacy.revision, input()), hasCode('not_found'));
  assert.ok(!(await readdir(join(root, '.stetra'))).includes('state.sqlite'));
});

test('external edits, deletion, Git restoration, and malformed files cannot leave stale indexed knowledge', async t => {
  const { store } = await fixture(t);
  const memory = await store.create(input({ body: 'Use alpha behavior.' }));
  const original = await readFile(memory.path, 'utf8');
  assert.deepEqual(ids(await store.search({ query: 'alpha' })), [memory.id]);
  await writeFile(memory.path, original.replace('Use alpha behavior.', 'Use beta behavior.'));
  assert.deepEqual((await store.search({ query: 'alpha' })).matches, []);
  const updated = await store.search({ query: 'beta' });
  assert.deepEqual(ids(updated), [memory.id]);
  assert.notEqual(updated.matches[0]!.memory.revision, memory.revision);
  assert.equal((await store.recall({ ids: [memory.id] })).memories[0]?.body, 'Use beta behavior.');
  await assert.rejects(store.update(memory.id, memory.revision, input()), hasCode('conflict'));
  await unlink(memory.path);
  assert.deepEqual((await store.search({ query: 'beta' })).matches, []);
  assert.equal((await store.recall({ ids: [memory.id] })).unavailable[0]?.id, memory.id);
  await assert.rejects(store.update(memory.id, updated.matches[0]!.memory.revision, input()), hasCode('not_found'));
  await writeFile(memory.path, original);
  assert.deepEqual(ids(await store.search({ query: 'alpha' })), [memory.id], 'Restoring a valid authoritative file should rebuild its search entry.');
  await writeFile(memory.path, 'This is no longer a valid knowledge file.\n');
  const invalid = await store.search({ query: 'alpha' });
  assert.deepEqual(invalid.matches, []);
  assert.equal(invalid.issues[0]?.path, memory.path);
  assert.equal((await store.recall({ ids: [memory.id] })).unavailable[0]?.id, memory.id);
});

test('oversized external knowledge is reported without blocking retrieval of valid files', async t => {
  const { store, root } = await fixture(t);
  const valid = await store.create(input());
  const oversizedId = randomUUID();
  const oversizedPath = join(root, '.stetra/memory', `${oversizedId}.md`);
  await writeFile(oversizedPath, Buffer.alloc(2 * 1_048_576 + 1, 'x'));
  const result = await store.search({ query: 'cache' });
  assert.deepEqual(ids(result), [valid.id]);
  assert.equal(result.issues[0]?.path, oversizedPath);
  assert.match(result.issues[0]!.message, /2 MiB/);
  await assert.rejects(store.get(oversizedId), hasCode('invalid'));
  const recall = await store.recall({ ids: [valid.id, oversizedId] });
  assert.deepEqual(recall.memories.map(memory => memory.id), [valid.id]);
  assert.equal(recall.unavailable[0]?.id, oversizedId);
});

test('missing, corrupt, and incompatible derived indexes rebuild without modifying Markdown', async t => {
  const { root, store, index } = await fixture(t);
  const memory = await store.create(input());
  const original = await readFile(memory.path, 'utf8');
  await store.search({ query: 'cache' });
  await unlink(index);
  assert.deepEqual(ids(await new MemoryStore(root).search({ query: 'cache' })), [memory.id]);
  await writeFile(index, 'An interrupted or obsolete index is disposable.');
  assert.deepEqual(ids(await store.search({ query: 'cache' })), [memory.id]);
  const database = new DatabaseSync(index);
  database.exec('PRAGMA user_version = 999');
  database.close();
  assert.deepEqual(ids(await store.search({ query: 'cache' })), [memory.id]);
  const damaged = new DatabaseSync(index);
  damaged.exec('DROP TABLE knowledge_fts');
  damaged.close();
  assert.deepEqual(ids(await store.search({ query: 'cache' })), [memory.id], 'A missing FTS table must be rebuilt even when the SQLite file still opens.');
  assert.equal(await readFile(memory.path, 'utf8'), original);
  await store.delete(memory.id, memory.revision);
  await assert.rejects(readFile(index), { code: 'ENOENT' }, 'Deleting current knowledge must also discard its derived index.');
  assert.deepEqual((await store.search({ query: 'cache' })).matches, []);
  await assert.rejects(store.update(memory.id, memory.revision, input()), hasCode('not_found'));
});

test('knowledge path scopes and index files cannot traverse or follow symlinks', async t => {
  const { root, store, index } = await fixture(t);
  for (const path of ['/tmp/project', '../private', 'src/../private', 'C:\\private', '\\\\server\\share', 'src/**', '.']) {
    await assert.rejects(store.create(input({ paths: [path] })), hasCode('invalid'));
    await assert.rejects(store.search({ query: 'cache', paths: [path] }), hasCode('invalid'));
  }
  const memory = await store.create(input({ kind: 'constraint', applicability: 'Existing callers require rejected failures.', paths: ['./src\\cache/'] }));
  assert.deepEqual(memory.paths, ['src/cache']);
  assert.equal((await store.get(memory.id)).kind, 'constraint');
  const outside = join(root, 'unrelated.txt');
  await writeFile(outside, 'Unrelated developer content.');
  await symlink(outside, index);
  await assert.rejects(store.search({ query: 'cache' }), hasCode('storage'));
  assert.equal(await readFile(outside, 'utf8'), 'Unrelated developer content.');
});

test('search and index invalidation share the knowledge lock across processes', { timeout: 15_000 }, async t => {
  const { root, store } = await fixture(t);
  const memory = await store.create(input());
  await store.search({ query: 'cache' });
  assert.deepEqual(await runWorkers(t, [['index-read', root, memory.id], ['index-write', root, memory.id]]), ['done', 'done']);
  assert.deepEqual((await store.search({ query: 'cache' })).matches, []);
  await assert.rejects(store.update(memory.id, memory.revision, input()), hasCode('not_found'));
});

test('knowledge persists across instances and withdrawal, restoration, and deletion require current revisions', async t => {
  const { root, store } = await fixture(t);
  const current = await store.create(input());
  const reopened = new MemoryStore(root);
  assert.deepEqual(await reopened.get(current.id), current);
  const withdrawn = await store.update(current.id, current.revision, input({ status: 'withdrawn' }));
  assert.deepEqual((await reopened.list()).memories, []);
  assert.deepEqual((await reopened.list({ includeWithdrawn: true })).memories.map(memory => memory.id), [current.id]);
  assert.deepEqual((await reopened.recall({ ids: [current.id] })).memories, []);
  assert.equal((await reopened.get(current.id)).status, 'withdrawn');
  await assert.rejects(reopened.delete(current.id, current.revision), hasCode('conflict'));
  const restored = await reopened.update(current.id, withdrawn.revision, input());
  assert.equal((await store.list()).memories[0]?.revision, restored.revision);
  await store.delete(current.id, restored.revision);
  await assert.rejects(reopened.get(current.id), hasCode('not_found'));
  await assert.rejects(reopened.update(current.id, restored.revision, input()), hasCode('not_found'));
});

test('malformed metadata and filenames are reported while valid knowledge remains available', async t => {
  const { root, store } = await fixture(t);
  const valid = await store.create(input());
  const directory = join(root, '.stetra/memory');
  await writeFile(join(directory, `${randomUUID()}.md`), 'Missing frontmatter');
  await writeFile(join(directory, 'not-a-uuid.md'), 'Invalid name');
  await writeFile(join(directory, `${randomUUID()}.md`), await readFile(valid.path, 'utf8'));
  const duplicateId = randomUUID();
  await writeFile(join(directory, `${duplicateId}.md`), `---\nid: ${duplicateId}\nid: ${duplicateId}\n---\nInvalid duplicate YAML keys`);
  const listed = await store.list();
  assert.deepEqual(listed.memories.map(memory => memory.id), [valid.id]);
  assert.equal(listed.issues.length, 4);
  assert.ok(listed.issues.every(issue => issue.path.startsWith(directory) && issue.message.length > 0));
  await assert.rejects(store.get('../outside'), hasCode('invalid'));
});

test('knowledge refuses linked files and directories and preserves a user-maintained gitignore', async t => {
  const { root, store } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'stetra outside knowledge '));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, '.stetra'));
  await assert.rejects(store.list(), hasCode('storage'));
  await assert.rejects(store.create(input()), hasCode('storage'));
  await rm(join(root, '.stetra'));
  await mkdir(join(root, '.stetra'));
  await writeFile(join(root, '.stetra/.gitignore'), '# User maintained\n');
  await symlink(outside, join(root, '.stetra/memory'));
  await assert.rejects(store.list(), hasCode('storage'));
  await rm(join(root, '.stetra/memory'));
  await store.create(input());
  const linkedId = randomUUID();
  const target = join(outside, 'external.md');
  await writeFile(target, 'External content');
  await symlink(target, join(root, '.stetra/memory', `${linkedId}.md`));
  await assert.rejects(store.get(linkedId), hasCode('invalid'));
  assert.equal((await store.list()).issues.length, 1);
  assert.equal(await readFile(target, 'utf8'), 'External content');
  assert.equal(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), '# User maintained\n');
});

test('two real processes cannot overwrite the same knowledge revision', { timeout: 15_000 }, async t => {
  const { root, store } = await fixture(t);
  const current = await store.create(input());
  const result = await runWorkers(t, ['First writer', 'Second writer'].map(title => ['cas', root, current.id, current.revision, title]));
  assert.deepEqual(result.sort(), ['conflict', 'updated']);
  assert.notEqual((await store.get(current.id)).revision, current.revision);
  assert.equal((await store.list()).issues.length, 0);
});
