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
  if (command === 'status' || command === 'doctor') {
    return formatReadiness(output, colors);
  }
  if (command === 'change prepare') return formatChangePrepare(output, colors);
  if (command === 'change collect') return formatChangeCollect(output, colors);
  if (command === 'change finalize') return formatChangeFinalize(output, colors);
  if (command === 'change explain') return formatChangeExplain(output, colors);
  return formatStructured(output, colors);
}

function formatStructured(output: JsonObject, colors: Colors): string {
  const lines = [statusLine(String(output.status ?? 'ok'), colors)];
  for (const [label, field] of [
    ['Decision', 'decisionId'],
    ['Evaluation', 'evaluationId'],
    ['Run', 'runId'],
    ['Run file', 'runPath'],
  ] as const) {
    if (typeof output[field] === 'string') {
      lines.push(`${colors.bold(`${label}:`)} ${output[field]}`);
    }
  }
  appendReasons(lines, output.reasons, colors);
  if (typeof output.message === 'string') lines.push(output.message);
  if (typeof output.nextStep === 'string') {
    lines.push(`${colors.bold('Next:')} ${output.nextStep}`);
  }
  if ('evaluation' in output) {
    lines.push(colors.dim('Use --json for the complete machine-readable result.'));
  }
  return lines.join('\n');
}
