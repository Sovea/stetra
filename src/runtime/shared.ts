import { z } from 'zod';

export const idSchema = z.uuid();
export const textSchema = z.string().trim().min(1).max(50_000);
export const titleSchema = z.string().trim().min(1).max(240);
export const sourceSchema = z.enum(['developer', 'agent']);

export const relativePathSchema = z.string().trim().min(1).max(2_000).transform((value, context) => {
  const path = value.replaceAll('\\', '/');
  const parts = path.split('/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || parts.includes('..') || /[\0*?]/.test(path)) {
    context.addIssue({ code: 'custom', message: 'Use a project-relative file or directory path without parent traversal or glob patterns.' });
    return z.NEVER;
  }
  const normalized = parts.filter(part => part !== '' && part !== '.').join('/');
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'Name a project file or directory rather than the project root.' });
    return z.NEVER;
  }
  return normalized;
});

export class StetraError extends Error {
  constructor(public readonly code: 'not_found' | 'conflict' | 'invalid' | 'storage', message: string) {
    super(message);
    this.name = 'StetraError';
  }
}

export function validate<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try { return schema.parse(value); }
  catch (error) { throw new StetraError('invalid', error instanceof Error ? error.message : 'Invalid input.'); }
}
