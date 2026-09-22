import type { HostAdapter } from '../types.js';
import { hookCommand } from '../shared/command.js';
import { MAX_INSTRUCTIONS_BYTES } from '../../runtime/context/limits.js';

const skillDirectory = '.agents/skills';

export const codex = {
  id: 'codex',
  label: 'Codex',
  skillDirectory,
  setupHints: ['In Codex, review the project hooks in /hooks.'],
  artifacts() {
    return ['SessionStart', 'UserPromptSubmit'].map(event => ({
      path: '.codex/hooks.json',
      kind: 'hook' as const, event,
      content: JSON.stringify({
        ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact' } : {}),
        hooks: [{ type: 'command', command: hookCommand(skillDirectory, 'codex'), timeout: 5, statusMessage: 'Loading Stetra context', additionalContextLimit: MAX_INSTRUCTIONS_BYTES }],
      }),
    }));
  },
} as const satisfies HostAdapter;
