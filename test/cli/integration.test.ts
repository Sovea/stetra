import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Memory, MemoryInput } from '../../src/runtime/knowledge/types.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
type Context = {
  projectRoot: string;
  knowledge: { memories: Memory[]; unavailable: { id: string; reason: string }[]; issues: unknown[] };
  changes: { id: string; kind: 'updated' | 'unavailable' | 'unselected'; previousRevision: string; revision?: string }[];
  selection: { ids: string[]; paths: string[] };
  omitted: { id: string; title: string; revision: string }[];
  omittedCount: number;
};

function runCli(args: string[], input?: unknown): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    cwd: repository, encoding: 'utf8', timeout: 5_000,
    input: input === undefined ? undefined : JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `CLI terminated unexpectedly: ${result.stderr}`);
  return result;
}
function successful<T>(args: string[], input?: unknown): T {
  const result = runCli(args, input);
  assert.equal(result.status, 0, `CLI failed: ${args.join(' ')}\n${result.stderr}`);
  return JSON.parse(result.stdout) as T;
}
function memoryCall<T>(root: string, request: unknown): T {
  return successful<T>(['call', 'memory', '--input', '-', '--project', root], request);
}
function context(root: string, args: string[] = []): Context {
  return successful<Context>(['context', '--project', root, ...args]);
}
function inputOf(memory: Memory, changes: Partial<MemoryInput> = {}): MemoryInput {
  if (memory.scope.kind !== 'project') throw new Error('This fixture helper only updates current project knowledge.');
  return { title: memory.title, body: memory.body, source: memory.source, scope: memory.scope,
    kind: memory.kind, applicability: memory.applicability, paths: memory.paths,
    status: memory.status, references: memory.references, ...changes };
}
function errorCode(result: SpawnSyncReturns<string>): string {
  assert.notEqual(result.status, 0, 'An invalid or conflicting request must fail.');
  assert.equal(result.stdout, '', 'Failed writes must not print a successful result.');
  const diagnostic = result.stderr.trim().split('\n').findLast(line => line.startsWith('{'));
  assert.ok(diagnostic, `Expected a structured CLI error: ${result.stderr}`);
  return (JSON.parse(diagnostic) as { error: { code: string } }).error.code;
}

