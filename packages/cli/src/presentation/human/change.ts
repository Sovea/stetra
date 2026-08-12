import type { Colors } from 'picocolors/types';

import {
  appendHostAction,
  countValues,
  formatCounts,
  heading,
  isRecord,
  statusLine,
  type JsonObject,
} from './shared.ts';

export function formatChangePrepare(output: JsonObject, colors: Colors): string {
  const status = String(output.status ?? 'unknown');
  const lines = [
    heading(status === 'prepared' ? 'Cognitive Adoption task prepared' : 'Task not runnable', colors),
    statusLine(status, colors),
  ];
  if (typeof output.taskId === 'string') lines.push(`${colors.bold('Task:')} ${output.taskId}`);
  if (isRecord(output.taskContract)) appendContract(lines, output.taskContract, colors);
  if (Array.isArray(output.issues)) {
    for (const issue of output.issues) {
      if (isRecord(issue)) lines.push(`${colors.yellow('•')} ${String(issue.path)}: ${String(issue.message)}`);
    }
  }
  if (isRecord(output.fork)) {
    lines.push('', colors.bold('Human decision required'), String(output.fork.question ?? ''));
  }
  if (isRecord(output.baseline)) {
    lines.push(`${colors.bold('Baseline:')} ${String(output.baseline.entryCount ?? 0)} entries; ${String(output.baseline.fingerprint ?? '')}`);
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeCollect(output: JsonObject, colors: Colors): string {
  const lines = [heading('Attempt facts collected', colors), statusLine(String(output.status ?? 'unknown'), colors)];
  if (typeof output.attemptId === 'string') lines.push(`${colors.bold('Attempt:')} ${output.attemptId}`);
  if (Array.isArray(output.changedFiles)) {
    const counts = countValues(output.changedFiles.filter(isRecord).map((file) => String(file.operation ?? 'unknown')));
    lines.push(`${colors.bold('Changed files:')} ${output.changedFiles.length}${formatCounts(counts)}`);
  }
  if (Array.isArray(output.checkInducedChanges) && output.checkInducedChanges.length) {
    lines.push(`${colors.bold('Check-induced changes:')} ${output.checkInducedChanges.length}`);
  }
  if (Array.isArray(output.checks)) {
    const counts = countValues(output.checks.filter(isRecord).map((check) => String(check.status ?? 'unknown')));
    lines.push(`${colors.bold('Checks:')} ${output.checks.length}${formatCounts(counts)}`);
  }
  if (output.repeatedObservation === true) {
    lines.push(colors.yellow('The parent and current Attempt have the same collected change/check observation; no route is inferred from this fact.'));
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeFinalize(output: JsonObject, colors: Colors): string {
  const lines = [heading('Cognitive Handoff evaluated', colors), statusLine(String(output.status ?? 'unknown'), colors)];
  if (isRecord(output.decisionPacket) && isRecord(output.decisionPacket.review)) {
    appendDecisionLayer(lines, output.decisionPacket.review, colors);
  }
  appendAttention(lines, output.attention, colors);
  if (isRecord(output.adoption)) {
    lines.push(`${colors.bold('Human decision:')} ${String(output.adoption.status ?? 'pending')}`);
  }
  lines.push(colors.dim('Use --json to inspect the condition layer and exact Runtime fact drill-down.'));
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeExplain(output: JsonObject, colors: Colors): string {
  const lines = [heading('Cognitive Adoption task', colors)];
  if (typeof output.taskId === 'string') lines.push(`${colors.bold('Task:')} ${output.taskId}`);
  if (isRecord(output.task)) {
    lines.push(`${colors.bold('State:')} delivery=${String(output.task.deliveryStatus)}; evidence=${String(output.task.evidenceStatus)}; decision=${String(output.task.decisionStatus)}`);
  }
  if (isRecord(output.contract) && isRecord(output.contract.understanding)) {
    const desired = output.contract.understanding.desiredOutcome;
    if (isRecord(desired)) lines.push(`${colors.bold('Desired outcome:')} ${String(desired.value)}`);
  }
  if (Array.isArray(output.attempts)) lines.push(`${colors.bold('Attempts:')} ${output.attempts.length}`);
  if (Array.isArray(output.challenges)) lines.push(`${colors.bold('Challenges:')} ${output.challenges.length}`);
  if (Array.isArray(output.events)) lines.push(`${colors.bold('Events:')} ${output.events.length}`);
  lines.push(colors.dim('Use --json for exact Human Events, Runtime facts, Agent judgments, and Human decisions.'));
  return lines.join('\n');
}

function appendContract(lines: string[], contract: JsonObject, colors: Colors): void {
  if (isRecord(contract.understanding)) {
    const desired = contract.understanding.desiredOutcome;
    if (isRecord(desired)) lines.push('', `${colors.bold('Desired outcome:')} ${String(desired.value)}`);
  }
  if (Array.isArray(contract.adoptionConditions)) {
    lines.push(colors.bold('Adoption Conditions'));
    for (const condition of contract.adoptionConditions) {
      if (isRecord(condition)) lines.push(`${colors.cyan('•')} ${String(condition.id)} [${String(condition.criticality)}] — ${String(condition.statement)}`);
    }
  }
  if (isRecord(contract.plan)) {
    lines.push(`${colors.bold('Delivery:')} repair budget ${String(contract.plan.maxRepairAttempts)}`);
  }
}

function appendAttention(lines: string[], value: unknown, colors: Colors): void {
  if (!Array.isArray(value) || !value.length) return;
  lines.push(colors.bold('Attention'));
  for (const item of value) {
    if (isRecord(item)) {
      const codes = Array.isArray(item.codes) ? item.codes.join(', ') : 'unknown';
      lines.push(`${colors.yellow('•')} ${String(item.id)} [${String(item.group)}] — ${codes}`);
    }
  }
}

function appendDecisionLayer(lines: string[], review: JsonObject, colors: Colors): void {
  if (!isRecord(review.decision)) return;
  const decision = review.decision;
  lines.push('', colors.bold('Decision summary'));
  if (typeof decision.desiredOutcome === 'string') {
    lines.push(`${colors.bold('Desired outcome:')} ${decision.desiredOutcome}`);
  }
  if (isRecord(decision.recommendation)) {
    lines.push(
      `${colors.bold('Agent recommendation:')} ${String(decision.recommendation.action)}`,
      String(decision.recommendation.rationale ?? ''),
    );
  }
  if (Array.isArray(decision.conditionStatuses) && decision.conditionStatuses.length) {
    lines.push(colors.bold('Condition conclusions'));
    for (const condition of decision.conditionStatuses) {
      if (isRecord(condition)) {
        lines.push(`${colors.cyan('•')} ${String(condition.conditionId)} — ${String(condition.status)}`);
      }
    }
  }
}
