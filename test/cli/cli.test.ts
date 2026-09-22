import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { initializeProject } from '../../src/setup/init.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const bundle = join(repository, 'dist/cli.js');

function run(root: string, args: string[], input?: unknown) {
  const result = spawnSync(process.execPath, [bundle, ...args], {
    cwd: root, encoding: 'utf8', timeout: 5_000,
    input: input === undefined ? undefined : JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

async function project(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stetra commander '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('first initialization requires terminal selection and neither yes nor JSON chooses a Host', async t => {
  const root = await project(t);
  for (const options of [[], ['--yes'], ['--json'], ['--yes', '--json'], ['--dry-run', '--yes']]) {
    const result = run(root, ['init', '--project', root, ...options]);
    assert.notEqual(result.status, 0, `Noninteractive first init unexpectedly succeeded: ${options.join(' ')}`);
    assert.ok(result.stderr.trim(), 'Failure must explain that Host selection is required.');
    assert.deepEqual(await readdir(root), [], 'Failed selection must not create installation or knowledge files.');
  }
});

test('the removed adapter option and options belonging to other commands are rejected before work', async t => {
  const root = await project(t);
  const requests: Array<{ args: string[]; input?: unknown }> = [
    { args: ['init', '--adapter', 'codex'] },
    { args: ['context', '--force'] },
    { args: ['schema', 'memory', '--force'] },
    { args: ['call', 'memory', '--input', '-', '--dry-run'], input: { action: 'create', memory: { title: 'This must not be written', body: 'Invalid command flags must prevent writes.', source: 'developer' } } },
    { args: ['hook', '--query', 'cache'], input: { hook_event_name: 'SessionStart', cwd: root } },
    { args: ['context', '--yes'] },
  ];
  for (const request of requests) {
    const result = run(root, [...request.args, '--project', root], request.input);
    assert.notEqual(result.status, 0, `Misplaced options were accepted: ${request.args.join(' ')}`);
    assert.ok(result.stderr.trim());
    assert.deepEqual(await readdir(root), [], `Rejected command changed the project: ${request.args.join(' ')}`);
  }
});

for (const choice of ['pi', 'agents']) test(`yes refreshes the recorded ${choice} choice without adding another integration`, async t => {
  const root = await project(t);
  await initializeProject(root, { adapters: [choice] });
  const manifestPath = join(root, '.stetra/installation.json');
  const before = await readFile(manifestPath, 'utf8');
  const result = run(root, ['init', '--project', root, '--yes', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'initialized');
  assert.deepEqual(output.adapters, [choice]);
  assert.equal(await readFile(manifestPath, 'utf8'), before);
  assert.ok(!(await readdir(root)).includes('.codex'), 'Refreshing saved choices must not silently add Codex.');
  if (choice === 'agents') {
    const entries = await readdir(root);
    assert.ok(!entries.includes('.claude') && !entries.includes('.pi'), 'Generic Agent Skills must remain free of native Host setup.');
    assert.ok(!(await readdir(join(root, '.stetra/runtime'))).includes('pi.js'));
  }
});

test('Commander dispatch preserves JSON stdin, schema output, and the hook protocol', async t => {
  const root = await project(t);
  const schema = run(root, ['schema', 'memory', '--action', 'create']);
  assert.equal(schema.status, 0, schema.stderr);
  assert.equal(typeof JSON.parse(schema.stdout).$schema, 'string');
  const memory = run(root, ['call', 'memory', '--input', '-', '--project', root], { action: 'create', memory: { title: 'Knowledge passed through stdin', body: 'Preserve observable query failures.', source: 'developer', paths: ['src/query.ts'] } });
  assert.equal(memory.status, 0, memory.stderr);
  const created = JSON.parse(memory.stdout);
  const context = run(root, ['context', '--project', root, '--query', 'stdin', '--path', 'src/query.ts', '--host', 'codex', '--session', 'fixture-command-session']);
  assert.equal(context.status, 0, context.stderr);
  assert.equal(JSON.parse(context.stdout).knowledge.memories[0].id, created.id);
  const hook = run(root, ['hook'], { hook_event_name: 'SessionStart', cwd: root, source: 'startup', session_id: 'fixture-command-session' });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'SessionStart');
  assert.ok(output.additionalContext.includes(created.id));
  assert.ok(output.additionalContext.includes(created.body));
});
