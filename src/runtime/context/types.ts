import { z } from 'zod';
import { idSchema, relativePathSchema } from '../shared.js';
import type { MemoryRecallResult } from '../knowledge/types.js';
import { MAX_SELECTION } from './limits.js';

export const sessionKeySchema = z.object({
  host: z.enum(['codex', 'claude', 'pi', 'agents']),
  sessionId: z.string().trim().min(1).max(256),
}).strict();
export type SessionKey = z.infer<typeof sessionKeySchema>;

export const contextInputSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  paths: z.array(relativePathSchema).max(50).optional(),
  ids: z.array(idSchema).max(MAX_SELECTION).optional(),
  session: sessionKeySchema.optional(),
  reset: z.boolean().default(false),
}).strict().refine(input => !input.reset || Boolean(input.session), 'Reset requires a Host and session identity.');
export type ContextInput = z.input<typeof contextInputSchema>;
export type ContextSelection = { ids: string[]; paths: string[] };

export const contextCacheSchema = z.object({
  schemaVersion: z.literal(1),
  selection: z.object({
    ids: z.array(idSchema).max(MAX_SELECTION),
    paths: z.array(relativePathSchema).max(50),
  }).strict(),
  provided: z.record(idSchema, z.string().regex(/^[a-f0-9]{64}$/).nullable()),
}).strict().refine(cache => Object.keys(cache.provided).every(id => cache.selection.ids.includes(id)), 'Cached revisions must belong to the current selection.');
export type ContextCacheData = z.infer<typeof contextCacheSchema>;
export type ContextChange = { id: string; kind: 'updated' | 'unavailable' | 'unselected'; previousRevision: string; revision?: string };
export type ContextResult = {
  projectRoot: string;
  session?: SessionKey;
  library?: { activeCount: number };
  selection: ContextSelection;
  knowledge: MemoryRecallResult;
  changes: ContextChange[];
  omitted: { id: string; title: string; revision: string }[];
  omittedCount: number;
};
