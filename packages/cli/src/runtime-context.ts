import type { Readable, Writable } from 'node:stream';
import type { HostAdapter } from './project/init.ts';

export interface PromptProvider {
  selectAdapters(input: {
    choices: HostAdapter[];
    defaults: HostAdapter[];
    streams: PromptStreams;
  }): Promise<HostAdapter[]>;
}

export interface PromptStreams {
  input: Readable;
  output: Writable;
}

export interface RunCliOptions {
  input?: Readable;
  output?: Writable;
  interactive?: boolean;
  color?: boolean;
  prompts?: PromptProvider;
}

export interface HostEnvironmentDisclosure {
  surface: 'thin-skill';
  independentChallenge: {
    availability: 'unavailable';
    unavailableBehavior: 'author-handoff-preserving-gap';
  };
  verificationExecution: {
    authoritativeCollector: 'stetra-runtime';
    trigger: 'change-collect';
    processModel: 'frozen-argv-without-shell';
    preparePreflightScope: 'top-level-executable-only';
    directHostExecution: 'agent-evidence-only';
  };
}

export function hostEnvironmentDisclosure(): HostEnvironmentDisclosure {
  return {
    surface: 'thin-skill',
    independentChallenge: {
      availability: 'unavailable',
      unavailableBehavior: 'author-handoff-preserving-gap',
    },
    verificationExecution: {
      authoritativeCollector: 'stetra-runtime',
      trigger: 'change-collect',
      processModel: 'frozen-argv-without-shell',
      preparePreflightScope: 'top-level-executable-only',
      directHostExecution: 'agent-evidence-only',
    },
  };
}

export interface CliRuntimeContext {
  input: Readable;
  output: Writable;
  interactive: boolean;
  color: boolean;
  prompts: PromptProvider;
}

export async function resolveRuntimeContext(
  options: RunCliOptions = {},
): Promise<CliRuntimeContext> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const inputIsTty = Boolean((input as Readable & { isTTY?: boolean }).isTTY);
  const outputIsTty = Boolean((output as Writable & { isTTY?: boolean }).isTTY);
  return {
    input,
    output,
    interactive: options.interactive ?? (
      inputIsTty
      && outputIsTty
      && process.env.CI === undefined
    ),
    color: options.color ?? (
      outputIsTty
      && process.env.NO_COLOR === undefined
    ),
    prompts: options.prompts ?? defaultPromptProvider,
  };
}

const defaultPromptProvider: PromptProvider = {
  async selectAdapters({ choices, defaults, streams }) {
    const { checkbox } = await import('@inquirer/prompts');
    return checkbox<HostAdapter>({
      message: 'Select host adapters to install',
      required: true,
      choices: choices.map((adapter) => ({
        value: adapter,
        name: adapter === 'codex' ? 'Codex' : 'Claude Code',
        checked: defaults.includes(adapter),
      })),
    }, streams);
  },
};
