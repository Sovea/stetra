/** Programmatic boundary for Hosts that own Agent lifecycle and tool controls. */
import type { HostAttestationProvider } from './runtime-context.ts';
import {
  guardFinalResponse as guardFinalResponseInternal,
} from './workflow/delegation.ts';

export { runCli } from './main.ts';
export {
  HostChallengeLifecycle,
  type ChallengeHostProvider,
  type ChallengeRunStartObservation,
  type ChallengeRunStopObservation,
} from './host/challenge-lifecycle.ts';
export {
  submitHostAction,
  type SubmitHostActionOptions,
} from './host/submission.ts';
export {
  CliError,
  normalizeCliError,
  type CliErrorCode,
  type CliIssue,
  type ProtocolInputCorrection,
} from './errors.ts';
export {
  formatCliError,
  formatCliOutput,
  type CliExecution,
} from './presentation/output.ts';
export type {
  HostAttestationProvider,
  PromptProvider,
  RunCliOptions,
} from './runtime-context.ts';
export type { AuthoringPacket } from './workflow/authoring.ts';
export type {
  ChallengeCase,
  ChallengeChangedFile,
  ChallengeCheck,
  ChallengeDocumentDraft,
  ChallengeExecutionPacket,
  ChallengeRepositoryEvidence,
  ChallengeRoundDocumentDraft,
} from './workflow/challenge-projection.ts';
export type { ChallengeRoundDocument, HostChallengeRunReceipt } from './schemas/delegation.ts';
export type {
  DeveloperDecisionBrief,
  DeveloperDecisionDetails,
  DeveloperDecisionPrimary,
} from './workflow/decision-brief.ts';
export type {
  ChallengeExecutionRequest,
  HostExecutionRequirements,
  ClarificationBrief,
  FinalResponseGuard,
  HostAction,
  HostWorkflowReference,
} from './workflow/host-action.ts';

export interface FinalResponseGuardOptions {
  projectRoot: string;
  taskId: string;
  knownActionFingerprint?: string;
  hostAttestations?: HostAttestationProvider;
}

/**
 * Re-read the exact task and worktree immediately before a Host responds.
 * This function is read-only; the embedding Host owns enforcement of its result.
 */
export async function guardFinalResponse(
  options: FinalResponseGuardOptions,
) {
  return guardFinalResponseInternal(options);
}
