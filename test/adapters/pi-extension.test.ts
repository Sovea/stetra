import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { activate, type PiHost } from '../../src/adapters/pi/extension.js';

const execute = promisify(execFile);

function host() {
  type Context = { hasUI: boolean; ui: { notify(message: string, type?: string): void }; sessionManager: { getSessionId(): string } };
  type Handler = (event: unknown, context: Context) => unknown;
  const handlers = new Map<string, Handler[]>();
  const notifications: { message: string; type?: string }[] = [];
  const calls: { command: string; args: string[]; timeout: number }[] = [];
  let sessionId = 'pi-session-a';
  const context: Context = { sessionManager: { getSessionId: () => sessionId }, hasUI: true, ui: { notify: (message, type) => { notifications.push({ message, type }); } } };
  let response = { code: 0, stdout: JSON.stringify({ text: 'Current knowledge' }), stderr: '', killed: false };
  let pause: Promise<void> | undefined;
  const pi = {
    on(event: string, handler: Handler) { handlers.set(event, [...handlers.get(event) ?? [], handler]); },
    async exec(command: string, args: string[], options: { timeout: number }) {
      calls.push({ command, args, timeout: options.timeout });
      const result = response;
      if (pause) await pause;
      return result;
    },
  } as PiHost;
  return {
    pi, calls, notifications,
    session(id: string) { sessionId = id; },
    pauseUntil(promise: Promise<void> | undefined) { pause = promise; },
    respond(text: string) { response = { code: 0, stdout: JSON.stringify({ text }), stderr: '', killed: false }; },
    fail() { response = { code: 1, stdout: '', stderr: 'Failure', killed: false }; },
    async emit(event: string, data: unknown = {}) {
      let result: unknown;
      for (const handler of handlers.get(event) ?? []) result = await handler(data, context);
      return result as { messages: Array<{ role: string; customType?: string; content?: string }> } | undefined;
    },
  };
}

test('pi refreshes bounded knowledge on its native lifecycle without accumulating transcript messages', async t => {
  const runtime = host();
  t.after(() => runtime.emit('session_shutdown'));
  const options = { cliPath: '/project with spaces/.stetra/runtime/cli.js', projectRoot: '/project with spaces' };
  activate(runtime.pi, options);
  await runtime.emit('session_start');
  assert.equal(runtime.calls.length, 0, 'Lifecycle setup does not poll or start a background process.');
  const messages = [{ role: 'user', content: 'Explain the cache' }];
  const first = await runtime.emit('context', { messages });
  assert.equal(messages.length, 1);
  assert.equal(first!.messages.length, 2);
  assert.equal(first!.messages[1]!.customType, 'stetra-context');
  assert.equal(first!.messages[1]!.content, 'Current knowledge');
  assert.deepEqual(runtime.calls, [{ command: process.execPath, args: [options.cliPath, 'context', '--instructions', '--host', 'pi', '--session', 'pi-session-a', '--project', options.projectRoot], timeout: 5_000 }]);
  assert.equal((await runtime.emit('context', { messages: first!.messages }))!.messages.length, 2);
  assert.equal(runtime.calls.length, 1, 'Tool turns reuse the prompt context.');

  for (const event of ['session_start', 'session_compact', 'before_agent_start']) {
    runtime.respond(`Fresh knowledge after ${event}`);
    await runtime.emit(event);
    const result = await runtime.emit('context', { messages: first!.messages });
    assert.equal(result!.messages[1]!.content, `Fresh knowledge after ${event}`);
  }
  runtime.fail();
  await runtime.emit('before_agent_start');
  assert.deepEqual((await runtime.emit('context', { messages: first!.messages }))!.messages, messages);
  assert.equal(runtime.notifications.at(-1)!.type, 'warning');
  runtime.respond('界'.repeat(6_000));
  await runtime.emit('before_agent_start');
  assert.deepEqual((await runtime.emit('context', { messages }))!.messages, messages);
  assert.match(runtime.notifications.at(-1)!.message, /size limit/);
});

