import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ContextCache } from '../../src/runtime/context/cache.js';
import type { ContextCacheData, SessionKey } from '../../src/runtime/context/types.js';
import { MemoryStore } from '../../src/runtime/knowledge/store.js';
import { StetraError } from '../../src/runtime/shared.js';

const session: SessionKey = { host: 'codex', sessionId: 'native-session' };
function data(id = randomUUID()): ContextCacheData {
  return { schemaVersion: 1, selection: { ids: [id], paths: ['src/cache'] }, provided: { [id]: 'a'.repeat(64) } };
}
function storageError(error: unknown): boolean { return error instanceof StetraError && error.code === 'storage'; }
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'stetra context cache '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory: join(root, '.stetra/cache/contexts'), cache: new ContextCache(root, session) };
}
async function save(cache: ContextCache, value: ContextCacheData) {
  return cache.update({ create: true, reset: false }, async () => ({ result: null, cache: value }));
}
async function read(cache: ContextCache) {
  return cache.update({ create: false, reset: false }, async previous => ({ result: previous, cache: previous }));
}

test('absent context cache reads do not create files and created selections remain private', async t => {
  const { root, directory, cache } = await fixture(t);
  assert.equal(await read(cache), null);
  assert.deepEqual(await readdir(root), []);
  const current = data();
  await save(cache, current);
  assert.deepEqual(await read(new ContextCache(root, session)), current);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^[a-f0-9]{64}\.json$/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, files[0]!), 'utf8')), current);
  assert.match(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), /^\/cache\/$/m);
  if (process.platform !== 'win32') {
    for (const path of [join(root, '.stetra'), join(root, '.stetra/cache'), directory]) assert.equal((await lstat(path)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(directory, files[0]!))).mode & 0o777, 0o600);
  }
});

test('hashed Host and session identities isolate selections and cannot traverse paths', async t => {
  const { root, directory } = await fixture(t);
  const maliciousId = '../../../escaped/../../session.json';
  const keys: SessionKey[] = [
    { host: 'codex', sessionId: maliciousId },
    { host: 'claude', sessionId: maliciousId },
    { host: 'codex', sessionId: '/absolute/session\\with\\separators' },
  ];
  const selections = keys.map(() => data());
  for (let index = 0; index < keys.length; index++) await save(new ContextCache(root, keys[index]!), selections[index]!);
  for (let index = 0; index < keys.length; index++) assert.deepEqual(await read(new ContextCache(root, keys[index]!)), selections[index]);
  const files = await readdir(directory);
  assert.equal(files.length, keys.length);
  assert.ok(files.every(file => /^[a-f0-9]{64}\.json$/.test(file)));
  assert.deepEqual(await readdir(root), ['.stetra']);
  assert.equal(await read(new ContextCache(root, { host: 'codex', sessionId: 'unrelated' })), null);
});

test('reset recovers malformed, oversized, and incompatible caches without trusting their contents', async t => {
  const { directory, cache } = await fixture(t);
  await save(cache, data());
  const path = join(directory, (await readdir(directory))[0]!);
  const invalid = ['{not valid JSON', JSON.stringify({ ...data(), schemaVersion: 999 }), 'x'.repeat(512_001)];
  for (const contents of invalid) {
    await writeFile(path, contents);
    let invoked = false;
    await assert.rejects(cache.update({ create: false, reset: false }, async previous => {
      invoked = true;
      return { result: previous, cache: previous };
    }), storageError);
    assert.equal(invoked, false);
    const replacement = data();
    await cache.update({ create: false, reset: true }, async previous => {
      assert.equal(previous, null);
      return { result: null, cache: replacement };
    });
    assert.deepEqual(await read(cache), replacement);
  }
  await cache.update({ create: false, reset: true }, async () => ({ result: null, cache: null }));
  assert.equal(await read(cache), null);
  assert.deepEqual(await readdir(directory), []);
});

test('a valid cache remains readable when the filesystem returns short reads', async t => {
  const { root, cache } = await fixture(t);
  const current = data();
  await save(cache, current);
  const probe = await open(join(root, 'probe'), 'w+');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const original = prototype.read as (buffer: Buffer, offset: number, length: number, position: number | null) => Promise<{ bytesRead: number; buffer: Buffer }>;
  await probe.close();
  let reads = 0;
  const mocked = t.mock.method(prototype, 'read', function (this: FileHandle, buffer: Buffer, offset: number, length: number, position: number | null) {
    reads++;
    return original.call(this, buffer, offset, Math.min(length, 17), position);
  });
  try {
    assert.deepEqual(await read(cache), current);
    assert.ok(reads > 1);
  } finally { mocked.mock.restore(); }
});

test('invalid cache writes preserve the previous selection and release its lock', async t => {
  const { cache } = await fixture(t);
  const current = data();
  await save(cache, current);
  await assert.rejects(save(cache, { ...current, provided: { [randomUUID()]: 'a'.repeat(64) } }), storageError);
  assert.deepEqual(await read(cache), current);
  await assert.rejects(cache.update({ create: false, reset: false }, async () => { throw new Error('Retrieval failed.'); }), /Retrieval failed/);
  assert.deepEqual(await read(cache), current);
});

