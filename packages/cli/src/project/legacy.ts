import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { inputError } from '../errors.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
} from '../protocol.ts';

const LEGACY_PATHS = [
  '.resonant-code/playbook',
  '.resonant-code/rccl.yaml',
  '.resonant-code/checks.json',
  '.agents/skills/resonant-code/references/bootstrap.md',
  '.agents/skills/resonant-code/references/context.md',
  '.claude/skills/resonant-code/references/bootstrap.md',
  '.claude/skills/resonant-code/references/context.md',
] as const;

export function findLegacyArtifacts(projectRootInput: string): string[] {
  const projectRoot = resolve(projectRootInput);
  const found: string[] = LEGACY_PATHS.filter((path) =>
    existsSync(join(projectRoot, path)));
  const manifestPath = join(projectRoot, '.resonant-code', 'manifest.json');
  if (existsSync(manifestPath) && !isCurrentManifest(manifestPath)) {
    found.push('.resonant-code/manifest.json');
  }
  return [...new Set(found)].sort((left, right) => left.localeCompare(right));
}

export function assertNoLegacyArtifacts(projectRoot: string): void {
  const paths = findLegacyArtifacts(projectRoot);
  if (!paths.length) return;
  throw inputError(
    'Legacy resonant-code artifacts are not compatible with the semantic-delegation protocol. '
    + `Archive or remove them explicitly before continuing: ${paths.join(', ')}.`,
  );
}

function isCurrentManifest(path: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return value.protocol === DELEGATION_PROTOCOL
      && value.schemaVersion === DELEGATION_SCHEMA_VERSION;
  } catch {
    return false;
  }
}
