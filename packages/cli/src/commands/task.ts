import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { Command } from 'commander';
import type { z } from 'zod';

import { inputError } from '../errors.ts';
import { bindHostSession } from '../host/session.ts';
import {
  TaskBeginDocumentSchema,
  TaskDecisionDocumentSchema,
  TaskHandoffDocumentSchema,
} from '../schemas/task.ts';
import { parseArtifact } from '../validation.ts';
import {
  beginTask,
  collectTask,
  decideTask,
  handoffTask,
  inspectTask,
} from '../workflow/task.ts';
import type { CommandEnvironment } from './shared.ts';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

interface InputOptions {
  input: string;
}

interface BeginOptions extends InputOptions {
  bindingToken?: string;
}

interface TaskOptions {
  task: string;
}

interface CollectOptions extends TaskOptions {
  retryTimeout?: string;
  timeoutMs?: string;
}

interface TaskInputOptions extends TaskOptions, InputOptions {}

interface InspectOptions extends TaskOptions {
  section: string;
  collection?: string;
  check?: string;
  attempt?: string;
  stream?: string;
  tailBytes?: string;
}

export function registerTaskCommands(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  const task = program.command('task').description('Manage one admitted coding change');

  task.command('begin')
    .description('Align one admitted task and capture its Git baseline')
    .argument('[project-root]', 'Git worktree root', '.')
    .option('--input <path>', 'compact Begin JSON path, or - for stdin', '-')
    .option('--binding-token <token>', 'opaque Host-session token projected by a SessionStart Hook')
    .action(async (projectRoot: string, options: BeginOptions, source: Command) => {
      const document = await readDocument(projectRoot, options.input, environment.runtime.input);
      const result = await beginTask({
        projectRoot,
        source: parseArtifact(TaskBeginDocumentSchema, document, 'Task Begin input'),
        productVersion,
      });
      if (options.bindingToken) {
        bindHostSession({ projectRoot, bindingToken: options.bindingToken, taskId: result.taskId });
      }
      environment.emit('task begin', result, source);
    });

  task.command('collect')
    .description('Collect current Git facts and execute frozen checks')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by task begin')
    .option('--retry-timeout <check-key>', 'retry one currently timed-out Check')
    .option('--timeout-ms <milliseconds>', 'larger bounded timeout for --retry-timeout')
    .action(async (projectRoot: string, options: CollectOptions, source: Command) => {
      const retryTimeout = parseTimeoutRetry(options);
      environment.emit('task collect', await collectTask({
        projectRoot,
        taskId: options.task,
        productVersion,
        ...(retryTimeout ? { retryTimeout } : {}),
      }), source);
    });

  registerInputStage(task, environment, 'handoff', TaskHandoffDocumentSchema, async (input) =>
    handoffTask(input));
  registerInputStage(task, environment, 'decide', TaskDecisionDocumentSchema, async (input) =>
    decideTask(input));

  task.command('inspect')
    .description('Inspect a bounded task view')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by task begin')
    .option('--section <name>', 'summary, contract, baseline, collections, collection, check, log, handoff, decision, or events', 'summary')
    .option('--collection <id>', 'Fact Collection ID; defaults to current')
    .option('--check <key>', 'readable Check key for check or log detail')
    .option('--attempt <number>', 'Check Attempt number; defaults to latest')
    .option('--stream <name>', 'stdout or stderr for log detail')
    .option('--tail-bytes <number>', 'maximum trailing log bytes, up to 65536', '16384')
    .action(async (projectRoot: string, options: InspectOptions, source: Command) => {
      environment.emit('task inspect', await inspectTask({
        projectRoot,
        taskId: options.task,
        section: options.section,
        collectionId: options.collection,
        checkKey: options.check,
        attempt: optionalPositiveInteger(options.attempt, '--attempt'),
        stream: optionalStream(options.stream),
        tailBytes: boundedTailBytes(options.tailBytes),
      }), source);
    });
}

function optionalPositiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw inputError(`${option} must be a positive safe integer.`);
  return parsed;
}

function optionalStream(value: string | undefined): 'stdout' | 'stderr' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'stdout' && value !== 'stderr') throw inputError('--stream must be stdout or stderr.');
  return value;
}

function boundedTailBytes(value: string | undefined): number {
  const parsed = Number(value ?? 16_384);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_536) {
    throw inputError('--tail-bytes must be an integer from 1 through 65536.');
  }
  return parsed;
}

function parseTimeoutRetry(options: CollectOptions): { checkKey: string; timeoutMs: number } | undefined {
  if (!options.retryTimeout && !options.timeoutMs) return undefined;
  if (!options.retryTimeout || !options.timeoutMs) {
    throw inputError('--retry-timeout and --timeout-ms must be supplied together.');
  }
  const timeoutMs = Number(options.timeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw inputError('--timeout-ms must be a positive safe integer.');
  }
  return { checkKey: options.retryTimeout, timeoutMs };
}

function registerInputStage<Schema extends z.ZodType>(
  task: Command,
  environment: CommandEnvironment,
  name: 'handoff' | 'decide',
  schema: Schema,
  operation: (input: {
    projectRoot: string;
    taskId: string;
    source: z.output<Schema>;
  }) => Promise<unknown>,
): void {
  task.command(name)
    .description(name === 'handoff'
      ? 'Bind a compact actual-change explanation to current facts'
      : 'Record a new exact Human adoption decision')
    .argument('[project-root]', 'Git worktree root', '.')
    .requiredOption('--task <id>', 'task ID returned by task begin')
    .option('--input <path>', `compact ${name} JSON path, or - for stdin`, '-')
    .action(async (projectRoot: string, options: TaskInputOptions, source: Command) => {
      const document = await readDocument(projectRoot, options.input, environment.runtime.input);
      environment.emit(`task ${name}`, await operation({
        projectRoot,
        taskId: options.task,
        source: parseArtifact(schema, document, `Task ${name} input`),
      }), source);
    });
}

async function readDocument(projectRootInput: string, path: string, input: Readable): Promise<unknown> {
  let text: string;
  if (path === '-') {
    text = await readBoundedStream(input);
  } else {
    const projectRoot = realpathSync(resolve(projectRootInput));
    const candidate = resolve(path);
    if (!existsSync(candidate)) throw inputError(`Input file does not exist: ${candidate}`);
    const canonical = realpathSync(candidate);
    const rel = relative(projectRoot, canonical);
    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) {
      throw inputError('Task semantic input must use stdin or a file outside the project worktree.');
    }
    const bytes = readFileSync(canonical);
    if (bytes.length > MAX_INPUT_BYTES) throw inputError(`Task input exceeds ${MAX_INPUT_BYTES} bytes.`);
    text = bytes.toString('utf8');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw inputError('Task input is not valid JSON.', error);
  }
}

async function readBoundedStream(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += value.length;
    if (bytes > MAX_INPUT_BYTES) throw inputError(`Task input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
