import { CommanderError } from 'commander';

import { normalizeCliError, usageError } from './errors.ts';
import { createProgram, type ProgramState } from './program.ts';
import type { CliExecution } from './presentation/output.ts';
import {
  resolveRuntimeContext,
  type RunCliOptions,
} from './runtime-context.ts';

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<CliExecution> {
  const runtime = await resolveRuntimeContext(options);
  const state: ProgramState = {};
  let commandOutput = '';
  let commandError = '';
  const program = createProgram(runtime, state, {
    writeOutput(value) {
      commandOutput += value;
    },
    writeError(value) {
      commandError += value;
    },
  });

  if (!argv.length) {
    return {
      output: program.helpInformation().trimEnd(),
      json: false,
      exitCode: 0,
      command: 'help',
      color: false,
    };
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed'
        || error.code === 'commander.version'
      ) {
        return {
          output: commandOutput.trimEnd(),
          json: false,
          exitCode: 0,
          command: error.code === 'commander.version' ? 'version' : 'help',
          color: false,
        };
      }
      throw usageError(
        normalizeCommanderMessage(commandError || error.message),
        error,
      );
    }
    throw normalizeCliError(error);
  }

  if (state.execution) return state.execution;
  return {
    output: commandOutput.trimEnd() || program.helpInformation().trimEnd(),
    json: false,
    exitCode: 0,
    command: 'help',
    color: false,
  };
}

function normalizeCommanderMessage(value: string): string {
  return value
    .trim()
    .replace(/^error:\s*/i, '');
}
