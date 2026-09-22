import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { parseDocument, stringify } from 'yaml';
import { idSchema, StetraError, validate } from '../shared.js';
import { KnowledgeIndex, searchSnippet } from './index.js';
import { matchesPaths, memoryInputSchema, memoryReadSchema, memoryRecallSchema, memorySearchSchema, memorySummary, type Memory, type MemoryContent, type MemoryInput, type MemoryIssue, type MemoryListing, type MemoryRecallOptions, type MemoryRecallResult, type MemorySearchOptions, type MemorySearchResult } from './types.js';

const metadataSchema = memoryReadSchema.omit({ body: true }).extend({ id: idSchema }).strict();
const MAX_FILE_BYTES = 2 * 1_048_576;

function failStorage(error: unknown): never {
  if (error instanceof StetraError) throw error;
  throw new StetraError('storage', error instanceof Error ? error.message : 'Memory storage operation failed.');
}

function revisionOf(raw: string | Uint8Array): string { return createHash('sha256').update(raw).digest('hex'); }

export class MemoryStore {
  private readonly stateDirectory: string;
  private readonly directory: string;

  constructor(projectRoot: string) {
    this.stateDirectory = join(resolve(projectRoot), '.stetra');
    this.directory = join(this.stateDirectory, 'memory');
  }

  private path(id: string): string {
    validate(idSchema, id);
    return join(this.directory, `${id}.md`);
  }

  private async ensureDirectory(path: string): Promise<void> {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new StetraError('storage', `Memory storage directory must not be a symbolic link: ${path}`);
  }

