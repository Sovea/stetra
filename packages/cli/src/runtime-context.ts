import type { Readable, Writable } from 'node:stream';

import type { HostAdapter } from './project/init.ts';

export interface GuidancePromptCandidate {
  id: string;
  instruction: string;
  bytes: number;
  source?: {
    kind?: string;
    id?: string;
  };
}

export interface PromptProvider {
  selectAdapters(input: {
    choices: HostAdapter[];
    defaults: HostAdapter[];
    streams: PromptStreams;
  }): Promise<HostAdapter[]>;
  selectGuidance(input: {
    candidates: GuidancePromptCandidate[];
    byteLimit: number;
    mandatoryBytes: number;
    streams: PromptStreams;
  }): Promise<{ considerIds: string[]; rationale: string }>;
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

  async selectGuidance({
    candidates,
    byteLimit,
    mandatoryBytes,
    streams,
  }) {
    const { checkbox, input } = await import('@inquirer/prompts');
    const availableBytes = Math.max(0, byteLimit - mandatoryBytes);
    const considerIds = await checkbox<string>({
      message: `Select optional guidance to deliver (${availableBytes} bytes available)`,
      choices: candidates.map((candidate) => ({
        value: candidate.id,
        name: `${candidate.id} · ${candidate.bytes} bytes`,
        description: candidate.instruction,
        checked: false,
      })),
    }, streams);
    const rationale = await input({
      message: 'Explain why this optional guidance set fits the task',
      required: true,
      validate: (value) => value.trim()
        ? true
        : 'A non-empty rationale is required.',
    }, streams);
    return { considerIds, rationale: rationale.trim() };
  },
};
