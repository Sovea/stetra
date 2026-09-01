import { Command } from 'commander';

import { registerChangeCommands } from './commands/change.ts';
import { registerInitCommand } from './commands/init.ts';
import { registerHostCommands } from './commands/host.ts';
import { registerInputCommands } from './commands/input.ts';
import type { CommandEnvironment, GlobalCommandOptions } from './commands/shared.ts';
import { globalOptions } from './commands/shared.ts';
import { registerStatusCommand } from './commands/status.ts';
import type { CliExecution } from './presentation/output.ts';
import {
  hostEnvironmentDisclosure,
  type CliRuntimeContext,
} from './runtime-context.ts';
import { stableFingerprint } from './protocol.ts';
import { PRODUCT_VERSION } from './version.ts';

export interface ProgramState {
  execution?: CliExecution;
}

export interface ProgramOutput {
  writeError(value: string): void;
  writeOutput(value: string): void;
}

export function createProgram(
  runtime: CliRuntimeContext,
  state: ProgramState,
  output: ProgramOutput,
): Command {
  const program = new Command();
  program
    .name('stetra')
    .description('CLI-first control plane for the Stetra change harness')
    .version(PRODUCT_VERSION)
    .option('--json', 'emit a deterministic machine-readable decision packet')
    .option('--no-interactive', 'disable all human prompts')
    .option('--no-color', 'disable ANSI formatting in human output')
    .showHelpAfterError('(add --help for command details)')
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: output.writeOutput,
      writeErr: output.writeError,
    })
    .addHelpText('after', `
The CLI never calls an LLM. Humans own semantic and adoption authority; Host
agents interpret and execute the contract. Runtime validates bounded authority
inputs and machine facts without presenting Agent judgment as human intent or
deterministic fact.

Machine callers should always pass --json. JSON mode never prompts and never
contains ANSI formatting.`);

  const environment: CommandEnvironment = {
    runtime,
    emit(command, result, source) {
      const options = globalOptions(source);
      const json = Boolean(options.json);
      state.execution = {
        output: withActionFingerprint(withHostEnvironment(result)),
        json,
        exitCode: resultExitCode(command, result),
        command,
        color: runtime.color && options.color !== false && !json,
      };
    },
    shouldPrompt(source) {
      const options = source.optsWithGlobals<GlobalCommandOptions>();
      return runtime.interactive
        && options.interactive !== false
        && !options.json;
    },
  };

  registerInitCommand(program, environment);
  registerHostCommands(program, environment);
  registerInputCommands(program, environment);
  registerStatusCommand(program, environment, PRODUCT_VERSION);
  registerChangeCommands(program, environment, PRODUCT_VERSION);
  return program;
}

function withHostEnvironment(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (!isRecord(result.hostAction)
    && result.transport !== 'owned-file'
    && result.status !== 'final-response-guarded') return result;
  return {
    ...result,
    hostEnvironment: hostEnvironmentDisclosure(),
  };
}

function withActionFingerprint(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.hostAction)) return result;
  return {
    ...result,
    actionFingerprint: stableFingerprint(result.hostAction),
  };
}

function resultExitCode(command: string, output: unknown): number {
  if (!isRecord(output)) return 0;
  if (command === 'init' && output.status === 'blocked') return 2;
  if (command === 'status' && output.status === 'needs-attention') return 2;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
