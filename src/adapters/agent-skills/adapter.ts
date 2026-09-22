import type { HostAdapter } from '../types.js';

export const agents = {
  id: 'agents',
  label: 'Agent Skills (.agents/skills)',
  skillDirectory: '.agents/skills',
} as const satisfies HostAdapter;
