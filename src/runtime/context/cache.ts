import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { StetraError } from '../shared.js';
import { contextCacheSchema, type ContextCacheData, type SessionKey } from './types.js';

const MAX_CACHE_BYTES = 512_000;

/** One replaceable knowledge selection per native session, never a conversation log. */
export class ContextCache {
  private readonly directory: string;
  private readonly path: string;

  constructor(private readonly root: string, session: SessionKey) {
    this.directory = join(root, '.stetra', 'cache', 'contexts');
    const id = createHash('sha256').update(JSON.stringify([session.host, session.sessionId])).digest('hex');
    this.path = join(this.directory, `${id}.json`);
  }

  private async directories(create: boolean): Promise<boolean> {
    for (const directory of [join(this.root, '.stetra'), join(this.root, '.stetra', 'cache'), this.directory]) {
      if (create) {
        try { await mkdir(directory, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      try {
        const info = await lstat(directory);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new StetraError('storage', 'Context cache directories must be real directories inside this project.');
      } catch (error) {
        if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    if (create) {
      try { await writeFile(join(this.root, '.stetra', '.gitignore'), 'index.sqlite*\n/cache/\nmemory.lock/\nmemory/.tmp-*\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      // Older installations and user-maintained parent ignore files may not
      // mention caches. Protect this local data without rewriting either file.
      try { await writeFile(join(this.root, '.stetra', 'cache', '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    return true;
  }

  private async read(): Promise<ContextCacheData | null> {
    let handle;
    try {
      const info = await lstat(this.path);
      if (info.isSymbolicLink() || !info.isFile()) throw new StetraError('storage', 'The context cache must be a regular file.');
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) throw new StetraError('storage', 'The context cache is invalid or too large. Reset this session selection.');
      const bytes = Buffer.alloc(MAX_CACHE_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_CACHE_BYTES) throw new StetraError('storage', 'The context cache exceeds its size limit.');
      try { return contextCacheSchema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8'))); }
      catch { throw new StetraError('storage', 'The context cache is invalid. Use context --reset with this Host and session to discard it.'); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close(); }
  }

  private async write(data: ContextCacheData | null): Promise<void> {
    if (!data) {
      try { await unlink(this.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return;
    }
    const content = `${JSON.stringify(contextCacheSchema.parse(data))}\n`;
    if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new StetraError('invalid', 'The context selection exceeds its cache size limit.');
    const temporary = join(this.directory, `.tmp-${randomUUID()}`);
    try {
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      try { await unlink(temporary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  async update<T>(options: { create: boolean; reset: boolean }, operation: (previous: ContextCacheData | null) => Promise<{ result: T; cache: ContextCacheData | null }>): Promise<T> {
    if (!await this.directories(options.create)) return (await operation(null)).result;
    try {
      const lock = `${this.directory}.lock`;
      try { if ((await lstat(lock)).isSymbolicLink()) throw new StetraError('storage', 'The context cache lock must not be a symbolic link.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const release = await lockfile.lock(this.directory, { realpath: false, retries: { retries: 30, minTimeout: 10, maxTimeout: 100 }, stale: 10_000, update: 2_000 });
      try {
        // Explicit reset can recover a malformed cache without interpreting its contents.
        const previous = options.reset ? null : await this.read();
        const { result, cache } = await operation(previous);
        if (options.reset || JSON.stringify(previous) !== JSON.stringify(cache)) await this.write(cache);
        return result;
      } finally { await release(); }
    } catch (error) {
      if (error instanceof StetraError) throw error;
      throw new StetraError('storage', error instanceof Error ? error.message : 'Context cache operation failed.');
    }
  }
}
