import type { VerifierMutation } from '@sovea/stetra-core';

export interface VerifierSurfaceSummary {
  path: string;
  role: VerifierMutation['selector']['role'];
  definitionIds: string[];
}

export function summarizeVerifierSurfaces(
  mutations: VerifierMutation[],
): VerifierSurfaceSummary[] {
  const groups = new Map<string, {
    path: string;
    role: VerifierMutation['selector']['role'];
    definitionIds: Set<string>;
  }>();
  for (const mutation of mutations) {
    const key = `${mutation.changedPath}\0${mutation.selector.role}`;
    const group = groups.get(key) ?? {
      path: mutation.changedPath,
      role: mutation.selector.role,
      definitionIds: new Set<string>(),
    };
    group.definitionIds.add(mutation.definitionId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      path: group.path,
      role: group.role,
      definitionIds: [...group.definitionIds].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path)
      || left.role.localeCompare(right.role));
}
