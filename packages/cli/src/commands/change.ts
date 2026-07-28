import { Command } from 'commander';

import { resolveBuiltinRoot } from '../paths.ts';
import type { GuidancePromptCandidate } from '../runtime-context.ts';
import {
  completeCodeTask,
  explainCodeRun,
  prepareCodeTask,
} from '../workflow/change.mjs';
import type { CommandEnvironment } from './shared.ts';
import { collectOption } from './shared.ts';

interface ChangePrepareOptions {
  avoid: string[];
  changeType: string;
  checkConfig?: string;
  constraint: string[];
  guidanceByteLimit?: string;
  personalOverlay?: string;
  relationFile?: string;
  risk: string;
  scope: string;
  selectionFile?: string;
  target: string[];
  task: string;
  tech: string[];
  uncertainty: string[];
}

interface ChangeCompleteOptions {
  run: string;
}

interface ChangeExplainOptions {
  run: string;
}

export function registerChangeCommands(
  program: Command,
  environment: CommandEnvironment,
  productVersion: string,
): void {
  const change = program
    .command('change')
    .description('Prepare, complete, or explain a coding change lifecycle');

  change
    .command('prepare')
    .description('Compile compact task guidance and snapshot the worktree')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--task <description>', 'concrete coding task')
    .requiredOption('--change-type <type>', 'bugfix, feature, refactor, migration, maintenance, docs, test, or unknown')
    .requiredOption('--target <path>', 'task target (repeatable)', collectOption, [])
    .option('--tech <name>', 'technology in scope (repeatable)', collectOption, [])
    .requiredOption('--risk <level>', 'low, medium, or high')
    .requiredOption('--scope <level>', 'local, module, cross-module, or repository')
    .option('--constraint <text>', 'task constraint (repeatable)', collectOption, [])
    .option('--uncertainty <text>', 'task uncertainty (repeatable)', collectOption, [])
    .option('--avoid <text>', 'task-specific avoid guidance (repeatable)', collectOption, [])
    .option('--relation-file <path>', 'bounded host relation proposals')
    .option('--selection-file <path>', 'explicit optional-guidance selection')
    .option('--guidance-byte-limit <bytes>', 'positive UTF-8 delivery ceiling')
    .option('--personal-overlay <path>', 'personal should-level overlay')
    .option('--check-config <path>', 'explicit check command configuration')
    .action(async (
      projectRoot: string,
      options: ChangePrepareOptions,
      command: Command,
    ) => {
      const prepareOptions = {
        projectRoot,
        taskDescription: options.task,
        changeType: options.changeType,
        targets: options.target,
        techStack: options.tech,
        risk: options.risk,
        scope: options.scope,
        constraints: options.constraint,
        uncertainties: options.uncertainty,
        avoid: options.avoid,
        relationFile: options.relationFile,
        selectionFile: options.selectionFile,
        guidanceByteLimit: options.guidanceByteLimit,
        personalOverlayPath: options.personalOverlay,
        checkConfigPath: options.checkConfig,
        builtinRoot: resolveBuiltinRoot(),
        productVersion,
      };
      let output = await prepareCodeTask(prepareOptions);
      if (
        isGuidanceOverflow(output)
        && output.mandatoryBytes <= output.byteLimit
        && !options.selectionFile
        && environment.shouldPrompt(command)
      ) {
        const selection = await environment.runtime.prompts.selectGuidance({
          candidates: output.selectableConsider as GuidancePromptCandidate[],
          byteLimit: output.byteLimit,
          mandatoryBytes: output.mandatoryBytes,
          streams: {
            input: environment.runtime.input,
            output: environment.runtime.output,
          },
        });
        output = await prepareCodeTask({
          ...prepareOptions,
          deliverySelection: selection,
        });
      }
      environment.emit('change prepare', output, command);
    });

  change
    .command('complete')
    .description('Collect actual diff/check facts and evaluate host attestations')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--run <id>', 'run ID returned by prepare')
    .action(async (
      projectRoot: string,
      options: ChangeCompleteOptions,
      command: Command,
    ) => {
      environment.emit('change complete', await completeCodeTask({
        projectRoot,
        runId: options.run,
        productVersion,
      }), command);
    });

  change
    .command('explain')
    .description('Show the decision and evaluation stored in a run')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--run <id>', 'run ID returned by prepare')
    .action((
      projectRoot: string,
      options: ChangeExplainOptions,
      command: Command,
    ) => {
      environment.emit('change explain', explainCodeRun({
        projectRoot,
        runId: options.run,
      }), command);
    });
}

function isGuidanceOverflow(value: unknown): value is {
  status: 'guidance-overflow';
  mandatoryBytes: number;
  byteLimit: number;
  selectableConsider: GuidancePromptCandidate[];
} {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { status?: unknown }).status === 'guidance-overflow'
    && typeof (value as { mandatoryBytes?: unknown }).mandatoryBytes === 'number'
    && typeof (value as { byteLimit?: unknown }).byteLimit === 'number'
    && Array.isArray((value as { selectableConsider?: unknown }).selectableConsider);
}
