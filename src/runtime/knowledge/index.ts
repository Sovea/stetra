import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StetraError } from '../shared.js';
import type { Memory } from './types.js';

const SCHEMA_VERSION = 1;
const VERSION_ERROR = 'The derived knowledge index has a different schema version.';
const schema = `
  CREATE VIRTUAL TABLE knowledge_fts USING fts5(
    id UNINDEXED, revision UNINDEXED, title, body, applicability, paths, references_text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  PRAGMA user_version = ${SCHEMA_VERSION};
`;

export function searchTerms(query: string): string[] {
  return query.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
}

function substringMatch(memory: Memory, query: string): boolean {
  const haystack = [memory.title, memory.body, memory.applicability, ...memory.paths, ...memory.references].join('\n').toLowerCase();
  const terms = searchTerms(query).map(term => term.toLowerCase());
  return terms.length > 0 && terms.every(term => haystack.includes(term));
}

/** This database is disposable. Markdown content and file hashes are authoritative. */
export class KnowledgeIndex {
  readonly path: string;

  constructor(stateDirectory: string) { this.path = join(stateDirectory, 'index.sqlite'); }

  private async checkFiles(): Promise<void> {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const path = `${this.path}${suffix}`;
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile()) throw new StetraError('storage', `Knowledge index must be a regular file: ${path}`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  private open(): DatabaseSync {
    const database = new DatabaseSync(this.path);
    try {
      database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA trusted_schema = OFF;');
      const version = Number(database.prepare('PRAGMA user_version').get()!.user_version);
      if (version === 0) database.exec(schema);
      else if (version !== SCHEMA_VERSION) throw new Error(VERSION_ERROR);
      database.prepare('SELECT id, revision FROM knowledge_fts LIMIT 1').all();
      database.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES ('integrity-check')");
      return database;
    } catch (error) { database.close(); throw error; }
  }

  private async database(): Promise<DatabaseSync> {
    await this.checkFiles();
    try { return this.open(); }
    catch (error) {
      // Busy, permission, and disk errors are not evidence of corruption. Do
      // not replace an index that another SQLite client may still be using.
      const code = (error as { errcode?: number }).errcode;
      if (!(error instanceof Error && error.message === VERSION_ERROR) &&
          (code === undefined || ![1, 11, 26].includes(code & 255))) throw error;
      // No source data lives here; obsolete or corrupt indexes can be replaced.
      await this.checkFiles();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { await unlink(`${this.path}${suffix}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      return this.open();
    }
  }

  /** Invalidate before changing canonical content; failures leave it untouched. */
  async invalidate(): Promise<void> {
    await this.checkFiles();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { await unlink(`${this.path}${suffix}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  /** Called under the memory-directory lock, including across CLI processes. */
  async search(memories: Memory[], query: string): Promise<string[]> {
    const database = await this.database();
    try {
      const existing = new Map(database.prepare('SELECT id, revision FROM knowledge_fts').all().map(row => [String(row.id), String(row.revision)]));
      const desired = new Set(memories.map(memory => memory.id));
      database.exec('BEGIN IMMEDIATE');
      try {
        const remove = database.prepare('DELETE FROM knowledge_fts WHERE id = ?');
        const insert = database.prepare('INSERT INTO knowledge_fts (id, revision, title, body, applicability, paths, references_text) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const id of existing.keys()) if (!desired.has(id)) remove.run(id);
        for (const memory of memories) {
          if (existing.get(memory.id) === memory.revision) continue;
          remove.run(memory.id);
          insert.run(memory.id, memory.revision, memory.title, memory.body, memory.applicability, memory.paths.join('\n'), memory.references.join('\n'));
        }
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }

      const terms = searchTerms(query);
      const expression = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ');
      const ids = expression ? database.prepare('SELECT id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts, 0, 0, 6, 1, 2, 0.5, 0.5), id').all(expression).map(row => String(row.id)) : [];
      const seen = new Set(ids);
      for (const memory of memories) {
        if (!seen.has(memory.id) && substringMatch(memory, query)) { ids.push(memory.id); seen.add(memory.id); }
      }
      return ids;
    } finally { database.close(); }
  }
}

export function searchSnippet(memory: Memory, query: string): string {
  const terms = searchTerms(query).map(term => term.toLowerCase());
  const body = memory.body.replace(/\s+/g, ' ');
  const lower = body.toLowerCase();
  const found = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = found.length ? Math.max(0, Math.min(...found) - 60) : 0;
  const end = Math.min(body.length, start + 240);
  return `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}
