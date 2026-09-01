/** Generated lifecycle Hook fragments; adapter-specific wire config stays here. */
import type { HostAdapter } from './definition.ts';

export interface HostHookFragment {
  hooks: Record<'SessionStart' | 'Stop', Array<Record<string, unknown>>>;
}

export function renderHostHookFragment(adapter: HostAdapter): HostHookFragment {
  const sessionCommand = `stetra host hook --adapter ${adapter} --event session-start --json`;
  const stopCommand = `stetra host hook --adapter ${adapter} --event stop --json`;
  return {
    hooks: {
      SessionStart: [{
        matcher: adapter === 'codex'
          ? 'startup|resume|clear|compact'
          : 'startup|resume|clear|compact|fork',
        hooks: [{
          type: 'command',
          command: sessionCommand,
          timeout: 10,
          ...(adapter === 'codex'
            ? {
                statusMessage: 'Loading Stetra task continuity',
                additionalContextLimit: 2000,
              }
            : {}),
        }],
      }],
      Stop: [{
        hooks: [{
          type: 'command',
          command: stopCommand,
          timeout: 10,
          ...(adapter === 'codex'
            ? { statusMessage: 'Checking Stetra task continuity' }
            : {}),
        }],
      }],
    },
  };
}

export function isStetraHookGroup(value: unknown, adapter: HostAdapter): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hooks = (value as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((handler) => {
    if (!handler || typeof handler !== 'object' || Array.isArray(handler)) return false;
    const command = (handler as { command?: unknown }).command;
    return typeof command === 'string'
      && command.startsWith('stetra host hook ')
      && command.includes(`--adapter ${adapter}`);
  });
}