// Session identities here are explicit test inputs, not claims about native Host discovery.
test('independent CLI processes select knowledge, refresh corrections, and stop supplying withdrawn or deleted bodies', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'stetra knowledge flow '));
  try {
    const memory = memoryCall<Memory>(root, { action: 'create', memory: {
      title: 'Cache failure behavior', body: 'Keep query failures visible to the caller.', source: 'developer',
      kind: 'constraint', applicability: 'When changing the cache query in this module.', paths: ['src/cache.ts'],
    } });
    assert.deepEqual(memory.scope, { kind: 'project' }, 'New knowledge defaults to project storage scope.');
    const session = ['--host', 'codex', '--session', 'fixture-cache-session'];
    assert.deepEqual(context(root, session).knowledge.memories, [], 'A fresh session does not load the whole library.');
    const selected = context(root, [...session, '--query', 'cache failure', '--path', 'src/cache.ts']);
    assert.deepEqual(selected.selection.ids, [memory.id]);
    assert.equal(selected.knowledge.memories[0]?.body, memory.body);
    assert.equal(selected.knowledge.memories[0]?.revision, memory.revision);

    const corrected = memoryCall<Memory>(root, { action: 'update', memoryId: memory.id, expectedRevision: memory.revision,
      memory: inputOf(memory, { title: 'Preserve upstream rejection', body: 'Propagate the original error; cache only successful results.' }),
    });
    const refreshed = context(root, session);
    assert.equal(refreshed.knowledge.memories[0]?.body, corrected.body, 'Refresh rereads the selected ID even after its search terms change.');
    assert.equal(refreshed.knowledge.memories[0]?.revision, corrected.revision);
    assert.deepEqual(refreshed.changes.find(change => change.id === memory.id), {
      id: memory.id, kind: 'updated', previousRevision: memory.revision, revision: corrected.revision,
    });
    assert.equal(errorCode(runCli(['call', 'memory', '--input', '-', '--project', root], {
      action: 'update', memoryId: memory.id, expectedRevision: memory.revision, memory: inputOf(memory),
    })), 'conflict');

    const withdrawn = memoryCall<Memory>(root, { action: 'update', memoryId: memory.id, expectedRevision: corrected.revision,
      memory: inputOf(corrected, { status: 'withdrawn' }),
    });
    const afterWithdrawal = context(root, session);
    assert.deepEqual(afterWithdrawal.knowledge.memories, []);
    assert.ok(afterWithdrawal.knowledge.unavailable.some(item => item.id === memory.id));
    assert.ok(!JSON.stringify(afterWithdrawal).includes(corrected.body));
    const inspected = memoryCall<Memory>(root, { action: 'read', memoryId: memory.id });
    assert.equal(inspected.status, 'withdrawn', 'Explicit management reads remain available.');
    assert.equal(inspected.kind, 'constraint');
    assert.deepEqual(inspected.paths, ['src/cache.ts']);
    memoryCall(root, { action: 'delete', memoryId: memory.id, expectedRevision: withdrawn.revision });
    const afterDeletion = context(root, session);
    assert.deepEqual(afterDeletion.knowledge.memories, []);
    assert.ok(!JSON.stringify(afterDeletion).includes(corrected.body));
    assert.equal(errorCode(runCli(['call', 'memory', '--input', '-', '--project', root], {
      action: 'update', memoryId: memory.id, expectedRevision: withdrawn.revision, memory: inputOf(corrected),
    })), 'not_found', 'A stale update cannot recreate deleted knowledge.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session selection is isolated, replaceable, resettable, and refreshed after a direct Markdown correction', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'stetra selected knowledge '));
  try {
    const cache = memoryCall<Memory>(root, { action: 'create', memory: {
      title: 'Cache constraint', body: 'Keep upstream failures visible.', source: 'developer', paths: ['src/cache'],
    } });
    const auth = memoryCall<Memory>(root, { action: 'create', memory: {
      title: 'Authentication constraint', body: 'Do not reuse expired credentials.', source: 'developer', paths: ['src/auth'],
    } });
    const first = ['--host', 'codex', '--session', 'same-id'];
    assert.equal(context(root, [...first, '--path', 'src/cache/query.ts']).knowledge.memories[0]?.id, cache.id);
    assert.deepEqual(context(root, ['--host', 'codex', '--session', 'other-id']).knowledge.memories, []);
    assert.deepEqual(context(root, ['--host', 'claude', '--session', 'same-id']).knowledge.memories, []);
    const explicitOutsidePath = context(root, ['--path', 'src/cache/query.ts', '--memory', auth.id]);
    assert.ok(!explicitOutsidePath.knowledge.memories.some(item => item.id === auth.id), 'Explicit IDs do not override a path conflict.');

    const externalBody = 'Keep upstream rejection visible and retain its original cause.';
    await writeFile(cache.path, (await readFile(cache.path, 'utf8')).replace(cache.body, externalBody));
    const refreshed = context(root, first);
    assert.equal(refreshed.knowledge.memories[0]?.body, externalBody);
    assert.ok(refreshed.changes.some(change => change.id === cache.id && change.kind === 'updated'));
    const replaced = context(root, [...first, '--query', 'authentication', '--path', 'src/auth/client.ts']);
    assert.deepEqual(replaced.selection.ids, [auth.id]);
    assert.equal(replaced.knowledge.memories[0]?.id, auth.id);
    assert.ok(replaced.changes.some(change => change.id === cache.id && change.kind === 'unselected'));
    const reset = context(root, [...first, '--reset']);
    assert.deepEqual(reset.selection.ids, []);
    assert.deepEqual(reset.knowledge.memories, []);
    assert.deepEqual(context(root, first).knowledge.memories, []);
    const reselected = context(root, [...first, '--reset', '--memory', cache.id]);
    assert.equal(reselected.knowledge.memories[0]?.body, externalBody);
    assert.deepEqual(reselected.selection.paths, [], 'New selection does not retain the prior path restriction.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generic retrieval needs no session, setup, or task record and ignores the legacy task database', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'stetra stateless knowledge '));
  try {
    const inputPath = join(root, 'memory request.json');
    await writeFile(inputPath, JSON.stringify({ action: 'create', memory: { title: 'Cache failure', body: 'A failure must remain distinguishable from an empty success.', source: 'developer', paths: ['src/query.ts'] } }));
    const memory = successful<Memory>(['call', 'memory', '--input', inputPath, '--project', root]);
    const legacyDatabase = join(root, '.stetra/state.sqlite');
    const legacyBytes = 'This legacy file is deliberately not a valid SQLite database.';
    await writeFile(legacyDatabase, legacyBytes);
    const selected = context(root, ['--query', 'cache failure', '--path', 'src/query.ts']);
    assert.equal(selected.knowledge.memories[0]?.id, memory.id);
    assert.deepEqual(context(root).knowledge.memories, [], 'A stateless retrieval does not become the next call’s selection.');
    assert.ok(!('tasks' in selected) && !('current' in selected));
    const files = await readdir(join(root, '.stetra'));
    assert.ok(!files.includes('cache'), 'Stateless context must not persist a session selection.');
    assert.ok(!files.includes('installation.json'));
    assert.equal(await readFile(legacyDatabase, 'utf8'), legacyBytes);
    const instructions = successful<{ text: string }>(['context', '--instructions', '--project', root, '--memory', memory.id]);
    assert.ok(instructions.text.includes(memory.body));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('focused schemas and removed APIs do not initialize project state', { timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'stetra memory schema '));
  try {
    const schema = successful<Record<string, unknown>>(['schema', 'memory', '--project', root]);
    assert.equal(typeof schema.$schema, 'string');
    const variants = (schema.oneOf ?? schema.anyOf) as { properties: { action: { const: string } } }[];
    assert.deepEqual(variants.map(item => item.properties.action.const).sort(), ['create', 'delete', 'list', 'read', 'recall', 'search', 'update']);
    const update = successful<{ properties: { action: { const: string }; expectedRevision: unknown }; required: string[] }>(['schema', 'memory', '--action', 'update', '--project', root]);
    assert.equal(update.properties.action.const, 'update');
    assert.ok(update.required.includes('expectedRevision'));
    for (const domain of ['task', 'entry', 'feedback', 'session', 'source']) {
      assert.notEqual(runCli(['schema', domain, '--project', root]).status, 0);
      assert.notEqual(runCli(['call', domain, '--input', '-', '--project', root], { action: 'create' }).status, 0);
    }
    for (const command of ['view', 'mcp']) assert.notEqual(runCli([command, '--project', root]).status, 0);
    assert.notEqual(runCli(['context', '--task', '00000000-0000-4000-8000-000000000000', '--project', root]).status, 0);
    assert.notEqual(runCli(['context', '--pending', '--project', root]).status, 0);
    assert.equal(errorCode(runCli(['context', '--reset', '--project', root])), 'invalid');
    assert.notEqual(runCli(['schema', 'memory', '--action', 'answer', '--project', root]).status, 0);
    assert.equal(errorCode(runCli(['call', 'memory', '--input', '-', '--project', root], { action: 'create', memory: { title: 'Incomplete' } })), 'invalid');
    assert.equal(errorCode(runCli(['call', 'memory', '--input', '-', '--project', root], { action: 'search', query: 'cache', taskId: '00000000-0000-4000-8000-000000000000' })), 'invalid');
    assert.deepEqual(await readdir(root), [], 'Removed commands and malformed requests must not create files.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy task knowledge stays inspectable but cannot be injected or promoted by a write', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'stetra legacy knowledge '));
  try {
    const created = memoryCall<Memory>(root, { action: 'create', memory: {
      title: 'Legacy cache guidance', body: 'This guidance belonged to a retired task.', source: 'agent', paths: ['src/cache.ts'],
    } });
    const prior = await readFile(created.path, 'utf8');
    const legacyFile = prior.replace('scope:\n  kind: project', 'scope:\n  kind: task\n  taskId: 00000000-0000-4000-8000-000000000000');
    assert.notEqual(legacyFile, prior, 'The fixture must actually have legacy scope.');
    await writeFile(created.path, legacyFile);
    assert.deepEqual(memoryCall<{ memories: Memory[] }>(root, { action: 'list' }).memories, []);
    const managed = memoryCall<{ memories: Memory[] }>(root, { action: 'list', allScopes: true });
    assert.equal(managed.memories[0]?.id, created.id);
    const legacy = memoryCall<Memory>(root, { action: 'read', memoryId: created.id });
    assert.equal(legacy.scope.kind, 'task');
    const selected = context(root, ['--memory', created.id, '--path', 'src/cache.ts']);
    assert.deepEqual(selected.knowledge.memories, []);
    assert.ok(selected.knowledge.unavailable.some(item => item.id === created.id));
    assert.equal(errorCode(runCli(['call', 'memory', '--input', '-', '--project', root], {
      action: 'update', memoryId: legacy.id, expectedRevision: legacy.revision,
      memory: { title: legacy.title, body: legacy.body, source: legacy.source, scope: { kind: 'project' } },
    })), 'invalid');
    assert.equal(await readFile(created.path, 'utf8'), legacyFile);
    memoryCall(root, { action: 'delete', memoryId: legacy.id, expectedRevision: legacy.revision });
    assert.deepEqual(memoryCall<{ memories: Memory[] }>(root, { action: 'list', allScopes: true }).memories, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
