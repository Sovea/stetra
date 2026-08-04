import { Command, InvalidArgumentError } from 'commander';

import { DEFAULT_CHECK_TIMEOUT_MS } from '../facts/checks.ts';
import {
  collectDelegationFacts,
  explainDelegationRun,
  finalizeDelegationHandoff,
  prepareDelegationTask,
  type CheckTimeoutRetry,
} from '../workflow/delegation.ts';
import { collectOption, type CommandEnvironment } from './shared.ts';

interface PrepareOptions {
  input: string;
}

interface RunOptions {
  run: string;
}

interface CollectOptions extends RunOptions {
  retryCheck: string[];
  timeoutMs?: number;
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
    .option(
      '--timeout-ms <milliseconds>',
      `initial timeout for each check; Runtime defaults to ${DEFAULT_CHECK_TIMEOUT_MS} ms`,
      parseTimeout,
    )
    .option(
      '--retry-check <id=milliseconds>',
      'retry a latest timed-out check in the same run with a larger timeout; repeatable',
      collectOption,
      [],
    )
    .action(async (
      projectRoot: string,
      options: CollectOptions,
      command: Command,
    ) => {
      environment.emit('change collect', await collectDelegationFacts({
        projectRoot,
        runId: options.run,
        productVersion,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        retryChecks: options.retryCheck.map(parseRetryCheck),
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

function parseTimeout(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError('timeout must be a positive integer in milliseconds');
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new InvalidArgumentError('timeout must be a positive safe integer in milliseconds');
  }
  return timeoutMs;
}

function parseRetryCheck(value: string): CheckTimeoutRetry {
  const separator = value.lastIndexOf('=');
  if (separator < 1 || separator === value.length - 1) {
    throw new InvalidArgumentError('retry check must use <check-id>=<milliseconds>');
  }
  return {
    checkId: value.slice(0, separator),
    timeoutMs: parseTimeout(value.slice(separator + 1)),
  };
}
