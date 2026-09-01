import { Command, InvalidArgumentError } from 'commander';
import type { Readable } from 'node:stream';

import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  explainDelegationTask,
  guardFinalResponse,
  prepareDelegationTask,
  resumeDelegationTask,
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

interface GuardFinalOptions extends TaskOptions {
  knownActionFingerprint?: string;
}

interface ResumeOptions {
  prepareRequest: string;
}

interface TaskInputOptions extends TaskOptions, InputOptions {}

interface CollectOptions extends TaskOptions {
  retryCheck: string[];
  timeoutMs?: number;
  refresh?: boolean;
}

interface ExplainOptions extends TaskOptions {
  section?: string;
  stage?: string;
  part?: string;
  attempt?: string;
  definition?: string;
  disposition?: string;
  event?: string;
  humanEvent?: string;
  evidence?: string;
  materialDecision?: string;
  condition?: string;
  path?: string;
  checkAttempt?: number;
  step?: string;
  stream?: string;
  tailBytes?: number;
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
    .description('Compile the Task Contract, first Attempt, and Git baseline')
    .argument('[project-root]', 'Git worktree root', '.')
    .option('--input <path>', 'Task Contract input JSON path, or - for stdin', '-')
    .action(async (projectRoot: string, options: InputOptions, command: Command) => {
      environment.emit('change prepare', await prepareDelegationTask({
        projectRoot,
        inputPath: options.input,
        input: environment.runtime.input,
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
      'initial timeout for each check; defaults to the prepared task execution budget',
      parseTimeout,
    )
    .option(
      '--retry-check <id=milliseconds>',
      'append a larger-budget retry after a latest timed-out check; repeatable',
      collectOption,
      [],
    )
    .option('--refresh', 'rerun every frozen check even when current facts still match the worktree')
    .action(async (projectRoot: string, options: CollectOptions, command: Command) => {
      environment.emit('change collect', await collectDelegationFacts({
        projectRoot,
        taskId: options.task,
        productVersion,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        retryChecks: options.retryCheck.map(parseRetryCheck),
        refresh: options.refresh ?? false,
      }), command);
    });

  change
    .command('resume')
    .description('Recover the exact current action for one Prepare transport identity')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--prepare-request <id>', 'prepareRequestId returned by input reserve')
    .action((projectRoot: string, options: ResumeOptions, command: Command) => {
      environment.emit('change resume', resumeDelegationTask({
        projectRoot,
        prepareRequestId: options.prepareRequest,
      }), command);
    });

  registerInputStage(change, environment, 'diagnose', 'Judge every mechanical evidence concern and route it without guessing its cause', diagnoseCollectedEvidence);
  registerInputStage(change, environment, 'handoff', 'Evaluate a fact-bound Cognitive Handoff for Human review', evaluateDelegationHandoff);
  registerInputStage(change, environment, 'decide', 'Record the exact Human adoption decision', recordHumanDecision);
  registerInputStage(change, environment, 'resolve', 'Record an exact mid-task Human resolution and continue the lifecycle', resolveHumanChoice);
  registerInputStage(change, environment, 'revise-verification', 'Create an immutable Verification Plan revision and successor Attempt', reviseVerificationPlan);

  change
    .command('guard-final')
    .description('Read the current task state before a Host sends its final response')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by prepare')
    .option('--known-action-fingerprint <sha256>', 'omit an unchanged Host Action already held by the caller')
    .action(async (projectRoot: string, options: GuardFinalOptions, command: Command) => {
      environment.emit('change guard-final', await guardFinalResponse({
        projectRoot,
        taskId: options.task,
        knownActionFingerprint: options.knownActionFingerprint,
      }), command);
    });

  change
    .command('explain')
    .description('Regenerate the current action or inspect durable workflow artifacts')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by prepare')
    .option('--section <name>', 'bounded task view or exact artifact selector', 'index')
    .option('--stage <name>', 'current input stage for action-input inspection')
    .option('--part <name>', 'draft, guide, or schema for action-input inspection', 'guide')
    .option('--attempt <id>', 'exact Attempt identity for attempt-scoped inspection')
    .option('--definition <sha256>', 'exact Verification Definition identity for Check inspection')
    .option('--disposition <sha256>', 'exact Evidence Disposition identity')
    .option('--event <id>', 'exact lifecycle Event identity')
    .option('--human-event <id>', 'exact Human Event identity')
    .option('--evidence <id>', 'exact Repository Evidence identity')
    .option('--material-decision <key>', 'exact Material Decision key')
    .option('--condition <key>', 'exact Condition key')
    .option('--path <path>', 'exact repository-relative baseline path')
    .option('--check-attempt <number>', 'one-based Check execution attempt; defaults to latest', parsePositiveInteger)
    .option('--step <id>', 'exact Check step identity; omit for the aggregate attempt')
    .option('--stream <name>', 'stdout or stderr')
    .option('--tail-bytes <bytes>', 'bounded persisted log tail, at most 65536 bytes', parseLogTailBytes, 8192)
    .action((projectRoot: string, options: ExplainOptions, command: Command) => {
      environment.emit('change explain', explainDelegationTask({
        projectRoot,
        taskId: options.task,
        section: options.section,
        stage: options.stage,
        part: options.part,
        attemptId: options.attempt,
        definitionId: options.definition,
        dispositionId: options.disposition,
        eventId: options.event,
        humanEventId: options.humanEvent,
        repositoryEvidenceId: options.evidence,
        materialDecisionKey: options.materialDecision,
        conditionKey: options.condition,
        repositoryPath: options.path,
        checkAttempt: options.checkAttempt,
        stepId: options.step,
        stream: options.stream,
        tailBytes: options.tailBytes,
      }), command);
    });
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

function parseLogTailBytes(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 65_536) {
    throw new InvalidArgumentError('must be at most 65536');
  }
  return parsed;
}

function registerInputStage(
  change: Command,
  environment: CommandEnvironment,
  name: 'diagnose' | 'handoff' | 'decide' | 'resolve' | 'revise-verification',
  description: string,
  operation: (options: {
    projectRoot: string;
    taskId: string;
    inputPath: string;
    input?: Readable;
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
