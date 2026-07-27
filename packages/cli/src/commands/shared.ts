import type { Command } from 'commander';

import type { CliRuntimeContext } from '../runtime-context.ts';

export interface CommandEnvironment {
  runtime: CliRuntimeContext;
  emit(command: string, output: unknown, source: Command): void;
  shouldPrompt(source: Command): boolean;
}

export interface GlobalCommandOptions {
  color?: boolean;
  interactive?: boolean;
  json?: boolean;
}

export function globalOptions(command: Command): GlobalCommandOptions {
  return command.optsWithGlobals<GlobalCommandOptions>();
}

export function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
