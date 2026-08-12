import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { ExecutionEnvironment, VerificationDefinition } from '@sovea/stetra-core';

import { resolveExecutable } from '../infrastructure/executable.ts';
import { sha256 } from '../protocol.ts';

const LOCKFILES = [
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Pipfile.lock',
] as const;
const RELEVANT_ENVIRONMENT_NAMES = [
  'CI', 'NODE_ENV', 'npm_config_registry', 'PNPM_HOME', 'COREPACK_HOME',
] as const;

export function collectExecutionEnvironment(
  projectRoot: string,
  definitions: VerificationDefinition[],
): ExecutionEnvironment {
  const commands = [...new Set(definitions.map((definition) => definition.argv[0]))]
    .sort((left, right) => left.localeCompare(right));
  return {
    platform: process.platform,
    architecture: process.arch,
    cwdFingerprint: sha256(projectRoot),
    executables: commands.map((command) => {
      const resolution = resolveExecutable(command, projectRoot);
      return {
        command,
        resolvedPath: resolution.status === 'resolved' ? resolution.path : null,
        version: null,
      };
    }),
    toolchains: [{ name: 'node', version: process.version }],
    lockfiles: LOCKFILES.flatMap((name) => {
      const path = join(projectRoot, name);
      return existsSync(path)
        ? [{ path: basename(path), digest: sha256(readFileSync(path)) }]
        : [];
    }),
    environmentVariableNames: RELEVANT_ENVIRONMENT_NAMES
      .filter((name) => Object.hasOwn(process.env, name))
      .sort((left, right) => left.localeCompare(right)),
  };
}
