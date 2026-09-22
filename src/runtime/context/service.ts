import { MemoryStore } from '../knowledge/store.js';
import type { MemoryRecallResult } from '../knowledge/types.js';
import { StetraError, validate } from '../shared.js';
import { ContextCache } from './cache.js';
import { MAX_CONTEXT_BYTES, MAX_SELECTION } from './limits.js';
import { contextInputSchema, type ContextCacheData, type ContextInput, type ContextResult, type ContextSelection } from './types.js';

function size(value: unknown): number { return Buffer.byteLength(JSON.stringify(value)); }

/** Keep complete records or explicitly omit them; never turn a truncated body into knowledge. */
function bounded(result: ContextResult, maxBytes: number): ContextResult {
  const output: ContextResult = { ...result, knowledge: { memories: [], unavailable: [], issues: [] }, changes: [], omitted: [], omittedCount: result.omittedCount };
  if (size(output) > maxBytes - 1_024) throw new StetraError('invalid', 'The context selection is too large. Narrow the paths or selected knowledge IDs.');
  const append = <T>(array: T[], item: T): boolean => {
    array.push(item);
    if (size(output) <= maxBytes - 200) return true;
    array.pop();
    return false;
  };
  for (const item of result.knowledge.unavailable) {
    if (!append(output.knowledge.unavailable, item)) output.omittedCount++;
  }
  for (const change of result.changes) {
    if (!append(output.changes, change)) output.omittedCount++;
  }
  for (const memory of result.knowledge.memories) {
    if (!append(output.knowledge.memories, memory)) {
      output.omittedCount++;
      append(output.omitted, { id: memory.id, title: memory.title, revision: memory.revision });
    }
  }
  for (const issue of result.knowledge.issues) {
    if (!append(output.knowledge.issues, issue)) output.omittedCount++;
  }
  return output;
}

export class ContextService {
  constructor(private readonly root: string, private readonly memories: MemoryStore) {}

  async read(value: ContextInput = {}, maxBytes = MAX_CONTEXT_BYTES): Promise<ContextResult> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > MAX_CONTEXT_BYTES) throw new StetraError('invalid', 'The context byte budget is outside its supported range.');
    const input = validate(contextInputSchema, value);
    const selecting = input.query !== undefined || input.paths !== undefined || input.ids !== undefined;
    const retrieve = async (previous: ContextCacheData | null) => {
      const paths = selecting ? [...new Set(input.paths ?? [])] : previous?.selection.paths ?? [];
      let ids = selecting ? [...new Set(input.ids ?? [])] : previous?.selection.ids ?? [];
      const issues: MemoryRecallResult['issues'] = [];
      let library: ContextResult['library'];
      if (!selecting && !ids.length && !paths.length) {
        const listed = await this.memories.list();
        library = { activeCount: listed.memories.length };
        issues.push(...listed.issues);
      }
      if (input.query !== undefined) {
        const found = await this.memories.search({ query: input.query, paths, limit: 20 });
        ids = [...new Set([...ids, ...found.matches.map(match => match.memory.id)])];
        issues.push(...found.issues);
      }
      let excess = Math.max(0, ids.length - MAX_SELECTION);
      ids = ids.slice(0, MAX_SELECTION);
      const recall = ids.length || paths.length ? await this.memories.recall({ ids, paths }) : { memories: [], unavailable: [], issues: [] };
      const expandPaths = selecting && input.query === undefined && Boolean(input.paths?.length);
      if (expandPaths) ids = [...new Set([...ids, ...recall.memories.map(memory => memory.id)])];
      excess += Math.max(0, ids.length - MAX_SELECTION);
      ids = ids.slice(0, MAX_SELECTION);
      const selected = new Set(ids);
      const byId = new Map(recall.memories.map(memory => [memory.id, memory]));
      const knowledge: MemoryRecallResult = {
        memories: ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
        unavailable: recall.unavailable.filter(item => selected.has(item.id)),
        issues: [...new Map([...issues, ...recall.issues].map(issue => [`${issue.path}\0${issue.message}`, issue])).values()],
      };
      const changes: ContextResult['changes'] = [];
      for (const [id, revision] of Object.entries(previous?.provided ?? {})) {
        if (!revision) continue;
        const memory = byId.get(id);
        if (!selected.has(id)) changes.push({ id, kind: 'unselected', previousRevision: revision });
        else if (!memory) changes.push({ id, kind: 'unavailable', previousRevision: revision });
        else if (memory.revision !== revision) changes.push({ id, kind: 'updated', previousRevision: revision, revision: memory.revision });
      }
      const selection: ContextSelection = { ids, paths };
      const result = bounded({ projectRoot: this.root, ...(input.session ? { session: input.session } : {}), ...(library ? { library } : {}), selection, knowledge, changes, omitted: [], omittedCount: excess }, maxBytes);
      const provided: ContextCacheData['provided'] = Object.fromEntries(Object.entries(previous?.provided ?? {}).filter(([id]) => selected.has(id)));
      for (const item of result.knowledge.memories) provided[item.id] = item.revision;
      for (const item of result.knowledge.unavailable) provided[item.id] = null;
      return { result, cache: selecting || previous ? { schemaVersion: 1 as const, selection, provided } : null };
    };
    if (!input.session) return (await retrieve(null)).result;
    return new ContextCache(this.root, input.session).update({ create: selecting, reset: input.reset }, retrieve);
  }
}
