import { Command, InvalidArgumentError } from 'commander';
import type { Readable } from 'node:stream';

import { DEFAULT_CHECK_TIMEOUT_MS } from '../facts/checks.ts';
import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  explainDelegationTask,
  prepareDelegationTask,
  recordChallenge,
  recordHumanDecision,
  resolveHumanChoice,
  reviseVerificationPlan,
  type CheckTimeoutRetry,
} from '../workflow/delegation.ts';
import { collectOption, type CommandEnvironment } from './shared.ts';

interface InputOptions {
  input: string;
}

interface TaskOptions {
  task: string;
}

interface TaskInputOptions extends TaskOptions, InputOptions {}

interface CollectOptions extends TaskOptions {
  retryCheck: string[];
  timeoutMs?: number;
}

interface ExplainOptions extends TaskOptions {
  section?: string;
}

export function registerChangeCommands(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  const change = program
    .command('change')
    .description('Run the task-scoped Cognitive Adoption workflow');

  change
    .command('prepare')
    .description('Compile the Task Contract, plan, first Attempt, and Git baseline')
    .argument('[project-root]', 'Git worktree root', '.')
    .option('--input <path>', 'Task Contract input JSON path, or - for stdin', '-')
    .action(async (projectRoot: string, options: InputOptions, command: Command) => {
      environment.emit('change prepare', await prepareDelegationTask({
        projectRoot,
        inputPath: options.input,
        input: environment.runtime.input,
        hostAttestations: environment.runtime.hostAttestations,
        productVersion,
      }), command);
    });

  change
    .command('collect')
    .description('Run frozen checks and collect complete pre-check and post-check facts')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by prepare')
    .option(
      '--timeout-ms <milliseconds>',
      `initial timeout for each check; defaults to ${DEFAULT_CHECK_TIMEOUT_MS} ms`,
      parseTimeout,
    )
    .option(
      '--retry-check <id=milliseconds>',
      'append a larger-budget retry after a latest timed-out check; repeatable',
      collectOption,
      [],
    )
    .action(async (projectRoot: string, options: CollectOptions, command: Command) => {
      environment.emit('change collect', await collectDelegationFacts({
        projectRoot,
        taskId: options.task,
        productVersion,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        retryChecks: options.retryCheck.map(parseRetryCheck),
      }), command);
    });

  registerInputStage(change, environment, 'diagnose', 'Judge every non-passing check and route evidence without guessing its cause', diagnoseCollectedEvidence);
  registerInputStage(change, environment, 'challenge', 'Record a fresh-context challenge bound to current facts', recordChallenge);
  registerInputStage(change, environment, 'handoff', 'Evaluate a fact-bound Cognitive Handoff for Human review', evaluateDelegationHandoff);
  registerInputStage(change, environment, 'decide', 'Record the exact Human adoption decision', recordHumanDecision);
  registerInputStage(change, environment, 'resolve', 'Record an exact mid-task Human resolution and continue the lifecycle', resolveHumanChoice);
  registerInputStage(change, environment, 'revise-verification', 'Create an immutable Verification Plan revision and successor Attempt', reviseVerificationPlan);

  change
    .command('explain')
    .description('Inspect contract, plan, Attempts, challenges, handoff, decision, or events')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by prepare')
    .option('--section <name>', 'contract, plan, attempts, challenge, revision, handoff, decision, events, or all', 'all')
    .action((projectRoot: string, options: ExplainOptions, command: Command) => {
      environment.emit('change explain', explainDelegationTask({
        projectRoot,
        taskId: options.task,
        section: options.section,
      }), command);
    });
}

function registerInputStage(
  change: Command,
  environment: CommandEnvironment,
  name: 'diagnose' | 'challenge' | 'handoff' | 'decide' | 'resolve' | 'revise-verification',
  description: string,
  operation: (options: {
    projectRoot: string;
    taskId: string;
    inputPath: string;
    input?: Readable;
    hostAttestations?: CommandEnvironment['runtime']['hostAttestations'];
  }) => Promise<unknown>,
): void {
  change
    .command(name)
    .description(description)
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by prepare')
    .option('--input <path>', `${name} input JSON path, or - for stdin`, '-')
    .action(async (projectRoot: string, options: TaskInputOptions, command: Command) => {
      environment.emit(`change ${name}`, await operation({
        projectRoot,
        taskId: options.task,
        inputPath: options.input,
        input: environment.runtime.input,
        hostAttestations: environment.runtime.hostAttestations,
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
