import type { Readable, Writable } from 'node:stream';
import type {
  HostPolicyEvaluation,
  HostPolicyRequirement,
} from '@sovea/stetra-core';

import type { HostAdapter } from './project/init.ts';
import type {
  ChallengeExecutionRequest,
} from './workflow/host-action.ts';
import type {
  ChallengeRoundDocument,
  HostChallengeRunReceipt,
} from './schemas/delegation.ts';

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
  hostAttestations?: HostAttestationProvider;
}

export interface HostAttestationProvider {
  provenance: 'native-adapter' | 'evaluation-runner';
  evaluatePolicies(input: {
    taskId: string;
    requirements: HostPolicyRequirement[];
  }): Promise<HostPolicyEvaluation[]>;
  consumeChallengeRun?(input: {
    request: ChallengeExecutionRequest;
    round: ChallengeRoundDocument;
  }): Promise<HostChallengeRunReceipt | undefined>;
}

export interface CliRuntimeContext {
  input: Readable;
  output: Writable;
  interactive: boolean;
  color: boolean;
  prompts: PromptProvider;
  hostAttestations?: HostAttestationProvider;
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
    ...(options.hostAttestations ? { hostAttestations: options.hostAttestations } : {}),
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
