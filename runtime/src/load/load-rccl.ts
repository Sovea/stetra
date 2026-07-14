import { existsSync, readFileSync } from 'node:fs';
import { parseRccl } from '@resonant-code/rccl/runtime';
import type { RcclDocument } from '@resonant-code/rccl/runtime';

/**
 * Loads RCCL from disk via the RCCL package's canonical parser/normalizer.
 */
export async function loadRccl(filePath?: string): Promise<RcclDocument | null> {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = parseRccl(readFileSync(filePath, 'utf-8'));
  if (!parsed.valid || !parsed.data) {
    if (parsed.errors?.some((error) => error.includes('UNSUPPORTED_SCHEMA_VERSION'))) {
      throw new Error(`UNSUPPORTED_SCHEMA_VERSION: RCCL does not match the current schema. Re-run calibrate-repo-context; ${filePath} was not modified.`);
    }
    throw new Error(`Failed to parse RCCL document: ${parsed.errors?.join('; ') || 'unknown parse error'}`);
  }
  return parsed.data;
}
