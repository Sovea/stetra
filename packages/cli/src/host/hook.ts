import { z } from 'zod';

import type { HostAdapter } from '../adapters/definition.ts';
import { inputError } from '../errors.ts';
import { stableFingerprint } from '../protocol.ts';
import { readProjectConfig } from '../schemas/config.ts';
import { parseArtifact } from '../validation.ts';
import { taskContext } from '../workflow/task.ts';
import {
  claimDirective,
  ensureHostSession,
  readHostSession,
  resolveInstalledProjectRoot,
} from './session.ts';

export type HostHookEvent = 'session-start' | 'stop';

const HostHookInputSchema = z.object({
  session_id: z.string().min(1).max(1024),
  cwd: z.string().min(1),
  hook_event_name: z.enum(['SessionStart', 'Stop']),
}).loose();

export async function handleHostHook(input: {
  adapter: HostAdapter;
  event: HostHookEvent;
  payload: unknown;
}): Promise<Record<string, unknown>> {
  const payload = parseArtifact(HostHookInputSchema, input.payload, 'Host Hook input');
  const expected = input.event === 'session-start' ? 'SessionStart' : 'Stop';
  if (payload.hook_event_name !== expected) {
    throw inputError(`Host Hook input event must be ${expected}.`);
  }
  const projectRoot = resolveInstalledProjectRoot(payload.cwd);
  if (!projectRoot) return {};
  if (input.event === 'session-start') {
    const session = ensureHostSession({
      projectRoot,
      adapter: input.adapter,
      sessionId: payload.session_id,
    });
    return additionalContext(expected, session.taskId
      ? boundContext(projectRoot, session.taskId)
      : admissionContext(projectRoot, session.bindingToken));
  }
  const session = readHostSession({
    projectRoot,
    adapter: input.adapter,
    sessionId: payload.session_id,
  });
  if (!session?.taskId) return {};
  const context = taskContext(projectRoot, session.taskId);
  if (context.phase === 'complete') return {};
  if (context.phase === 'awaiting-decision') {
    return {
      systemMessage: [
        `Stetra task ${context.taskId} awaits the developer's adoption decision.`,
        `Present the current brief with: stetra task inspect ${JSON.stringify(projectRoot)} --task ${context.taskId} --section handoff --json`,
        'Ask the developer to accept, request correction, reject, or defer, then stop.',
      ].join('\n'),
    };
  }
  const message = boundContext(projectRoot, context.taskId);
  const fingerprint = stableFingerprint({ taskId: context.taskId, phase: context.phase, directive: context.directive });
  const first = claimDirective({ projectRoot, session, fingerprint });
  return first
    ? { decision: 'block', reason: message }
    : { systemMessage: `Stetra already surfaced this unchanged task state once; stopping is allowed, but the task remains ${context.phase}.\n${message}` };
}

function admissionContext(projectRoot: string, bindingToken: string): string {
  const config = readProjectConfig(projectRoot);
  const admission = config.admission === 'ask'
    ? 'For a coding task, ask once whether the developer wants a Stetra-managed change. Do nothing for conversation-only work.'
    : config.admission === 'required'
      ? 'Project policy requires coding tasks to use Stetra. Do nothing for conversation-only work.'
      : 'Start Stetra only when the developer explicitly requests it.';
  return [
    `Stetra task admission is ${config.admission}.`,
    admission,
    'When a task is admitted, prepare the compact Begin input and call task begin before editing.',
    `Add this opaque option to that command: --binding-token ${bindingToken}`,
    'Do not read or author Stetra canonical artifacts.',
  ].join('\n');
}

function boundContext(projectRoot: string, taskId: string): string {
  const context = taskContext(projectRoot, taskId);
  const command = context.phase === 'working'
    ? `stetra task collect ${JSON.stringify(projectRoot)} --task ${taskId} --json`
    : context.phase === 'awaiting-handoff'
      ? `stetra task handoff ${JSON.stringify(projectRoot)} --task ${taskId} --input - --json`
      : `stetra task inspect ${JSON.stringify(projectRoot)} --task ${taskId} --json`;
  return [
    `Stetra task ${taskId} is ${context.phase}.`,
    context.directive.message,
    `Portable command: ${command}`,
  ].join('\n');
}

function additionalContext(
  hookEventName: 'SessionStart' | 'Stop',
  content: string,
): Record<string, unknown> {
  return { hookSpecificOutput: { hookEventName, additionalContext: content } };
}
