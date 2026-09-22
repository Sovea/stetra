import { z } from 'zod';
import { idSchema, StetraError } from './shared.js';
import { memoryInputSchema, memoryRecallSchema, memorySearchSchema } from './knowledge/types.js';

export const memoryRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), includeWithdrawn: z.boolean().optional(), allScopes: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('read'), memoryId: idSchema }).strict(),
  memorySearchSchema.extend({ action: z.literal('search') }),
  memoryRecallSchema.extend({ action: z.literal('recall') }),
  z.object({ action: z.literal('create'), memory: memoryInputSchema }).strict(),
  z.object({ action: z.literal('update'), memoryId: idSchema, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), memory: memoryInputSchema }).strict(),
  z.object({ action: z.literal('delete'), memoryId: idSchema, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export const operationNames = ['memory'] as const;
export type OperationName = typeof operationNames[number];

export function requestSchema(operation: OperationName, action?: string): z.ZodType {
  if (operation !== 'memory') throw new StetraError('invalid', 'Unknown operation domain.');
  if (!action) return memoryRequestSchema;
  const schema = memoryRequestSchema.options.find(option => option.shape.action.value === action);
  if (!schema) throw new StetraError('invalid', `Unknown memory action: ${action}.`);
  return schema;
}
