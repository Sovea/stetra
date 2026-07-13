import type { CalibrationSlice, IndexedFile, RepoRepresentation, SamplingPolicy } from '../types.ts';
import { DEFAULT_SAMPLING_POLICY } from '../policies.ts';
import { extractWindowsForFiles } from './extract-windows.ts';

export function planSlices(
  projectRoot: string,
  indexedFiles: IndexedFile[],
  representation: RepoRepresentation,
  policy: SamplingPolicy = DEFAULT_SAMPLING_POLICY,
): CalibrationSlice[] {
  const fileMap = new Map(indexedFiles.map((file) => [file.path, file]));
  const slices: CalibrationSlice[] = [];

  if (policy.target_coverage.roots) {
    for (const root of representation.roots.slice(0, 2)) {
      const files = indexedFiles.filter((file) => file.package_root === root.root).slice(0, policy.max_files_per_slice);
      slices.push(makeSlice(projectRoot, `root:${root.root}`, 'root', files, `Representative files from root ${root.root}`, 1.0, policy));
    }
  }

  if (policy.target_coverage.modules) {
    for (const module of representation.modules.slice(0, 3)) {
      const files = module.file_paths.map((path) => fileMap.get(path)).filter((value): value is IndexedFile => Boolean(value)).slice(0, policy.max_files_per_slice);
      slices.push(makeSlice(projectRoot, module.id, 'module', files, `Representative files from module cluster ${module.base_path}`, 0.9, policy));
    }
  }

  if (policy.target_coverage.boundaries) {
    for (const boundary of representation.boundaries.slice(0, 1)) {
      const files = boundary.file_paths.map((path) => fileMap.get(path)).filter((value): value is IndexedFile => Boolean(value)).slice(0, policy.max_files_per_slice);
      slices.push(makeSlice(projectRoot, boundary.id, 'boundary', files, boundary.reason, 0.85, policy));
    }
  }

  if (policy.target_coverage.migrations) {
    for (const migration of representation.migrations.slice(0, 1)) {
      const files = migration.file_paths.map((path) => fileMap.get(path)).filter((value): value is IndexedFile => Boolean(value)).slice(0, policy.max_files_per_slice);
      slices.push(makeSlice(projectRoot, migration.id, 'migration', files, migration.reason, 0.8, policy));
    }
  }

  if (policy.target_coverage.style_clusters) {
    for (const cluster of representation.style_clusters.slice(0, 1)) {
      const files = cluster.file_paths.map((path) => fileMap.get(path)).filter((value): value is IndexedFile => Boolean(value)).slice(0, policy.max_files_per_slice);
      slices.push(makeSlice(projectRoot, cluster.id, 'style-cluster', files, cluster.reason, 0.75, policy));
    }
  }

  return roundRobinByKind(slices.filter((slice) => slice.files.length > 0 && slice.windows.length > 0))
    .slice(0, policy.max_slices);
}

function roundRobinByKind(slices: CalibrationSlice[]): CalibrationSlice[] {
  const kinds: CalibrationSlice['kind'][] = ['root', 'module', 'boundary', 'migration', 'style-cluster'];
  const queues = new Map(kinds.map((kind) => [kind, slices.filter((slice) => slice.kind === kind)]));
  const result: CalibrationSlice[] = [];
  while ([...queues.values()].some((queue) => queue.length)) {
    for (const kind of kinds) {
      const next = queues.get(kind)?.shift();
      if (next) result.push(next);
    }
  }
  return result;
}

function makeSlice(
  projectRoot: string,
  id: string,
  kind: CalibrationSlice['kind'],
  files: IndexedFile[],
  rationale: string,
  coverage_weight: number,
  policy: SamplingPolicy,
): CalibrationSlice {
  return {
    id,
    kind,
    files: files.map((file) => file.path),
    rationale,
    coverage_weight,
    windows: extractWindowsForFiles(projectRoot, files, policy),
  };
}
