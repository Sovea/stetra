import { Command } from 'commander';

import { registerBootstrapCommands } from './commands/bootstrap.ts';
import { registerChangeCommands } from './commands/change.ts';
import { registerContextCommands } from './commands/context.ts';
import { registerInitCommand } from './commands/init.ts';
import type { CommandEnvironment, GlobalCommandOptions } from './commands/shared.ts';
import { globalOptions } from './commands/shared.ts';
import { registerStatusCommands } from './commands/status.ts';
import type { CliExecution } from './presentation/output.ts';
import type { CliRuntimeContext } from './runtime-context.ts';
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
    .name('resonant-code')
    .description('CLI-first control plane for the resonant-code change harness')
    .version(PRODUCT_VERSION)
    .option('--json', 'emit the complete machine-readable result')
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
The CLI never calls an LLM. Humans own semantic authority; Host agents
interpret and execute it. Runtime and RCCL validate bounded inputs and machine
facts without presenting Agent judgment as human intent or deterministic fact.

Machine callers should always pass --json. JSON mode never prompts and never
contains ANSI formatting.`);

  const environment: CommandEnvironment = {
    runtime,
    emit(command, result, source) {
      const options = globalOptions(source);
      const json = Boolean(options.json);
      state.execution = {
        output: result,
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
  registerStatusCommands(program, environment, PRODUCT_VERSION);
  registerBootstrapCommands(program, environment);
  registerChangeCommands(program, environment, PRODUCT_VERSION);
  registerContextCommands(program, environment);
  return program;
}

function resultExitCode(command: string, output: unknown): number {
  if (!isRecord(output)) return 0;
  if (command === 'init' && output.status === 'blocked') return 2;
  if (command === 'bootstrap commit' && output.status === 'exists') return 2;
  if (command === 'doctor' && output.status === 'blocked') return 2;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
