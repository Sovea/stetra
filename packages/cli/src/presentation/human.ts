import type { Colors } from 'picocolors/types';

import {
  formatChangeComplete,
  formatChangePrepare,
} from './human/change.ts';
import {
  formatBootstrap,
  formatContext,
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
  if (command.startsWith('bootstrap ')) return formatBootstrap(output, colors);
  if (command === 'change prepare') return formatChangePrepare(output, colors);
  if (command === 'change complete') return formatChangeComplete(output, colors);
  if (command.startsWith('context ')) return formatContext(output, colors);
  return formatStructured(output, colors);
}

function formatStructured(output: JsonObject, colors: Colors): string {
  const lines = [statusLine(String(output.status ?? 'ok'), colors)];
  for (const [label, field] of [
    ['Decision', 'decisionId'],
    ['Evaluation', 'evaluationId'],
    ['Session', 'sessionPath'],
    ['Proposal', 'proposalPath'],
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
  if ('evaluation' in output || 'aggregates' in output) {
    lines.push(colors.dim('Use --json for the complete machine-readable result.'));
  }
  return lines.join('\n');
}
