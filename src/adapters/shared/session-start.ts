import { contextInstructions } from '../../runtime/context.js';
import { errorDetails } from '../../runtime/workspace.js';

export async function sessionStart(input: unknown, cliPath?: string, projectRoot?: string, host: 'codex' | 'claude' = 'codex'): Promise<Record<string, unknown>> {
  if (!input || typeof input !== 'object') return {};
  const event = input as Record<string, unknown>;
  if (!['SessionStart', 'UserPromptSubmit'].includes(String(event.hook_event_name)) || typeof event.cwd !== 'string') return {};
  const session = typeof event.session_id === 'string' && event.session_id.trim()
    ? { host, sessionId: event.session_id } : undefined;
  const { text } = await contextInstructions(projectRoot ?? event.cwd, cliPath, session);
  return { hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: text } };
}

export async function safeSessionStart(input: unknown, cliPath?: string, projectRoot?: string, host: 'codex' | 'claude' = 'codex'): Promise<Record<string, unknown>> {
  try { return await sessionStart(input, cliPath, projectRoot, host); }
  catch (error) {
    process.stderr.write(`Stetra context could not be loaded: ${errorDetails(error).message}\n`);
    return {};
  }
}
