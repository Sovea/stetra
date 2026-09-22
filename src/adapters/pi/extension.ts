import { MAX_INSTRUCTIONS_BYTES } from '../../runtime/context/limits.js';

type PiContext = {
  hasUI: boolean;
  ui: { notify(message: string, type?: 'info' | 'warning' | 'error'): void };
  sessionManager: { getSessionId(): string };
};
type Lifecycle = 'session_start' | 'session_compact' | 'before_agent_start' | 'session_shutdown';

// Only the native lifecycle, context, and command-execution APIs are needed.
export interface PiHost {
  on(event: Lifecycle, handler: (event: unknown, context: PiContext) => void | Promise<void>): void;
  on(event: 'context', handler: (event: { messages: unknown[] }, context: PiContext) => Promise<{ messages: unknown[] }>): void;
  exec(command: string, args: string[], options: { timeout: number }): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }>;
}

export function activate(pi: PiHost, options: { cliPath: string; projectRoot: string }): void {
  let sessionId: string | undefined;
  let contextText = '';
  let generation = 0;
  let refreshContext = true;
  let loading: { generation: number; promise: Promise<void> } | undefined;
  let subprocess: Promise<unknown> = Promise.resolve();

  function invalidate(): void {
    generation++;
    contextText = '';
    refreshContext = true;
  }

  function selectSession(context: PiContext): void {
    const id = context.sessionManager.getSessionId();
    if (sessionId !== id) { sessionId = id; invalidate(); }
  }

  pi.on('session_start', (_event, context) => { selectSession(context); invalidate(); });
  pi.on('session_compact', invalidate);
  pi.on('before_agent_start', invalidate);
  pi.on('session_shutdown', () => { sessionId = undefined; invalidate(); });

  pi.on('context', async (event, context) => {
    selectSession(context);
    const epoch = generation;
    const currentId = sessionId!;
    // Replace the transient model-context message without changing the transcript.
    const messages = event.messages.filter(message => !(message && typeof message === 'object'
      && 'role' in message && message.role === 'custom'
      && 'customType' in message && message.customType === 'stetra-context'));
    if (refreshContext) {
      refreshContext = false;
      const promise = subprocess.then(async () => {
        if (epoch !== generation) return;
        try {
          const result = await pi.exec(process.execPath, [options.cliPath, 'context', '--instructions', '--host', 'pi', '--session', currentId, '--project', options.projectRoot], { timeout: 5_000 });
          if (epoch !== generation || context.sessionManager.getSessionId() !== currentId) return;
          if (result.code !== 0 || result.killed) throw new Error('The Stetra context command failed.');
          const output: unknown = JSON.parse(result.stdout);
          if (!output || typeof output !== 'object' || !('text' in output) || typeof output.text !== 'string') {
            throw new Error('The Stetra context command returned an invalid response.');
          }
          if (Buffer.byteLength(output.text) > MAX_INSTRUCTIONS_BYTES) throw new Error('The Stetra context exceeds the size limit.');
          contextText = output.text;
        } catch (error) {
          if (epoch === generation && context.hasUI) context.ui.notify(`Stetra context could not be loaded: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        }
      });
      loading = { generation: epoch, promise };
      subprocess = promise;
    }
    if (loading?.generation === epoch) await loading.promise;
    if (epoch === generation && context.sessionManager.getSessionId() === currentId && contextText) {
      messages.push({ role: 'custom', customType: 'stetra-context', display: false, content: contextText, timestamp: Date.now() });
    }
    return { messages };
  });
}
