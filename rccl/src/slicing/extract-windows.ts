import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CalibrationWindow, IndexedFile, SamplingPolicy } from '../calibration-types.ts';

const DEFAULT_SAMPLING_POLICY: SamplingPolicy = {
  max_slices: 8,
  max_files_per_slice: 4,
  max_windows_per_file: 3,
  target_coverage: {
    roots: true,
    modules: true,
    boundaries: true,
    migrations: true,
    style_clusters: true,
  },
};

export function extractWindowsForFiles(
  projectRoot: string,
  files: IndexedFile[],
  policy: SamplingPolicy = DEFAULT_SAMPLING_POLICY,
): CalibrationWindow[] {
  const windows: CalibrationWindow[] = [];
  for (const file of files.slice(0, policy.max_files_per_slice)) {
    const content = readSafe(projectRoot, file.path);
    if (!content) continue;
    const lines = content.split('\n');
    const definitions = findDefinitionLines(lines);
    const descriptors: Array<{ purpose: CalibrationWindow['purpose']; start: number; end: number }> = [];
    descriptors.push({ purpose: 'header', start: 1, end: Math.min(lines.length, 24) });
    if (definitions.length > 0) descriptors.push(windowAround(definitions[0], lines.length, 'structure'));
    if (definitions.length > 1) descriptors.push(windowAround(definitions[Math.floor(definitions.length / 2)], lines.length, 'implementation'));
    else descriptors.push(windowAround(Math.max(1, Math.floor(lines.length * 0.6)), lines.length, 'implementation'));

    const unique = new Map<string, CalibrationWindow>();
    for (const descriptor of descriptors.slice(0, policy.max_windows_per_file)) {
      const start = Math.max(1, descriptor.start);
      const end = Math.min(lines.length, descriptor.end);
      const key = `${descriptor.purpose}:${start}:${end}`;
      unique.set(key, {
        file: file.path,
        start_line: start,
        end_line: end,
        purpose: descriptor.purpose,
        snippet: lines.slice(start - 1, end).join('\n').trim(),
      });
    }
    windows.push(...[...unique.values()].filter((window) => window.snippet.length > 0));
  }
  return windows;
}

function windowAround(line: number, totalLines: number, purpose: CalibrationWindow['purpose']) {
  const radius = purpose === 'implementation' ? 16 : 12;
  return {
    purpose,
    start: Math.max(1, line - radius),
    end: Math.min(totalLines, line + radius),
  };
}

function findDefinitionLines(lines: string[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/\b(function|class|interface|type|const|let|var|def|fn|struct|enum|trait)\b/.test(lines[index])) {
      result.push(index + 1);
    }
  }
  return result;
}

function readSafe(projectRoot: string, file: string): string | null {
  try {
    return readFileSync(join(projectRoot, file), 'utf-8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}
