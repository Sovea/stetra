/** Concrete paths and labels for generated Host surfaces. */

export const HOST_ADAPTERS = ['codex', 'claude'] as const;
export type HostAdapter = typeof HOST_ADAPTERS[number];

export interface HostAdapterDefinition {
  id: HostAdapter;
  displayName: string;
  skillRoot: string;
  pointerDocument: 'AGENTS.md' | 'CLAUDE.md';
  hookConfigurationPath: string;
}

const DEFINITIONS: Record<HostAdapter, HostAdapterDefinition> = {
  codex: {
    id: 'codex',
    displayName: 'Codex',
    skillRoot: '.agents/skills/stetra',
    pointerDocument: 'AGENTS.md',
    hookConfigurationPath: '.codex/hooks.json',
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    skillRoot: '.claude/skills/stetra',
    pointerDocument: 'CLAUDE.md',
    hookConfigurationPath: '.claude/settings.json',
  },
};

export function hostAdapterDefinition(adapter: HostAdapter): HostAdapterDefinition {
  return DEFINITIONS[adapter];
}

export function hostAdapterDefinitions(adapters: HostAdapter[]): HostAdapterDefinition[] {
  return adapters.map(hostAdapterDefinition);
}
