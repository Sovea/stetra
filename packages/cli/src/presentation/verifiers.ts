import type { VerifierMutation } from '@sovea/stetra-core';

export interface VerifierSurfaceSummary {
  path: string;
  role: VerifierMutation['role'];
  checkIds: string[];
}

export function summarizeVerifierSurfaces(
  mutations: VerifierMutation[],
): VerifierSurfaceSummary[] {
  const groups = new Map<string, {
    path: string;
    role: VerifierMutation['role'];
    checkIds: Set<string>;
  }>();
  for (const mutation of mutations) {
    const key = `${mutation.path}\0${mutation.role}`;
    const group = groups.get(key) ?? {
      path: mutation.path,
      role: mutation.role,
      checkIds: new Set<string>(),
    };
    group.checkIds.add(mutation.checkId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      path: group.path,
      role: group.role,
      checkIds: [...group.checkIds].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path)
      || left.role.localeCompare(right.role));
}
