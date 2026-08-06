import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { inputError } from '../errors.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
} from '../protocol.ts';

const OBSOLETE_STETRA_PATHS = [
  '.stetra/playbook',
  '.stetra/rccl.yaml',
  '.stetra/checks.json',
  '.agents/skills/stetra/references/bootstrap.md',
  '.agents/skills/stetra/references/context.md',
  '.claude/skills/stetra/references/bootstrap.md',
  '.claude/skills/stetra/references/context.md',
] as const;

const RENAMED_PRODUCT_PATHS = [
  '.resonant-code',
  '.agents/skills/resonant-code',
  '.claude/skills/resonant-code',
] as const;

const RENAMED_PRODUCT_MARKERS = [
  { path: 'AGENTS.md', marker: '<!-- resonant-code:begin -->' },
  { path: 'CLAUDE.md', marker: '<!-- resonant-code:begin -->' },
  { path: '.gitignore', marker: '# resonant-code:begin' },
] as const;

export function findLegacyArtifacts(projectRootInput: string): string[] {
  const projectRoot = resolve(projectRootInput);
  const found: string[] = [
    ...OBSOLETE_STETRA_PATHS,
    ...RENAMED_PRODUCT_PATHS,
  ].filter((path) => existsSync(join(projectRoot, path)));
  for (const { path, marker } of RENAMED_PRODUCT_MARKERS) {
    const absolutePath = join(projectRoot, path);
    if (containsMarker(absolutePath, marker)) {
      found.push(path);
    }
  }
  const manifestPath = join(projectRoot, '.stetra', 'manifest.json');
  if (existsSync(manifestPath) && !isCurrentManifest(manifestPath)) {
    found.push('.stetra/manifest.json');
  }
  return [...new Set(found)].sort((left, right) => left.localeCompare(right));
}

export function assertNoLegacyArtifacts(projectRoot: string): void {
  const paths = findLegacyArtifacts(projectRoot);
  if (!paths.length) return;
  throw inputError(
    'Legacy Stetra or Resonant Code artifacts are not compatible with this clean-break installation. '
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

function containsMarker(path: string, marker: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(marker);
  } catch {
    return false;
  }
}
