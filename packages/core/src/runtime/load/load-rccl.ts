import { existsSync, readFileSync } from 'node:fs';
import { parseRccl } from '../../rccl/runtime.ts';
import type { RcclDocument } from '../../rccl/runtime.ts';

/**
 * Loads RCCL from disk via Core's canonical RCCL parser/normalizer.
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