test('cache directories, files, and locks cannot follow symlinks outside the project', async t => {
  const { root, directory, cache } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'stetra cache outside '));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const externalFile = join(outside, 'private.json');
  await writeFile(externalFile, 'External content');
  for (const path of [join(root, '.stetra'), join(root, '.stetra/cache'), directory]) {
    await mkdir(join(path, '..'), { recursive: true });
    await symlink(outside, path);
    await assert.rejects(read(cache), storageError);
    await assert.rejects(save(cache, data()), storageError);
    await rm(path);
    await mkdir(path);
  }
  await save(cache, data());
  const path = join(directory, (await readdir(directory))[0]!);
  await rm(path);
  await symlink(externalFile, path);
  await assert.rejects(read(cache), storageError);
  await cache.update({ create: false, reset: true }, async () => ({ result: null, cache: null }));
  assert.equal(await readFile(externalFile, 'utf8'), 'External content', 'Reset may remove the link, never its target.');
  await symlink(outside, `${directory}.lock`);
  await assert.rejects(save(cache, data()), storageError);
  assert.deepEqual(await readdir(outside), ['private.json']);
});

test('creating knowledge before session selection still ignores private context caches', async t => {
  const { root, cache } = await fixture(t);
  await new MemoryStore(root).create({ title: 'Cache behavior', body: 'Preserve failure semantics.', source: 'developer' });
  await save(cache, data());
  assert.match(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), /^\/cache\/$/m);
});

test('an older parent gitignore stays unchanged while Git ignores newly created session caches', async t => {
  const { root, directory, cache } = await fixture(t);
  execFileSync('git', ['init', '--quiet', root]);
  await mkdir(join(root, '.stetra'));
  const original = '# Developer-maintained rules\nstate.sqlite*\nmemory.lock/\n';
  const parent = join(root, '.stetra/.gitignore');
  await writeFile(parent, original);
  await save(cache, data());
  const relative = `.stetra/cache/contexts/${(await readdir(directory))[0]!}`;
  const ignored = execFileSync('git', ['-C', root, 'check-ignore', '--verbose', relative], { encoding: 'utf8' });
  assert.match(ignored, /^\.stetra\/cache\/\.gitignore:1:\*\s/);
  assert.ok(ignored.trimEnd().endsWith(relative));
  assert.equal(await readFile(parent, 'utf8'), original);
  const privateIgnore = join(root, '.stetra/cache/.gitignore');
  assert.equal(await readFile(privateIgnore, 'utf8'), '*\n');
  await writeFile(privateIgnore, '# Local cache rules\n*\n');
  await save(cache, data());
  assert.equal(await readFile(privateIgnore, 'utf8'), '# Local cache rules\n*\n');
  assert.equal(await readFile(parent, 'utf8'), original);
});

type WorkerMessage = { event: string; ids?: string[] };
function worker(root: string, mode: 'replace' | 'refresh', id: string) {
  const child = fork(new URL('./context-cache-worker.ts', import.meta.url), [mode, root, id], { execArgv: ['--import', 'tsx'], silent: true });
  let diagnostics = '';
  let failure: Error | undefined;
  const received = new Map<string, WorkerMessage>();
  const waiting = new Map<string, { resolve(message: WorkerMessage): void; reject(error: Error): void }>();
  child.stderr?.on('data', data => { diagnostics += String(data); });
  child.on('message', value => {
    const message = value as WorkerMessage;
    received.set(message.event, message);
    waiting.get(message.event)?.resolve(message);
    waiting.delete(message.event);
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', error => { failure = error; reject(error); for (const waiter of waiting.values()) waiter.reject(error); });
    child.once('close', (code, signal) => {
      const error = new Error(`Cache worker closed (${code}, ${signal}): ${diagnostics}`);
      failure = error;
      for (const waiter of waiting.values()) waiter.reject(error);
      if (code !== 0 || signal !== null) reject(error);
      else resolve();
    });
  });
  void closed.catch(() => {});
  return {
    child, closed,
    has(event: string): boolean { return received.has(event); },
    wait(event: string): Promise<WorkerMessage> {
      const message = received.get(event);
      if (message) return Promise.resolve(message);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => { waiting.set(event, { resolve, reject }); });
    },
  };
}

test('a concurrent refresh reads the replacement selection instead of restoring an earlier one', { timeout: 15_000 }, async t => {
  const { root } = await fixture(t);
  const cache = new ContextCache(root, { host: 'pi', sessionId: 'shared-native-session' });
  const previous = data();
  const selectedId = randomUUID();
  await save(cache, previous);
  const replacement = worker(root, 'replace', selectedId);
  const refresh = worker(root, 'refresh', selectedId);
  const workers = [replacement, refresh];
  const stop = () => { for (const { child } of workers) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  t.signal.addEventListener('abort', stop, { once: true });
  try {
    await Promise.all(workers.map(worker => worker.wait('ready')));
    replacement.child.send({ start: true });
    assert.deepEqual((await replacement.wait('entered')).ids, previous.selection.ids);
    refresh.child.send({ start: true });
    await refresh.wait('attempting');
    await delay(100);
    assert.equal(refresh.has('entered'), false, 'The refresh callback must wait until the replacement commits.');
    replacement.child.send({ release: true });
    assert.deepEqual((await refresh.wait('entered')).ids, [selectedId]);
    await Promise.all(workers.map(worker => worker.closed));
    assert.deepEqual(await read(cache), { schemaVersion: 1, selection: { ids: [selectedId], paths: ['src/new'] }, provided: { [selectedId]: 'b'.repeat(64) } });
  } finally {
    stop();
    await Promise.allSettled(workers.map(worker => worker.closed));
    t.signal.removeEventListener('abort', stop);
  }
});
