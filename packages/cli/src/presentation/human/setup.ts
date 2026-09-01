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
    heading('Stetra project setup', colors),
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
  return lines.join('\n');
}

export function formatReadiness(output: JsonObject, colors: Colors): string {
  const command = String(output.command ?? 'status');
  const lines = [
    heading(`Stetra ${command}`, colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.version === 'string') {
    lines.push(`${colors.bold('Version:')} ${output.version}`);
  }
  if (isRecord(output.installation)) {
    lines.push(`${colors.bold('Installation:')} ${statusValue(
      String(output.installation.status ?? 'unknown'),
      colors,
    )}`);
  }
  if (isRecord(output.worktree)) {
    lines.push(`${colors.bold('Git worktree:')} ${statusValue(
      String(output.worktree.status ?? 'unknown'),
      colors,
    )}`);
  }
  if (Array.isArray(output.issues) && output.issues.length) {
    lines.push('', colors.bold('Required'));
    for (const issue of output.issues) {
      if (!isRecord(issue)) continue;
      lines.push(`${colors.yellow('!')} ${String(issue.message ?? issue.code)}`);
    }
  }
  return lines.join('\n');
}
