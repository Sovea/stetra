import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { captureGitWorktree } from '../facts/worktree.ts';
import { inspectProjectInstallation } from '../project/init.ts';
import { findLegacyArtifacts } from '../project/legacy.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
} from '../protocol.ts';
import type { CommandEnvironment } from './shared.ts';

interface StatusOptions {
  strict?: boolean;
}

export function registerStatusCommands(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  registerStatusCommand(program, environment, productVersion, 'status');
  registerStatusCommand(program, environment, productVersion, 'doctor');
}

function registerStatusCommand(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
  name: 'doctor' | 'status',
): void {
  const command = program
    .command(name)
    .description(name === 'doctor'
      ? 'Validate the local Cognitive Adoption control plane'
      : 'Inspect Cognitive Adoption installation state')
    .argument('[project-root]', 'project root', '.');
  if (name === 'doctor') command.option('--strict', 'return blocked for unresolved required conditions');
  command.action(async (
    projectRootInput: string,
    options: StatusOptions,
    source: Command,
  ) => {
    const projectRoot = canonicalProjectRoot(projectRootInput);
    const installation = inspectProjectInstallation(projectRoot);
    const legacyArtifacts = findLegacyArtifacts(projectRoot);
    const required: Array<{ code: string; message: string }> = [];
    if (legacyArtifacts.length) {
      required.push({
        code: 'legacy-artifacts-present',
        message: `Archive or remove legacy artifacts explicitly: ${legacyArtifacts.join(', ')}.`,
      });
    } else if (installation.status === 'absent') {
      required.push({
        code: 'host-adapter-absent',
        message: 'Run `stetra init .` to install a generated Host adapter.',
      });
    } else if (installation.status !== 'current') {
      required.push({
        code: 'host-adapter-drifted',
        message: 'Run `stetra init .`; use --force only for owner-modified generated content you intend to replace.',
      });
    }
    let worktree: 'not-checked' | 'supported' | 'unsupported' = 'not-checked';
    if (name === 'doctor') {
      try {
        await captureGitWorktree(projectRoot);
        worktree = 'supported';
      } catch (error) {
        worktree = 'unsupported';
        required.push({
          code: 'git-worktree-unsupported',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const strict = name === 'doctor' && Boolean(options.strict);
    environment.emit(name, {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: strict && required.length ? 'blocked' : 'ok',
      command: name,
      strict,
      version: productVersion,
      readiness: {
        status: required.length ? 'needs-attention' : 'ready',
        required,
        recommended: [],
        optional: [],
      },
      installation,
      worktree,
      controlPlane: {
        kind: 'cli',
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
      },
      paths: {
        manifest: join(projectRoot, '.stetra', 'manifest.json'),
        tasks: join(projectRoot, '.stetra', 'tasks'),
      },
    }, source);
  });
}

function canonicalProjectRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not a directory: ${root}`);
  }
  return realpathSync(root);
}
