import { Command } from 'commander';

import { resolveBuiltinRoot } from '../paths.ts';
import { commitInit, prepareInit } from '../workflow/bootstrap.mjs';
import type { CommandEnvironment } from './shared.ts';

interface BootstrapPrepareOptions {
  debugArtifacts?: boolean;
}

interface BootstrapCommitOptions extends BootstrapPrepareOptions {
  force?: boolean;
  input: string;
}

export function registerBootstrapCommands(
  program: Command,
  environment: CommandEnvironment,
): void {
  const bootstrap = program
    .command('bootstrap')
    .description('Prepare and commit a host-assisted team Playbook bootstrap');

  bootstrap
    .command('prepare')
    .description('Prepare the bounded host interpretation contract')
    .argument('[project-root]', 'project root', '.')
    .option('--debug-artifacts', 'write inspectable prompt artifacts')
    .action((
      projectRoot: string,
      options: BootstrapPrepareOptions,
      command: Command,
    ) => {
      environment.emit('bootstrap prepare', prepareInit({
        projectRoot,
        builtinRoot: resolveBuiltinRoot(),
        debugArtifacts: Boolean(options.debugArtifacts),
      }), command);
    });

  bootstrap
    .command('commit')
    .description('Validate a host candidate and write the local Playbook augment')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--input <candidate.json|->', 'host-selected layer candidate')
    .option('--force', 'replace an existing local augment explicitly')
    .option('--debug-artifacts', 'write inspectable lifecycle artifacts')
    .action((
      projectRoot: string,
      options: BootstrapCommitOptions,
      command: Command,
    ) => {
      environment.emit('bootstrap commit', commitInit({
        projectRoot,
        builtinRoot: resolveBuiltinRoot(),
        input: options.input,
        force: Boolean(options.force),
        debugArtifacts: Boolean(options.debugArtifacts),
      }), command);
    });
}
