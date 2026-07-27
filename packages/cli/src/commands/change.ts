import { Command } from 'commander';

import { resolveBuiltinRoot } from '../paths.ts';
import type { GuidancePromptCandidate } from '../runtime-context.ts';
import {
  completeCodeTask,
  explainCodeSession,
  prepareCodeTask,
} from '../workflow/change.mjs';
import type { CommandEnvironment } from './shared.ts';
import { collectOption } from './shared.ts';

interface ChangePrepareOptions {
  avoid: string[];
  changeType?: string;
  checkConfig?: string;
  constraint: string[];
  guidanceByteLimit?: string;
  mode?: string;
  personalOverlay?: string;
  relationFile?: string;
  risk?: string;
  scope?: string;
  selectionFile?: string;
  target: string[];
  task: string;
  tech: string[];
  uncertainty: string[];
}

interface ChangeCompleteOptions {
  evaluationFile?: string;
  session: string;
}

interface ChangeExplainOptions {
  session: string;
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
    .option('--mode <standard|strict>', 'guidance mode')
    .option('--change-type <type>', 'bugfix, feature, refactor, migration, maintenance, docs, test, or unknown')
    .option('--target <path>', 'task target (repeatable)', collectOption, [])
    .option('--tech <name>', 'technology in scope (repeatable)', collectOption, [])
    .option('--risk <level>', 'low, medium, or high')
    .option('--scope <level>', 'local, module, cross-module, or repository')
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
        guidanceMode: options.mode,
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
    .requiredOption('--session <path>', 'prepare session path')
    .option('--evaluation-file <path>', 'host attestations and approved exceptions')
    .action(async (options: ChangeCompleteOptions, command: Command) => {
      environment.emit('change complete', await completeCodeTask({
        sessionPath: options.session,
        evaluationFile: options.evaluationFile,
        productVersion,
      }), command);
    });

  change
    .command('explain')
    .description('Show the decision and evaluation stored in a session')
    .requiredOption('--session <path>', 'prepare session path')
    .action((options: ChangeExplainOptions, command: Command) => {
      environment.emit('change explain', explainCodeSession({
        sessionPath: options.session,
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
