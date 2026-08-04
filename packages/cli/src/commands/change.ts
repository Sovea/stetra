import { Command } from 'commander';

import {
  collectDelegationFacts,
  explainDelegationRun,
  finalizeDelegationHandoff,
  prepareDelegationTask,
} from '../workflow/delegation.ts';
import type { CommandEnvironment } from './shared.ts';

interface PrepareOptions {
  input: string;
}

interface RunOptions {
  run: string;
}

interface ExplainOptions extends RunOptions {
  section?: string;
}

export function registerChangeCommands(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  const change = program
    .command('change')
    .description('Prepare, collect, finalize, or explain a Semantic Handoff run');

  change
    .command('prepare')
    .description('Compile the Semantic Contract and freeze the Git worktree baseline')
    .argument('[project-root]', 'Git worktree root', '.')
    .option('--input <path>', 'Semantic Contract input JSON path, or - for stdin', '-')
    .action(async (
      projectRoot: string,
      options: PrepareOptions,
      command: Command,
    ) => {
      environment.emit('change prepare', await prepareDelegationTask({
        projectRoot,
        inputPath: options.input,
        input: environment.runtime.input,
        productVersion,
      }), command);
    });

  change
    .command('collect')
    .description('Run frozen checks and collect the complete actual change')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--run <id>', 'run ID returned by prepare')
    .action(async (
      projectRoot: string,
      options: RunOptions,
      command: Command,
    ) => {
      environment.emit('change collect', await collectDelegationFacts({
        projectRoot,
        runId: options.run,
        productVersion,
      }), command);
    });

  change
    .command('finalize')
    .description('Validate fact currency and evaluate the Cognitive Handoff')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--run <id>', 'run ID returned by prepare')
    .action(async (
      projectRoot: string,
      options: RunOptions,
      command: Command,
    ) => {
      environment.emit('change finalize', await finalizeDelegationHandoff({
        projectRoot,
        runId: options.run,
      }), command);
    });

  change
    .command('explain')
    .description('Inspect the exact contract, facts, handoff, and evaluation')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--run <id>', 'run ID returned by prepare')
    .option('--section <name>', 'contract, facts, handoff, evaluation, presentation, or all', 'all')
    .action((
      projectRoot: string,
      options: ExplainOptions,
      command: Command,
    ) => {
      environment.emit('change explain', explainDelegationRun({
        projectRoot,
        runId: options.run,
        section: options.section,
      }), command);
    });
}
