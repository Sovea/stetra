import type { Colors } from 'picocolors/types';

import {
  appendReasons,
  countValues,
  formatCounts,
  heading,
  isRecord,
  statusLine,
  type JsonObject,
} from './shared.ts';

export function formatChangePrepare(
  output: JsonObject,
  colors: Colors,
): string {
  if (output.status === 'guidance-overflow') {
    const lines = [
      heading('Guidance delivery needs a selection', colors),
      `${colors.bold('Budget:')} ${String(output.byteLimit)} bytes`,
      `${colors.bold('Mandatory:')} ${String(output.mandatoryBytes)} bytes`,
      `${colors.bold('Full guidance:')} ${String(output.fullGuidanceBytes)} bytes`,
    ];
    if (Array.isArray(output.selectableConsider)) {
      lines.push('', colors.bold('Optional guidance'));
      for (const item of output.selectableConsider) {
        if (!isRecord(item)) continue;
        lines.push(
          `${colors.cyan('•')} ${colors.bold(String(item.id))} `
          + `${colors.dim(`${String(item.bytes)} bytes`)}`,
        );
        if (typeof item.instruction === 'string') {
          lines.push(`  ${item.instruction}`);
        }
      }
    }
    appendReasons(lines, output.reasons, colors);
    if (typeof output.nextStep === 'string') {
      lines.push('', `${colors.bold('Next:')} ${output.nextStep}`);
    }
    return lines.join('\n');
  }

  const checksRequired = output.status === 'checks-required';
  const lines = [
    heading(checksRequired ? 'Checks required before run' : 'Change guidance prepared', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.decisionId === 'string') {
    lines.push(`${colors.bold('Decision:')} ${output.decisionId}`);
  }
  if (typeof output.runId === 'string') {
    lines.push(`${colors.bold('Run:')} ${output.runId}`);
  }
  if (typeof output.runPath === 'string') {
    lines.push(`${colors.bold('Run file:')} ${output.runPath}`);
  }
  if (typeof output.evaluationInputPath === 'string') {
    lines.push(`${colors.bold('Evaluation input:')} ${output.evaluationInputPath}`);
  }
  if (checksRequired && Array.isArray(output.checkPlan)) {
    const missing = output.checkPlan
      .filter(isRecord)
      .filter((check) => check.status === 'missing');
    if (missing.length) {
      lines.push('', colors.bold('Missing checks'));
      for (const check of missing) {
        lines.push(`${colors.yellow('•')} ${String(check.id ?? 'check')}`);
      }
    }
  }
  appendGuidance(lines, output.guidance, colors);
  appendReasons(lines, output.reasons, colors);
  if (typeof output.nextStep === 'string') {
    lines.push('', `${colors.bold('Next:')} ${output.nextStep}`);
  }
  return lines.join('\n');
}

export function formatChangeComplete(
  output: JsonObject,
  colors: Colors,
): string {
  const status = String(output.status ?? 'unknown');
  const lines = [
    heading('Change evaluation', colors),
    statusLine(status, colors),
  ];
  if (typeof output.evaluationId === 'string') {
    lines.push(`${colors.bold('Evaluation:')} ${output.evaluationId}`);
  }

  if (isRecord(output.changes) && Array.isArray(output.changes.files)) {
    const counts = countValues(
      output.changes.files
        .filter(isRecord)
        .map((file) => String(file.status ?? 'unknown')),
    );
    lines.push(
      `${colors.bold('Changed files:')} ${String(output.changes.files.length)}${formatCounts(counts)}`,
    );
  }

  if (Array.isArray(output.checks)) {
    const checks = output.checks.filter(isRecord);
    const counts = countValues(checks.map((check) => String(check.status ?? 'unknown')));
    lines.push(
      `${colors.bold('Checks:')} ${String(checks.length)}${formatCounts(counts)}`,
    );
    for (const check of checks) {
      if (check.status === 'passed') continue;
      const marker = check.status === 'failed' ? colors.red('!') : colors.yellow('!');
      lines.push(
        `${marker} ${String(check.id ?? 'check')}: ${String(
          check.reason ?? check.status ?? 'unknown',
        )}`,
      );
    }
  }

  const results = Array.isArray(output.results)
    ? output.results.filter(isRecord)
    : [];
  if (results.length) {
    lines.push('', colors.bold('Guidance'));
    for (const section of ['required', 'avoid', 'tension', 'consider']) {
      const sectionResults = results.filter((result) => result.section === section);
      if (!sectionResults.length) continue;
      const counts = countValues(
        sectionResults.map((result) => String(result.verdict ?? 'unknown')),
      );
      lines.push(`${colors.cyan('•')} ${section}: ${formatCounts(counts, false)}`);
    }
  }

  appendExceptions(lines, results, colors);
  appendAttention(lines, results, colors);

  if (typeof output.runId === 'string') {
    lines.push(`${colors.bold('Run:')} ${output.runId}`);
  }
  if (typeof output.runPath === 'string') {
    lines.push(`${colors.bold('Run file:')} ${output.runPath}`);
  }

  if (status === 'warning') {
    lines.push('', `${colors.bold('Next:')} Review unresolved evidence before accepting the change.`);
  } else if (status === 'exception-required') {
    lines.push(
      '',
      `${colors.bold('Next:')} Supply missing evidence or obtain explicit user approval for the exact exception, then rerun completion.`,
    );
  } else if (status === 'rejected') {
    lines.push(
      '',
      `${colors.bold('Next:')} Fix hard violations or failed required checks before accepting the change.`,
    );
  }
  return lines.join('\n');
}

function appendAttention(
  lines: string[],
  results: JsonObject[],
  colors: Colors,
): void {
  const attention = results.filter((result) =>
    ['violated', 'partial', 'unverified'].includes(String(result.verdict)));
  if (!attention.length) return;
  lines.push('', colors.bold('Review needed'));
  for (const result of attention) {
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    lines.push(
      `${colors.yellow('•')} ${String(result.guidanceId)} (${String(result.verdict)})`,
    );
    if (reasons.length) lines.push(`  ${String(reasons[0])}`);
  }
}

function appendExceptions(
  lines: string[],
  results: JsonObject[],
  colors: Colors,
): void {
  const exceptions = results.filter((result) => isRecord(result.exception));
  const approvedExceptions = exceptions.filter((result) =>
    isRecord(result.exception) && result.exception.status === 'approved');
  const pendingExceptions = exceptions.length - approvedExceptions.length;
  lines.push(
    `${colors.bold('Exceptions:')} approved=${String(approvedExceptions.length)}, pending=${String(pendingExceptions)}`,
  );
  for (const result of exceptions) {
    const exception = result.exception as JsonObject;
    const marker = exception.status === 'approved'
      ? colors.yellow('•')
      : colors.red('!');
    lines.push(
      `${marker} ${String(result.guidanceId)} [${String(
        exception.status ?? 'requested',
      )}] — ${String(exception.reason ?? 'approved exception')}`,
    );
  }
}

function appendGuidance(
  lines: string[],
  guidance: unknown,
  colors: Colors,
): void {
  if (!isRecord(guidance)) return;
  for (const section of ['required', 'tensions', 'avoid', 'consider']) {
    const items = guidance[section];
    if (!Array.isArray(items) || !items.length) continue;
    lines.push('', colors.bold(section));
    for (const item of items) {
      if (!isRecord(item)) continue;
      const text = item.instruction
        ?? item.resolution
        ?? item.description
        ?? item.pattern
        ?? item.id;
      lines.push(`${colors.cyan('•')} [${String(item.id ?? section)}] ${String(text)}`);
    }
  }
}
