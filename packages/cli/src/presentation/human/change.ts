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
  if (Array.isArray(output.forks) && output.forks.length) {
    lines.push('', colors.bold('Human decision required'));
    for (const fork of output.forks) {
      if (isRecord(fork)) lines.push(`${colors.yellow('•')} ${String(fork.question ?? '')}`);
    }
  }
  if (isRecord(output.baseline)) {
    lines.push(`${colors.bold('Baseline:')} ${String(output.baseline.entryCount ?? 0)} entries; ${String(output.baseline.fingerprint ?? '')}`);
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeCollect(output: JsonObject, colors: Colors): string {
  const reused = output.collectionMode === 'reused-current';
  const lines = [
    heading(reused ? 'Current Attempt facts reused' : 'Attempt facts collected', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
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
  if (isRecord(output.hostAction) && isRecord(output.hostAction.developerDecisionBrief)) {
    appendDeveloperDecisionBrief(lines, output.hostAction.developerDecisionBrief, colors);
  } else if (isRecord(output.decisionPacket)) {
    appendDecisionLayerFallback(lines, output.decisionPacket, colors);
  }
  lines.push(colors.dim('Use --json to inspect exact references, Runtime logs, and the decision continuation.'));
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

function appendDecisionLayerFallback(lines: string[], packet: JsonObject, colors: Colors): void {
  if (!isRecord(packet.decision) || !isRecord(packet.semanticContract)) return;
  const decision = packet.decision;
  lines.push('', colors.bold('Decision summary'));
  if (typeof packet.semanticContract.desiredOutcome === 'string') {
    lines.push(`${colors.bold('Desired outcome:')} ${packet.semanticContract.desiredOutcome}`);
  }
  if (isRecord(decision.recommendation)) {
    lines.push(
      `${colors.bold('Agent recommendation:')} ${String(decision.recommendation.action)}`,
      String(decision.recommendation.rationale ?? ''),
    );
  }
  if (Array.isArray(packet.conditions) && packet.conditions.length) {
    lines.push(colors.bold('Condition conclusions'));
    for (const condition of packet.conditions) {
      if (isRecord(condition) && isRecord(condition.conclusion)) {
        lines.push(`${colors.cyan('•')} ${String(condition.id)} — ${String(condition.conclusion.status)}`);
      }
    }
  }
}

function appendDeveloperDecisionBrief(
  lines: string[],
  brief: JsonObject,
  colors: Colors,
): void {
  if (isRecord(brief.decisionState)) {
    const state = brief.decisionState;
    lines.push(
      '',
      colors.bold('Decision state'),
      `${colors.bold('Delivery:')} ${String(state.delivery ?? 'unknown')}`,
      `${colors.bold('Evidence:')} ${String(state.evidence ?? 'unknown')}`,
      `${colors.bold('Agent recommendation:')} ${String(state.recommendation ?? 'unknown')}`,
      `${colors.bold('Human adoption:')} ${String(state.adoption ?? 'pending')}`,
    );
  }
  if (isRecord(brief.changeMeaning)) {
    lines.push(
      '',
      `${colors.bold('Desired outcome:')} ${String(brief.changeMeaning.desiredOutcome ?? '')}`,
      `${colors.bold('Actual system meaning:')} ${String(brief.changeMeaning.actualSystemMeaning ?? '')}`,
    );
    if (Array.isArray(brief.changeMeaning.importantSystemEffects)) {
      for (const effect of brief.changeMeaning.importantSystemEffects) {
        lines.push(`${colors.cyan('•')} ${String(effect)}`);
      }
    }
  }
  if (Array.isArray(brief.conditions) && brief.conditions.length) {
    lines.push('', colors.bold('Adoption conditions'));
    for (const condition of brief.conditions) {
      if (!isRecord(condition)) continue;
      lines.push(
        `${colors.cyan('•')} ${String(condition.statement ?? condition.id)} — ${String(condition.status ?? 'unknown')}`,
        `  ${String(condition.summary ?? '')}`,
      );
    }
  }
  if (Array.isArray(brief.decisionIssues) && brief.decisionIssues.length) {
    lines.push('', colors.bold('Decision issues'));
    for (const issue of brief.decisionIssues) {
      if (!isRecord(issue)) continue;
      lines.push(`${colors.yellow('•')} ${String(issue.code ?? 'unknown')} — ${String(issue.resolution ?? 'inspect')} (${String(issue.id ?? '')})`);
      if (Array.isArray(issue.residualUnknowns)) {
        for (const unknown of issue.residualUnknowns) {
          if (isRecord(unknown)) {
            lines.push(`  Unknown: ${String(unknown.statement ?? '')}`, `  Next: ${String(unknown.nextAction ?? '')}`);
          }
        }
      }
      if (Array.isArray(issue.reviewQuestions)) {
        for (const question of issue.reviewQuestions) {
          if (isRecord(question)) lines.push(`  Review: ${String(question.question ?? '')}`);
        }
      }
    }
  }
  if (isRecord(brief.runtimeEvidence)) {
    const changedFiles = Array.isArray(brief.runtimeEvidence.changedFiles)
      ? brief.runtimeEvidence.changedFiles : [];
    const checks = Array.isArray(brief.runtimeEvidence.checks)
      ? brief.runtimeEvidence.checks : [];
    lines.push('', colors.bold('Runtime evidence'), `Changed files: ${changedFiles.length}`);
    for (const check of checks) {
      if (isRecord(check)) {
        lines.push(`${colors.cyan('•')} ${JSON.stringify(check.argv ?? [])} — ${String(check.status ?? 'unknown')} (${String(check.baselineRelation ?? 'unknown')})`);
      }
    }
  }
  if (isRecord(brief.requestedDecision)) {
    const actions = Array.isArray(brief.requestedDecision.actions)
      ? brief.requestedDecision.actions.join(' / ') : '';
    const exceptions = Array.isArray(brief.requestedDecision.acceptanceRequiresExceptionsFor)
      ? brief.requestedDecision.acceptanceRequiresExceptionsFor.length : 0;
    lines.push(
      '',
      `${colors.bold('Developer decision required:')} ${actions}`,
      exceptions
        ? `Acceptance requires explicit exceptions for ${exceptions} current decision issue(s).`
        : 'No current decision issue requires an acceptance exception.',
    );
  }
}
