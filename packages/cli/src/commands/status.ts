import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { captureGitWorktree } from '../facts/worktree.ts';
import { inspectProjectInstallation } from '../project/init.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
} from '../protocol.ts';
import type { CommandEnvironment } from './shared.ts';

export function registerStatusCommand(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  const command = program
    .command('status')
    .description('Validate the local Stetra installation and Git worktree')
    .argument('[project-root]', 'project root', '.');
  command.action(async (
    projectRootInput: string,
    _options: Record<string, never>,
    source: Command,
  ) => {
    const projectRoot = canonicalProjectRoot(projectRootInput);
    const installation = inspectProjectInstallation(projectRoot);
    const issues: Array<{ code: string; message: string }> = [];
    if (installation.status === 'absent') {
      issues.push({
        code: 'host-adapter-absent',
        message: 'Run `stetra init .` to install a generated Host adapter.',
      });
    } else if (installation.status !== 'current') {
      issues.push({
        code: 'host-adapter-drifted',
        message: 'Run `stetra init .`; use --force only for owner-modified generated content you intend to replace.',
      });
    }
    let worktree: { status: 'supported' | 'unsupported'; message?: string };
    try {
      await captureGitWorktree(projectRoot);
      worktree = { status: 'supported' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      worktree = { status: 'unsupported', message };
      issues.push({ code: 'git-worktree-unsupported', message });
    }
    environment.emit('status', {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: issues.length ? 'needs-attention' : 'ready',
      command: 'status',
      version: productVersion,
      issues,
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
