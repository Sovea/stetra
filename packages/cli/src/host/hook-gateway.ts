/** Provider-neutral lifecycle Hook gateway over exact Host-session binding. */
import { z } from 'zod';

import type { HostAdapter } from '../adapters/definition.ts';
import { inputError } from '../errors.ts';
import { guardFinalResponse } from '../workflow/delegation.ts';
import type { FinalResponseGuard } from '../workflow/host-action.ts';
import { parseArtifact } from '../validation.ts';
import {
  claimActionDelivery,
  ensureHostPrepareReservation,
  ensureHostSession,
  hostTaskExists,
  pendingPrepareFingerprint,
  readHostSession,
  resolveInstalledProjectRoot,
  type HostSession,
} from './session-bridge.ts';

export type HostHookEvent = 'session-start' | 'stop';

const HostHookInputSchema = z.object({
  session_id: z.string().min(1).max(1024),
  cwd: z.string().min(1),
  hook_event_name: z.enum(['SessionStart', 'Stop']),
}).loose();

export interface HostHookResult {
  projectRoot?: string;
  adapter: HostAdapter;
  event: HostHookEvent;
  wireOutput: Record<string, unknown>;
}

export async function handleHostHook(input: {
  adapter: HostAdapter;
  event: HostHookEvent;
  payload: unknown;
}): Promise<HostHookResult> {
  const payload = parseArtifact(HostHookInputSchema, input.payload, 'Host Hook input');
  const expectedEvent = input.event === 'session-start' ? 'SessionStart' : 'Stop';
  if (payload.hook_event_name !== expectedEvent) {
    throw inputError(`Host Hook input event must be ${expectedEvent}.`);
  }
  const projectRoot = resolveInstalledProjectRoot(payload.cwd);
  if (!projectRoot) {
    return { adapter: input.adapter, event: input.event, wireOutput: {} };
  }
  if (input.event === 'session-start') {
    const session = ensureHostSession({
      projectRoot,
      adapter: input.adapter,
      sessionId: payload.session_id,
    });
    const context = await sessionContext(projectRoot, session);
    return {
      projectRoot,
      adapter: input.adapter,
      event: input.event,
      wireOutput: renderAdditionalContext(expectedEvent, context),
    };
  }

  const session = readHostSession({
    projectRoot,
    adapter: input.adapter,
    sessionId: payload.session_id,
  });
  if (!session || session.bindingState === 'available') {
    return { projectRoot, adapter: input.adapter, event: input.event, wireOutput: {} };
  }
  const guarded = await guardSessionStop(projectRoot, session);
  return {
    projectRoot,
    adapter: input.adapter,
    event: input.event,
    wireOutput: guarded,
  };
}

async function sessionContext(projectRoot: string, session: HostSession): Promise<string> {
  if (session.bindingState === 'available') {
    return [
      'Stetra lifecycle continuity is available for this Host session.',
      'For a production coding change, start the task-scoped Stetra workflow before implementation.',
      `Run this exact argv: ${JSON.stringify([
        'stetra', 'host', 'begin', projectRoot,
        '--adapter', session.adapter,
        '--binding-token', session.bindingToken,
        '--json',
      ])}`,
      'Do not use Stetra for unrelated conversation-only work.',
    ].join('\n');
  }
  if (!hostTaskExists(projectRoot, session.taskId)) {
    return prepareInstruction(projectRoot, session);
  }
  const guard = await guardFinalResponse({ projectRoot, taskId: session.taskId });
  if (guard.disposition === 'human-decision-recorded') {
    return `Stetra task ${session.taskId} has a recorded Human decision; no workflow continuation is required.`;
  }
  return guardInstruction(projectRoot, guard);
}

