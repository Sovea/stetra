import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { inputError } from '../errors.ts';
import { runCli } from '../main.ts';
import type { CliExecution } from '../presentation/output.ts';
import type { HostAttestationProvider } from '../runtime-context.ts';
import type { AuthoringPacket } from '../workflow/authoring.ts';
import type { ChallengeExecutionPacket } from '../workflow/challenge-projection.ts';
import type { HostAction } from '../workflow/host-action.ts';

type DecisionContinuation = NonNullable<HostAction['decisionContinuation']>;

export interface SubmitHostActionOptions {
  /** The current Host Action, or its explicitly selected decisionContinuation. */
  action: HostAction | DecisionContinuation;
  /** The completed document derived from the action's projected draft. */
  document: unknown;
  /** The target repository. The generated `.` argv is rebound to this exact path. */
  projectRoot: string;
  hostAttestations?: HostAttestationProvider;
}

/**
 * Submit one projected Host document directly to the CLI parser.
 *
 * This path never uses a shell, PTY, temporary file, or reconstructed command.
 * The Runtime still validates lifecycle currency and the complete document.
 */
export async function submitHostAction(
  options: SubmitHostActionOptions,
): Promise<CliExecution> {
  const command = options.action.command;
  const binding = options.action.inputBinding;
  if (!command || !binding) {
    throw inputError(
      'The selected Host Action has no one-shot stdin submission. Select its explicit input action or decisionContinuation.',
    );
  }
  if (
    binding.transport !== 'stdin'
    || binding.serialization !== 'json'
    || binding.execution !== 'one-shot'
  ) {
    throw inputError('The selected Host Action does not use the supported one-shot JSON stdin binding.');
  }

  const parsed = parseProjectedCommand(command.argv);
  validateProjectedSource(options.action, binding.source, parsed.stage, parsed.taskId);
  if (!options.projectRoot.trim()) throw inputError('projectRoot must be a non-empty repository path.');

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(options.document);
  } catch (error) {
    throw inputError('The Host document must be JSON-serializable.', error);
  }
  if (serialized === undefined) throw inputError('The Host document must be a JSON value.');

  return runCli([
    'change', parsed.stage, resolve(options.projectRoot),
    '--task', parsed.taskId, '--input', '-', '--json',
  ], {
    input: Readable.from([serialized], { encoding: 'utf8' }),
    interactive: false,
    color: false,
    ...(options.hostAttestations ? { hostAttestations: options.hostAttestations } : {}),
  });
}

const INPUT_KIND_BY_STAGE = {
  diagnose: 'diagnosis',
  'revise-verification': 'verification-revision',
  challenge: 'challenge-round',
  handoff: 'handoff',
  decide: 'decision',
  resolve: 'resolution',
} as const;

type InputStage = keyof typeof INPUT_KIND_BY_STAGE;

function parseProjectedCommand(argv: string[]): { stage: InputStage; taskId: string } {
  if (
    argv.length !== 9
    || argv[0] !== 'stetra'
    || argv[1] !== 'change'
    || !Object.hasOwn(INPUT_KIND_BY_STAGE, argv[2])
    || argv[3] !== '.'
    || argv[4] !== '--task'
    || !argv[5]
    || argv[6] !== '--input'
    || argv[7] !== '-'
    || argv[8] !== '--json'
  ) {
    throw inputError('The Host Action command is not an exact Stetra one-shot input projection.');
  }
  return { stage: argv[2] as InputStage, taskId: argv[5] };
}

function validateProjectedSource(
  action: HostAction | DecisionContinuation,
  source: NonNullable<HostAction['inputBinding']>['source'],
  stage: InputStage,
  taskId: string,
): void {
  const expectedKind = INPUT_KIND_BY_STAGE[stage];
  const packet: AuthoringPacket | ChallengeExecutionPacket | undefined =
    source === 'authoringPacket.draft'
      ? action.authoringPacket
      : 'challengeExecutionPacket' in action ? action.challengeExecutionPacket : undefined;
  if (!packet) throw inputError(`The Host Action is missing ${source}.`);
  if (packet.inputKind !== expectedKind) {
    throw inputError(`The Host Action stage ${stage} does not match its projected ${packet.inputKind} input.`);
  }
  if (packet.bindsTo.taskId !== taskId) {
    throw inputError('The Host Action command and projected input bind to different tasks.');
  }
}