test('pi serializes concurrent refreshes and discards old-session results on a fork', async t => {
  const runtime = host();
  let release!: () => void;
  runtime.pauseUntil(new Promise<void>(resolve => { release = resolve; }));
  runtime.respond('Old session knowledge');
  activate(runtime.pi, { cliPath: '/project/cli.js', projectRoot: '/project' });
  t.after(async () => { release(); await runtime.emit('session_shutdown'); });
  const messages = [{ role: 'user', content: 'Explain this.' }];
  const old = runtime.emit('context', { messages });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls.length, 1);
  runtime.session('fork-session');
  runtime.respond('Fork knowledge');
  await runtime.emit('session_start');
  const fresh = runtime.emit('context', { messages: [...messages, { role: 'custom', customType: 'stetra-context', content: 'Stale injected knowledge' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls.length, 1, 'The new refresh waits for the existing CLI invocation.');
  runtime.pauseUntil(undefined);
  release();
  assert.deepEqual((await old)!.messages, messages);
  assert.equal((await fresh)!.messages[1]!.content, 'Fork knowledge');
  assert.ok(runtime.calls[1]!.args.includes('fork-session'));
  const samePrompt = await Promise.all([runtime.emit('context', { messages }), runtime.emit('context', { messages })]);
  assert.ok(samePrompt.every(result => result!.messages[1]!.content === 'Fork knowledge'));
  assert.equal(runtime.calls.length, 2);
});

test('pi shutdown discards an in-flight context refresh', async () => {
  const runtime = host();
  let release!: () => void;
  runtime.pauseUntil(new Promise<void>(resolve => { release = resolve; }));
  activate(runtime.pi, { cliPath: '/project/cli.js', projectRoot: '/project' });
  const messages = [{ role: 'user', content: 'Explain this.' }];
  const pending = runtime.emit('context', { messages });
  await new Promise(resolve => setImmediate(resolve));
  await runtime.emit('session_shutdown');
  release();
  assert.deepEqual((await pending)!.messages, messages);
  assert.equal(runtime.calls.length, 1);
});

test('pi lifecycle refresh reads selections and revisions written through the actual CLI', { timeout: 15_000 }, async t => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'stetra pi knowledge '));
  const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
  const runtime = host();
  t.after(async () => { await runtime.emit('session_shutdown'); await rm(projectRoot, { recursive: true, force: true }); });
  async function cli<T>(args: string[], input?: unknown): Promise<T> {
    if (input !== undefined) {
      const path = join(projectRoot, 'request.json');
      await writeFile(path, JSON.stringify(input));
      args = [...args, '--input', path];
    }
    const result = await execute(process.execPath, [cliPath, ...args, '--project', projectRoot], { encoding: 'utf8', timeout: 5_000 });
    return JSON.parse(result.stdout) as T;
  }
  runtime.pi.exec = async (command, args, options) => {
    const result = await execute(command, args, { encoding: 'utf8', timeout: options.timeout });
    return { code: 0, stdout: result.stdout, stderr: result.stderr, killed: false };
  };
  const memory = await cli<{ id: string; revision: string }>(['call', 'memory'], { action: 'create', memory: { title: 'Cache behavior', body: 'Initial lookup contract.', source: 'developer' } });
  await cli(['context', '--memory', memory.id, '--host', 'pi', '--session', 'pi-session-a']);
  activate(runtime.pi, { cliPath, projectRoot });
  await runtime.emit('session_start');
  const messages = [{ role: 'user', content: 'Explain the cache.' }];
  const first = await runtime.emit('context', { messages });
  assert.ok(first!.messages[1]!.content!.includes('Initial lookup contract.'));
  await cli(['call', 'memory'], { action: 'update', memoryId: memory.id, expectedRevision: memory.revision, memory: { title: 'Cache behavior', body: 'Corrected lookup contract.', source: 'developer' } });
  await runtime.emit('before_agent_start');
  const refreshed = await runtime.emit('context', { messages: first!.messages });
  assert.ok(refreshed!.messages[1]!.content!.includes('Corrected lookup contract.'));
  assert.ok(!refreshed!.messages[1]!.content!.includes('Initial lookup contract.'));
  runtime.session('fork-native-session');
  await runtime.emit('session_start');
  const fork = await runtime.emit('context', { messages: refreshed!.messages });
  assert.equal(fork!.messages.length, 2);
  assert.ok(!fork!.messages[1]!.content!.includes('Corrected lookup contract.'));
  assert.ok(fork!.messages[1]!.content!.includes('fork-native-session'));
});
