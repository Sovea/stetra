import type { Colors } from 'picocolors/types';

import {
  heading,
  isRecord,
  statusLine,
  statusValue,
  type JsonObject,
} from './shared.ts';

export function formatInit(output: JsonObject, colors: Colors): string {
  const lines = [
    heading('Resonant Code project setup', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (Array.isArray(output.adapters)) {
    lines.push(`${colors.bold('Adapters:')} ${output.adapters.join(', ') || 'none'}`);
  }
  if (isRecord(output.counts)) {
    const counts = Object.entries(output.counts)
      .filter(([, count]) => Number(count) > 0)
      .map(([action, count]) => `${action}=${String(count)}`)
      .join(', ');
    if (counts) lines.push(`${colors.bold('Artifacts:')} ${counts}`);
  }
  if (Array.isArray(output.artifacts)) {
    for (const artifact of output.artifacts) {
      if (!isRecord(artifact) || artifact.action !== 'blocked') continue;
      lines.push(
        `${colors.yellow('!')} ${String(artifact.path)}: ${String(
          artifact.reason ?? 'managed content changed',
        )}`,
      );
    }
  }
  appendRequired(lines, output.readiness, colors);
  return lines.join('\n');
}

export function formatReadiness(output: JsonObject, colors: Colors): string {
  const command = String(output.command ?? 'status');
  const lines = [
    heading(`Resonant Code ${command}`, colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.version === 'string') {
    lines.push(`${colors.bold('Version:')} ${output.version}`);
  }
  if (isRecord(output.readiness)) {
    lines.push(`${colors.bold('Readiness:')} ${statusValue(
      String(output.readiness.status ?? 'unknown'),
      colors,
    )}`);
    appendRequired(lines, output.readiness, colors);
  }
  if (isRecord(output.installation)) {
    lines.push(`${colors.bold('Installation:')} ${statusValue(
      String(output.installation.status ?? 'unknown'),
      colors,
    )}`);
  }
  return lines.join('\n');
}

function appendRequired(lines: string[], readiness: unknown, colors: Colors): void {
  if (!isRecord(readiness) || !Array.isArray(readiness.required) || !readiness.required.length) return;
  lines.push('', colors.bold('Required'));
  for (const action of readiness.required) {
    if (!isRecord(action)) continue;
    lines.push(`${colors.yellow('!')} ${String(action.message ?? action.code)}`);
  }
}
