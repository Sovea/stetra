import { resolve } from 'node:path';

import { Command } from 'commander';

import { resolveBuiltinRoot } from '../paths.ts';
import { inspectProjectInstallation } from '../project/init.ts';
import { getCodeStatus } from '../workflow/change.mjs';
import type { CommandEnvironment } from './shared.ts';

interface StatusOptions {
  checkConfig?: string;
  personalOverlay?: string;
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
      ? 'Check whether the harness is ready for trusted operation'
      : 'Inspect harness installation and source readiness')
    .argument('[project-root]', 'project root', '.')
    .option('--personal-overlay <path>', 'personal should-level overlay')
    .option('--check-config <path>', 'exact check configuration to inspect');
  if (name === 'doctor') {
    command.option('--strict', 'fail when any required readiness condition is unresolved');
  }
  command.action(async (
    projectRootInput: string,
    options: StatusOptions,
    source: Command,
  ) => {
    const projectRoot = resolve(projectRootInput);
    const harness = await getCodeStatus({
      projectRoot,
      personalOverlayPath: options.personalOverlay,
      checkConfigPath: options.checkConfig,
      builtinRoot: resolveBuiltinRoot(),
      productVersion,
      verifyWorktree: name === 'doctor',
    });
    const installation = inspectProjectInstallation(projectRoot);
    const required = [...harness.readiness.required];
    const recommended = [...harness.readiness.recommended];
    const optional = [...harness.readiness.optional];
    if (installation.status === 'absent') {
      required.unshift({
        code: 'cli-adapters-absent',
        message: 'Run `resonant-code init .` to install project-local host adapters.',
      });
    } else if (installation.status !== 'current') {
      required.unshift({
        code: 'cli-installation-drifted',
        message: 'Run `resonant-code init .` to refresh adapter/version drift; use --force only for managed artifacts you intend to replace.',
      });
    }
    const readinessStatus = harness.status === 'blocked'
      ? 'blocked'
      : required.length
        ? 'needs-attention'
        : 'ready';
    const strict = name === 'doctor' && Boolean(options.strict);
    const passed = harness.status !== 'blocked'
      && (!strict || required.length === 0);
    environment.emit(name, {
      status: passed ? 'ok' : 'blocked',
      schemaVersion: harness.schemaVersion,
      command: name,
      strict,
      version: productVersion,
      readiness: {
        status: readinessStatus,
        required,
        recommended,
        optional,
      },
      installation,
      sources: harness.sources,
      controlPlane: harness.controlPlane,
      paths: harness.paths,
    }, source);
  });
}
