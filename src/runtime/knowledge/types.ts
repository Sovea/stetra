import { z } from 'zod';
import { idSchema, relativePathSchema, sourceSchema, textSchema, titleSchema } from '../shared.js';
export { relativePathSchema } from '../shared.js';

export const memoryScopeSchema = z.object({ kind: z.literal('project') }).strict();
export const memoryInputSchema = z.object({
  title: titleSchema,
  body: textSchema,
  source: sourceSchema,
  scope: memoryScopeSchema.default({ kind: 'project' }),
  status: z.enum(['active', 'withdrawn']).default('active'),
  references: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
  kind: z.enum(['constraint', 'decision', 'observation', 'hypothesis']).default('observation'),
  applicability: z.string().trim().max(10_000).default(''),
  paths: z.array(relativePathSchema).max(50).default([]),
}).strict();
export type MemoryInput = z.input<typeof memoryInputSchema>;
export type MemoryContent = z.output<typeof memoryInputSchema>;

// Old task-scoped files remain inspectable, but new knowledge cannot depend on
// a retired task identity or silently acquire project-wide applicability.
export const memoryReadSchema = memoryInputSchema.extend({
  scope: z.discriminatedUnion('kind', [
    memoryScopeSchema,
    z.object({ kind: z.literal('task'), taskId: idSchema }).strict(),
  ]),
});
export type Memory = z.output<typeof memoryReadSchema> & { id: string; revision: string; path: string };
export type MemorySummary = Omit<Memory, 'body'>;
export type MemoryIssue = { path: string; message: string };
export type MemoryListing = { memories: MemorySummary[]; issues: MemoryIssue[] };

export const memorySearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  paths: z.array(relativePathSchema).max(50).optional(),
  includeWithdrawn: z.boolean().optional(),
  allScopes: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export type MemorySearchOptions = z.input<typeof memorySearchSchema>;
export type MemorySearchResult = { matches: { memory: MemorySummary; snippet: string }[]; issues: MemoryIssue[] };

export const memoryRecallSchema = z.object({
  paths: z.array(relativePathSchema).max(50).optional(),
  ids: z.array(idSchema).max(100).optional(),
}).strict();
export type MemoryRecallOptions = z.input<typeof memoryRecallSchema>;
export type MemoryRecallResult = { memories: Memory[]; unavailable: { id: string; reason: string }[]; issues: MemoryIssue[] };

/** A directory scope matches itself and descendants, never a sibling prefix. */
export function matchesPaths(memoryPaths: readonly string[], requestedPaths: readonly string[]): boolean {
  return memoryPaths.some(scope => requestedPaths.some(path => path === scope || path.startsWith(`${scope}/`)));
}

export function memorySummary(memory: Memory): MemorySummary {
  const { body: _body, ...summary } = memory;
  return summary;
}
