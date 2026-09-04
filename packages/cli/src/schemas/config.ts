import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { inputError } from '../errors.ts';
import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION } from '../protocol.ts';
import { parseArtifact } from '../validation.ts';
import { CheckDefinitionInputSchema, StableIdSchema } from './task.ts';

export const DEFAULT_EXECUTION_POLICY = {
  checkTimeoutMs: 300_000,
  maxTimeoutMs: 900_000,
  maxTimeoutRetriesPerCheck: 1,
} as const;

export const ProjectConfigSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  admission: z.enum(['explicit', 'ask', 'required']).default('ask'),
  defaultVerificationProfile: StableIdSchema.nullable().default(null),
  verificationProfiles: z.record(
    StableIdSchema,
    z.strictObject({ checks: z.array(CheckDefinitionInputSchema).min(1) }),
  ).default({}),
  executionPolicy: z.strictObject({
    checkTimeoutMs: z.number().int().positive(),
    maxTimeoutMs: z.number().int().positive(),
    maxTimeoutRetriesPerCheck: z.number().int().nonnegative(),
  }).refine((value) => value.maxTimeoutMs >= value.checkTimeoutMs, {
    message: 'maxTimeoutMs must be at least checkTimeoutMs',
    path: ['maxTimeoutMs'],
  }).refine((value) => value.maxTimeoutRetriesPerCheck === 0
    || value.maxTimeoutMs > value.checkTimeoutMs, {
    message: 'maxTimeoutMs must exceed checkTimeoutMs when timeout retries are enabled',
    path: ['maxTimeoutMs'],
  }).default(DEFAULT_EXECUTION_POLICY),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  protocol: DELEGATION_PROTOCOL,
  schemaVersion: DELEGATION_SCHEMA_VERSION,
  admission: 'ask',
  defaultVerificationProfile: null,
  verificationProfiles: {},
  executionPolicy: { ...DEFAULT_EXECUTION_POLICY },
};

export function readProjectConfig(projectRoot: string): ProjectConfig {
  const path = join(projectRoot, '.stetra', 'config.json');
  if (!existsSync(path)) return structuredClone(DEFAULT_PROJECT_CONFIG);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError(`Failed to parse .stetra/config.json.`, error);
  }
  return parseArtifact(ProjectConfigSchema, value, '.stetra/config.json');
}
