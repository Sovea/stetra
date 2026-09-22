import { codex } from './codex/adapter.js';
import { claude } from './claude/adapter.js';
import { pi } from './pi/adapter.js';
import { agents } from './agent-skills/adapter.js';
import type { HostAdapter } from './types.js';

export const adapters = [codex, claude, pi, agents] as const;
export type AdapterId = (typeof adapters)[number]['id'];
export const adapterIds = adapters.map(adapter => adapter.id);
export const adapterRegistry = Object.fromEntries(adapters.map(adapter => [adapter.id, adapter])) as Record<AdapterId, HostAdapter>;
