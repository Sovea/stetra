import type { Colors } from 'picocolors/types';

import {
  formatChangeCollect,
  formatChangeExplain,
  formatChangeFinalize,
  formatChangePrepare,
} from './human/change.ts';
import {
  formatInit,
  formatReadiness,
} from './human/setup.ts';
import {
  appendHostAction,
  appendReasons,
  isRecord,
  statusLine,
  type JsonObject,
} from './human/shared.ts';

export function formatHumanResult(
  command: string,
  output: unknown,
  colors: Colors,
): string {
  if (!isRecord(output)) return String(output);
  if (command === 'init') return formatInit(output, colors);
  if (command === 'status') {
    return formatReadiness(output, colors);
  }
  if (command === 'change prepare') return formatChangePrepare(output, colors);
  if (command === 'change collect') return formatChangeCollect(output, colors);
  if (command === 'change handoff') return formatChangeFinalize(output, colors);
  if (command === 'change explain') return formatChangeExplain(output, colors);
  return formatStructured(output, colors);
}

function formatStructured(output: JsonObject, colors: Colors): string {
  const lines = [statusLine(String(output.status ?? 'ok'), colors)];
  for (const [label, field] of [
    ['Task', 'taskId'],
    ['Attempt', 'attemptId'],
    ['Decision', 'decisionId'],
  ] as const) {
    if (typeof output[field] === 'string') {
      lines.push(`${colors.bold(`${label}:`)} ${output[field]}`);
    }
  }
  appendReasons(lines, output.reasons, colors);
  if (typeof output.message === 'string') lines.push(output.message);
  appendHostAction(lines, output.hostAction, colors);
  if ('evaluation' in output) {
    lines.push(colors.dim('Use --json for the complete machine-readable result.'));
  }
  return lines.join('\n');
}
