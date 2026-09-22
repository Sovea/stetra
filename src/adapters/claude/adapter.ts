import type { HostAdapter } from '../types.js';
import { hookCommand } from '../shared/command.js';

const skillDirectory = '.claude/skills';

export const claude = {
  id: 'claude',
  label: 'Claude Code',
  skillDirectory,
  artifacts() {
    return ['SessionStart', 'UserPromptSubmit'].map(event => ({
      path: '.claude/settings.json',
      kind: 'hook' as const, event,
      content: JSON.stringify({
        ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact|fork' } : {}),
        hooks: [{ type: 'command', command: hookCommand(skillDirectory, 'claude'), timeout: 5 }],
      }),
    }));
  },
} as const satisfies HostAdapter;