  private async storageExists(): Promise<boolean> {
    for (const path of [this.stateDirectory, this.directory]) {
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new StetraError('storage', `Memory storage directory must not be a symbolic link: ${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  }

  private async locked<T>(operation: () => Promise<T>, write = true, onMissing?: () => T): Promise<T> {
    try {
      if (write) {
        await this.ensureDirectory(this.stateDirectory);
        try { await writeFile(join(this.stateDirectory, '.gitignore'), 'state.sqlite*\nindex.sqlite*\n/cache/\nmemory.lock/\nmemory/.tmp-*\n', { flag: 'wx', mode: 0o600 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        await this.ensureDirectory(this.directory);
      } else if (!await this.storageExists()) {
        if (onMissing) return onMissing();
        throw new StetraError('not_found', 'Memory storage does not exist.');
      }
      try {
        if ((await lstat(`${this.directory}.lock`)).isSymbolicLink()) throw new StetraError('storage', 'Memory lock must not be a symbolic link.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const release = await lockfile.lock(this.directory, {
        realpath: false, retries: { retries: 20, minTimeout: 10, maxTimeout: 100 }, stale: 10_000, update: 2_000,
      });
      try { return await operation(); }
      finally { await release(); }
    } catch (error) { return failStorage(error); }
  }

  private async read(id: string): Promise<Memory> {
    const path = this.path(id);
    let handle;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new StetraError('invalid', `Memory must be a regular file: ${path}`);
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new StetraError('invalid', 'Memory files must be regular files no larger than 2 MiB.');
      // The extra byte also catches growth after stat without an unbounded read.
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_FILE_BYTES) throw new StetraError('invalid', 'Memory files must be no larger than 2 MiB.');
      const bytes = buffer.subarray(0, length);
      const raw = bytes.toString('utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
      if (!match) throw new StetraError('invalid', `Memory has no valid YAML frontmatter: ${path}`);
      const document = parseDocument(match[1]!, { uniqueKeys: true });
      if (document.errors.length > 0) throw new StetraError('invalid', `Invalid memory YAML: ${document.errors[0]!.message}`);
      const metadata = validate(metadataSchema, document.toJS({ maxAliasCount: 20 }));
      if (metadata.id !== id) throw new StetraError('invalid', `Memory ID does not match its filename: ${path}`);
      const { id: storedId, ...input } = metadata;
      const content = validate(memoryReadSchema, { ...input, body: match[2] });
      return { ...content, id: storedId, revision: revisionOf(bytes), path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StetraError('not_found', `Memory ${id} does not exist.`);
      return failStorage(error);
    } finally { await handle?.close(); }
  }

  private checkRevision(memory: Memory, expectedRevision: string): void {
    if (memory.revision !== expectedRevision) throw new StetraError('conflict', 'Memory changed since it was read. Read the current file before retrying.');
  }

  private async write(id: string, input: MemoryContent): Promise<Memory> {
    const path = this.path(id);
    const { body, ...metadata } = input;
    const raw = `---\n${stringify({ id, ...metadata }, { lineWidth: 0 })}---\n\n${body}\n`;
    const temporary = join(this.directory, `.tmp-${randomUUID()}`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(raw, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
    } finally {
      await handle?.close();
      try { await unlink(temporary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { ...input, id, revision: revisionOf(raw), path };
  }

  private async scan(): Promise<{ memories: Memory[]; issues: MemoryIssue[] }> {
    const result: { memories: Memory[]; issues: MemoryIssue[] } = { memories: [], issues: [] };
    for (const name of (await readdir(this.directory)).sort()) {
      const path = join(this.directory, name);
      try {
        if (!name.endsWith('.md')) throw new StetraError('invalid', 'Unexpected file in memory directory.');
        result.memories.push(await this.read(name.slice(0, -3)));
      } catch (error) {
        result.issues.push({ path, message: error instanceof Error ? error.message : 'Invalid memory file.' });
      }
    }
    return result;
  }

  async list(options: { includeWithdrawn?: boolean; allScopes?: boolean } = {}): Promise<MemoryListing> {
    return this.locked(async () => {
      const { memories, issues } = await this.scan();
      return { memories: memories.filter(memory =>
        (memory.status === 'active' || options.includeWithdrawn) &&
        (options.allScopes || memory.scope.kind === 'project'),
      ).map(memorySummary), issues };
    }, false, () => ({ memories: [], issues: [] }));
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult> {
    const input = validate(memorySearchSchema, options);
    return this.locked(async () => {
      const { memories, issues } = await this.scan();
      const byId = new Map(memories.map(memory => [memory.id, memory]));
      const ids = await new KnowledgeIndex(this.stateDirectory).search(memories, input.query);
      const matches: MemorySearchResult['matches'] = [];
      for (const id of ids) {
        if (matches.length >= input.limit) break;
        const indexed = byId.get(id);
        if (!indexed) continue;
        try {
          // Editors and Git do not take our lock. Re-read every returned hit so
          // the index cannot resurrect a deletion or expose an outdated body.
          const memory = await this.read(id);
          if (memory.revision !== indexed.revision) {
            issues.push({ path: memory.path, message: 'Knowledge changed during search. Search again to include its current content.' });
            continue;
          }
          if (memory.status === 'withdrawn' && !input.includeWithdrawn) continue;
          if (!input.allScopes && memory.scope.kind !== 'project') continue;
          if (input.paths?.length && memory.paths.length && !matchesPaths(memory.paths, input.paths)) continue;
          matches.push({ memory: memorySummary(memory), snippet: searchSnippet(memory, input.query) });
        } catch (error) {
          issues.push({ path: this.path(id), message: error instanceof Error ? error.message : 'Knowledge is no longer available.' });
        }
      }
      return { matches, issues };
    }, false, () => ({ matches: [], issues: [] }));
  }

  async recall(options: MemoryRecallOptions = {}): Promise<MemoryRecallResult> {
    const input = validate(memoryRecallSchema, options);
    const requested = new Set(input.ids ?? []);
    return this.locked(async () => {
      const scanned = await this.scan();
      const result: MemoryRecallResult = { memories: [], unavailable: [], issues: scanned.issues };
      const found = new Set(scanned.memories.map(memory => memory.id));
      const candidates = new Set<string>(requested);
      for (const memory of scanned.memories) {
        if (memory.scope.kind === 'project' && input.paths?.length && memory.paths.length && matchesPaths(memory.paths, input.paths)) candidates.add(memory.id);
      }
      for (const id of candidates) {
        try {
          const memory = await this.read(id);
          const reason = memory.status === 'withdrawn' ? 'This knowledge has been withdrawn.'
            : memory.scope.kind !== 'project' ? 'Legacy task-scoped knowledge is available for inspection only. Review its applicability before creating project knowledge.'
              : input.paths?.length && memory.paths.length && !matchesPaths(memory.paths, input.paths) ? 'This knowledge does not apply to the requested paths.'
                : undefined;
          if (reason) { if (requested.has(id)) result.unavailable.push({ id, reason }); continue; }
          result.memories.push(memory);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Knowledge is unavailable.';
          if (requested.has(id)) result.unavailable.push({ id, reason });
          if (found.has(id)) result.issues.push({ path: this.path(id), message: reason });
        }
      }
      return result;
    }, false, () => ({ memories: [], unavailable: [...requested].map(id => ({ id, reason: `Memory ${id} does not exist.` })), issues: [] }));
  }

  async get(id: string): Promise<Memory> {
    validate(idSchema, id);
    return this.locked(() => this.read(id), false, () => { throw new StetraError('not_found', `Memory ${id} does not exist.`); });
  }

  async create(input: MemoryInput): Promise<Memory> {
    const cleanInput = validate(memoryInputSchema, input);
    return this.locked(async () => {
      const id = randomUUID();
      try {
        await lstat(this.path(id));
        throw new StetraError('conflict', 'Generated memory ID already exists. Retry creation.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return this.write(id, cleanInput);
    });
  }

  async update(id: string, expectedRevision: string, input: MemoryInput): Promise<Memory> {
    validate(idSchema, id);
    const cleanInput = validate(memoryInputSchema, input);
    return this.locked(async () => {
      const memory = await this.read(id);
      this.checkRevision(memory, expectedRevision);
      if (memory.scope.kind !== 'project') throw new StetraError('invalid', 'Legacy task-scoped knowledge cannot be updated into project knowledge. Review its applicability and create a new item explicitly.');
      await new KnowledgeIndex(this.stateDirectory).invalidate();
      return this.write(id, cleanInput);
    });
  }

  async delete(id: string, expectedRevision: string): Promise<void> {
    validate(idSchema, id);
    return this.locked(async () => {
      const memory = await this.read(id);
      this.checkRevision(memory, expectedRevision);
      await new KnowledgeIndex(this.stateDirectory).invalidate();
      await unlink(this.path(id));
    });
  }
}
