import type { Colors } from 'picocolors/types';

export type JsonObject = Record<string, unknown>;

export function appendReasons(
  lines: string[],
  reasons: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(reasons) || !reasons.length) return;
  lines.push('', colors.bold('Details'));
  for (const reason of reasons) {
    if (isRecord(reason)) {
      lines.push(`${colors.yellow('•')} ${String(reason.message ?? reason.code)}`);
    } else {
      lines.push(`${colors.yellow('•')} ${String(reason)}`);
    }
  }
}

export function appendStringList(
  lines: string[],
  label: string,
  values: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(values) || !values.length) return;
  lines.push('', colors.bold(label));
  for (const value of values) lines.push(`${colors.cyan('•')} ${String(value)}`);
}

export function appendHostAction(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value) || typeof value.kind !== 'string') return;
  lines.push('', `${colors.bold('Next action:')} ${value.kind}`);
  if (typeof value.reference === 'string') {
    lines.push(`${colors.bold('Reference:')} ${value.reference}`);
  }
  if (isRecord(value.command) && Array.isArray(value.command.argv)) {
    const argv = value.command.argv.filter((argument): argument is string =>
      typeof argument === 'string');
    lines.push(`${colors.bold('Command argv:')} ${JSON.stringify(argv)}`);
  }
}

export function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function formatCounts(
  counts: Map<string, number>,
  parentheses = true,
): string {
  if (!counts.size) return '';
  const detail = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => `${value}=${count}`)
    .join(', ');
  return parentheses ? ` (${detail})` : detail;
}

export function heading(value: string, colors: Colors): string {
  return colors.bold(colors.cyan(value));
}

export function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function statusLine(status: string, colors: Colors): string {
  return `${colors.bold('Status:')} ${statusValue(status, colors)}`;
}

export function statusValue(status: string, colors: Colors): string {
  if (
    [
      'created',
      'initialized',
      'ok',
      'ready',
      'supported',
      'prepared',
      'facts-collected',
      'facts-current',
      'handoff-ready',
      'valid',
    ].includes(status)
  ) {
    return colors.green(status);
  }
  if (status === 'rejected') return colors.red(status);
  if (
    [
      'blocked',
      'needs-attention',
      'facts-stale',
      'semantic-decision-required',
      'authority-invalid',
      'verification-required',
    ].includes(status)
  ) {
    return colors.yellow(status);
  }
  return status;
}
