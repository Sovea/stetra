import { existsSync, readFileSync } from 'node:fs';
import { parseRccl } from '@resonant-code/rccl/runtime';
import type { RcclDocument } from '../types.ts';

/**
 * Loads RCCL from disk via the RCCL package's canonical parser/normalizer.
 */
export async function loadRccl(filePath?: string): Promise<RcclDocument | null> {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = parseRccl(readFileSync(filePath, 'utf-8'), { allowVerifiedFields: true });
  if (!parsed.valid || !parsed.data) {
    if (parsed.errors?.some((error) => error.includes("'version' must be"))) {
      throw new Error(`UNSUPPORTED_SCHEMA_VERSION: RCCL must use schema 1. Re-run calibrate-repo-context; ${filePath} was not modified.`);
    }
    throw new Error(`Failed to parse RCCL document: ${parsed.errors?.join('; ') || 'unknown parse error'}`);
  }
  return parsed.data as RcclDocument;
}
