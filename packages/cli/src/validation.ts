import type { z } from 'zod';

import { validationError } from './errors.ts';

export function parseArtifact<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  label: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(label, result.error);
  return result.data;
}