async function guardSessionStop(
  projectRoot: string,
  session: Extract<HostSession, { bindingState: 'task-bound' }>,
): Promise<Record<string, unknown>> {
  if (!hostTaskExists(projectRoot, session.taskId)) {
    const fingerprint = pendingPrepareFingerprint(session);
    const firstDelivery = claimActionDelivery({ projectRoot, session, actionFingerprint: fingerprint });
    const message = prepareInstruction(projectRoot, session);
    return firstDelivery ? renderStopContinuation(message) : renderRepeatedWarning(message);
  }
  const guard = await guardFinalResponse({ projectRoot, taskId: session.taskId });
  if (guard.disposition === 'human-decision-recorded') return {};
  const firstDelivery = claimActionDelivery({
    projectRoot,
    session,
    actionFingerprint: guard.actionFingerprint,
  });
  const message = guardInstruction(projectRoot, guard);
  if (guard.disposition === 'present-decision-brief') {
    return firstDelivery ? renderStopPresentation(message) : {};
  }
  return firstDelivery ? renderStopContinuation(message) : renderRepeatedWarning(message);
}

function prepareInstruction(
  projectRoot: string,
  session: Extract<HostSession, { bindingState: 'task-bound' }>,
): string {
  const prepared = ensureHostPrepareReservation(projectRoot, session);
  return [
    `Stetra Prepare ${session.prepareRequestId} is bound to this Host session but has not created task ${session.taskId}.`,
    `Complete the prefilled Draft at ${prepared.reservation.path}.`,
    `Run this exact argv: ${JSON.stringify(withProjectRoot(prepared.submit.argv, projectRoot))}`,
    'If the Runtime requests an exact developer clarification, present it and wait; do not invent the answer.',
  ].join('\n');
}

function guardInstruction(projectRoot: string, guard: FinalResponseGuard): string {
  const action = guard.hostAction;
  if (guard.disposition === 'present-decision-brief') {
    return [
      `Stetra task ${guard.taskId} is ready for a Human adoption decision.`,
      'Present developerDecisionBrief.primary as plain text in the final response.',
      'State that adoption is pending, ask the developer to accept, request correction, reject, or defer, and then stop.',
      'Do not invoke an interactive input tool; only a later developer message can authorize the decision.',
      `Reload canonical current detail when needed with argv: ${JSON.stringify([
        'stetra', 'change', 'guard-final', projectRoot,
        '--task', guard.taskId, '--json',
      ])}`,
    ].join('\n');
  }
  const lines = [
    `Stetra task ${guard.taskId} is not ready to end: ${guard.disposition}.`,
    `Current action: ${action?.kind ?? 'reload-current-action'}.`,
  ];
  if (action?.reference) lines.push(`Ensure the generated ${action.reference} reference is available.`);
  if (action?.inputBinding) {
    lines.push(`Reserve the projected Draft with argv: ${JSON.stringify(
      withProjectRoot(action.inputBinding.reserve.argv, projectRoot),
    )}`);
  }
  if (action?.command) {
    lines.push(`Then run the exact action argv: ${JSON.stringify(
      withProjectRoot(action.command.argv, projectRoot),
    )}`);
  }
  lines.push(`Reload canonical current detail when needed with argv: ${JSON.stringify([
    'stetra', 'change', 'guard-final', projectRoot,
    '--task', guard.taskId, '--json',
  ])}`);
  return lines.join('\n');
}

function withProjectRoot(argv: string[], projectRoot: string): string[] {
  const output = [...argv];
  const commandRootIndex = output.findIndex((value, index) => index >= 3 && value === '.');
  if (commandRootIndex >= 0) output[commandRootIndex] = projectRoot;
  return output;
}

function renderAdditionalContext(
  hookEventName: 'SessionStart' | 'Stop',
  additionalContext: string,
): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

function renderStopContinuation(reason: string): Record<string, unknown> {
  return { decision: 'block', reason };
}

function renderStopPresentation(message: string): Record<string, unknown> {
  return { systemMessage: message };
}

function renderRepeatedWarning(message: string): Record<string, unknown> {
  return {
    systemMessage: `Stetra already delivered this unchanged action once; the Host may stop, but the task remains pending.\n${message}`,
  };
}
