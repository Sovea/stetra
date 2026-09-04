import type { Colors } from 'picocolors/types';

import { formatInit, formatReadiness } from './human/setup.ts';
import { heading, isRecord, statusLine } from './human/shared.ts';

export function formatHumanResult(command: string, output: unknown, colors: Colors): string {
  if (!isRecord(output)) return String(output);
  if (command === 'init') return formatInit(output, colors);
  if (command === 'status') return formatReadiness(output, colors);
  if (command.startsWith('task ')) return formatTask(output, colors);
  return statusLine(String(output.status ?? 'ok'), colors);
}

function formatTask(output: Record<string, unknown>, colors: Colors): string {
  const lines = [
    heading('Stetra managed change', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.taskId === 'string') lines.push(`${colors.bold('Task:')} ${output.taskId}`);
  if (typeof output.phase === 'string') lines.push(`${colors.bold('Phase:')} ${output.phase}`);
  if (isRecord(output.summary)) appendSummary(lines, output.summary, colors);
  if (isRecord(output.decisionBrief)) appendDecisionBrief(lines, output.decisionBrief, colors);
  if (isRecord(output.directive)) {
    lines.push('', `${colors.bold('Next:')} ${String(output.directive.kind ?? '')}`);
    if (typeof output.directive.message === 'string') lines.push(output.directive.message);
  }
  return lines.join('\n');
}

function appendSummary(lines: string[], summary: Record<string, unknown>, colors: Colors): void {
  if (typeof summary.intendedOutcome === 'string') {
    lines.push(`${colors.bold('Outcome:')} ${summary.intendedOutcome}`);
  }
  if (Array.isArray(summary.changedFiles)) {
    lines.push(`${colors.bold('Changed files:')} ${summary.changedFiles.length}`);
  }
  if (Array.isArray(summary.checks)) {
    lines.push(`${colors.bold('Checks:')} ${summary.checks.length}`);
    for (const check of summary.checks) {
      if (isRecord(check)) {
        lines.push(`${colors.cyan('•')} ${JSON.stringify(check.argv ?? [])} — ${String(check.status ?? 'unknown')}`);
      }
    }
  }
}

function appendDecisionBrief(
  lines: string[],
  brief: Record<string, unknown>,
  colors: Colors,
): void {
  if (isRecord(brief.decisionState)) {
    lines.push(
      '',
      colors.bold('Decision state'),
      `Delivery: ${String(brief.decisionState.delivery ?? 'unknown')}`,
      `Evidence: ${String(brief.decisionState.evidence ?? 'unknown')}`,
      `Agent recommendation: ${String(brief.decisionState.recommendation ?? 'unknown')}`,
      `Human adoption: ${isRecord(brief.decisionState.adoption)
        ? String(brief.decisionState.adoption.status ?? 'pending') : 'pending'}`,
    );
  }
  if (isRecord(brief.changeMeaning)) {
    lines.push('', colors.bold('Actual change'));
    if (isRecord(brief.changeMeaning.humanRequest)
      && typeof brief.changeMeaning.humanRequest.content === 'string') {
      lines.push(`Request: ${brief.changeMeaning.humanRequest.content}`);
    }
    if (typeof brief.changeMeaning.intendedOutcome === 'string') {
      lines.push(`Intended: ${brief.changeMeaning.intendedOutcome}`);
    }
    if (isRecord(brief.changeMeaning.actualChange)) {
      lines.push(`Behavior: ${String(brief.changeMeaning.actualChange.behavior ?? '')}`);
      for (const mechanism of Array.isArray(brief.changeMeaning.actualChange.mechanism)
        ? brief.changeMeaning.actualChange.mechanism : []) {
        lines.push(`${colors.cyan('•')} Mechanism: ${String(mechanism)}`);
      }
    }
  }
  if (isRecord(brief.recommendation)) {
    lines.push('', `${colors.bold('Recommendation:')} ${String(brief.recommendation.action ?? '')}`);
    if (typeof brief.recommendation.rationale === 'string') lines.push(brief.recommendation.rationale);
  }
  if (Array.isArray(brief.attention) && brief.attention.length) {
    lines.push('', colors.bold('Attention'));
    for (const item of brief.attention) {
      if (isRecord(item)) lines.push(`${colors.yellow('•')} ${String(item.message ?? item.code ?? '')}`);
    }
  }
  if (Array.isArray(brief.reviewFocus) && brief.reviewFocus.length) {
    lines.push('', colors.bold('Review focus'));
    for (const item of brief.reviewFocus) {
      if (isRecord(item)) lines.push(`${colors.cyan('•')} ${String(item.question ?? '')}`);
    }
  }
  lines.push('', 'Human adoption is pending: accept, request correction, reject, or defer.');
}
