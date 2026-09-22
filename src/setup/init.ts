import { z } from 'zod';
import { adapterIds, adapterRegistry, type AdapterId } from '../adapters/registry.js';
import { StetraError } from '../runtime/shared.js';
import type { InstallArtifact } from './artifacts.js';
import { planInstallation, readInstallation } from './installation.js';
import { sharedArtifacts } from './resources.js';

const adapterSchema = z.enum(adapterIds);

export interface InitOptions {
  adapters?: string[];
  dryRun?: boolean;
  force?: boolean;
}

export function installedAdapters(root: string): AdapterId[] {
  const previous = readInstallation(root);
  return z.array(adapterSchema).parse(previous?.adapters ?? []);
}

export async function initializeProject(root: string, options: InitOptions = {}) {
  const installed = installedAdapters(root);
  const requested = z.array(adapterSchema).parse(options.adapters ?? []);
  const selected = [...new Set([...installed, ...requested])].sort();
  if (!selected.length) throw new StetraError('invalid', 'Select at least one integration before initializing this project.');
  return planInstallation(root, selected, await projectArtifacts(selected), options);
}

export async function projectArtifacts(selected: readonly AdapterId[]): Promise<InstallArtifact[]> {
  const adapters = selected.map(id => adapterRegistry[id]);
  const artifacts = await sharedArtifacts(adapters);
  for (const adapter of adapters) artifacts.push(...adapter.artifacts?.() ?? []);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}
