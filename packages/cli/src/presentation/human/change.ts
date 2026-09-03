import type { Colors } from 'picocolors/types';

import {
  appendHostAction,
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
  if (isRecord(output.summary) && isRecord(output.summary.contract)) {
    const contract = output.summary.contract;
    lines.push(
      `${colors.bold('Contract:')} ${String(contract.conditionCount ?? 0)} conditions; `
      + `${String(contract.obligationCount ?? 0)} obligations; ${String(contract.checkCount ?? 0)} checks`,
    );
  }
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
  if (isRecord(output.summary)) {
    const changedFiles = output.summary.changedFiles;
    if (isRecord(changedFiles)) {
      lines.push(`${colors.bold('Changed files:')} ${String(changedFiles.total ?? 0)}${formatRecordCounts(changedFiles.operations)}`);
    }
    if (Number(output.summary.checkInducedChanges ?? 0) > 0) {
      lines.push(`${colors.bold('Check-induced changes:')} ${String(output.summary.checkInducedChanges)}`);
    }
    const checks = output.summary.checks;
    if (isRecord(checks)) {
      lines.push(`${colors.bold('Checks:')} ${String(checks.total ?? 0)}${formatRecordCounts(checks.latestStatuses)}`);
    }
  }
  if (output.repeatedObservation === true) {
    lines.push(colors.yellow('The parent and current Attempt have the same collected change/check observation; no route is inferred from this fact.'));
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

function formatRecordCounts(value: unknown): string {
  if (!isRecord(value)) return '';
  return formatCounts(new Map(Object.entries(value).flatMap(([key, count]) =>
    typeof count === 'number' ? [[key, count] as const] : [])));
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
  if (Array.isArray(output.events)) lines.push(`${colors.bold('Events:')} ${output.events.length}`);
  lines.push(colors.dim('Use --json for exact Human Events, Runtime facts, Agent judgments, and Human decisions.'));
  return lines.join('\n');
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
      if (isRecord(condition) && isRecord(condition.agentFinding)) {
        lines.push(`${colors.cyan('•')} ${String(condition.id)} — ${String(condition.agentFinding.status)}`);
      }
    }
  }
}

function appendDeveloperDecisionBrief(
  lines: string[],
  brief: JsonObject,
  colors: Colors,
): void {
  if (!isRecord(brief.primary)) return;
  brief = brief.primary;
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
  if (isRecord(brief.recommendation)) {
    lines.push(`${colors.bold('Why:')} ${String(brief.recommendation.rationale ?? '')}`);
    if (Array.isArray(brief.recommendation.caveats)) {
      for (const caveat of brief.recommendation.caveats) {
        lines.push(`${colors.yellow('•')} Caveat: ${String(caveat)}`);
      }
    }
  }
  if (Array.isArray(brief.priorHumanResolutions) && brief.priorHumanResolutions.length) {
    lines.push('', colors.bold('Prior developer resolutions'));
    for (const resolution of brief.priorHumanResolutions) {
      if (!isRecord(resolution)) continue;
      lines.push(
        `${colors.cyan('•')} ${String(resolution.target ?? 'unknown')} — ${String(resolution.action ?? 'unknown')}`,
        `  ${String(resolution.reason ?? '')}`,
      );
    }
  }
  if (isRecord(brief.changeMeaning)) {
    const actual = isRecord(brief.changeMeaning.actualChange)
      ? brief.changeMeaning.actualChange : {};
    lines.push(
      '',
      colors.bold('Agent interpretation'),
      `${colors.bold('Intended outcome:')} ${String(brief.changeMeaning.intendedOutcome ?? '')}`,
      `${colors.bold('Actual behavior:')} ${String(actual.behavior ?? '')}`,
    );
    for (const [label, field] of [
      ['Mechanism', 'mechanism'],
      ['Preserved', 'preservedInvariants'],
      ['Failure / recovery', 'failureAndRecovery'],
      ['Important effect', 'importantEffects'],
      ['Tradeoff', 'materialTradeoffs'],
    ] as const) {
      if (Array.isArray(actual[field])) {
        for (const item of actual[field]) {
          lines.push(`${colors.cyan('•')} ${label}: ${String(item)}`);
        }
      }
    }
  }
  if (Array.isArray(brief.conditions) && brief.conditions.length) {
    lines.push('', colors.bold('Agent findings and assurance'));
    for (const condition of brief.conditions) {
      if (!isRecord(condition) || !isRecord(condition.finding)) continue;
      lines.push(
        `${colors.cyan('•')} ${String(condition.statement ?? '')} — ${String(condition.finding.status ?? 'unknown')} (Agent judgment over declared evidence; independent challenge not attested by the current Host)`,
        `  ${String(condition.finding.summary ?? '')}`,
      );
      if (!Array.isArray(condition.evidence)) continue;
      for (const obligation of condition.evidence) {
        if (!isRecord(obligation)) continue;
        lines.push(
          `  ${colors.cyan('↳')} ${String(obligation.statement ?? '')} — ${String(obligation.finding ?? 'unknown')}`,
          `    Evidence path: ${String(obligation.evidencePath ?? 'unknown')}; counter-evidence: ${String(obligation.counterEvidenceCount ?? 0)}`,
        );
      }
    }
  }
  if (Array.isArray(brief.blockers) && brief.blockers.length) {
    lines.push('', colors.bold('Adoption blockers'));
    for (const issue of brief.blockers) {
      if (!isRecord(issue)) continue;
      const resolutions = Array.isArray(issue.resolutions) ? issue.resolutions.join(' / ') : 'inspect';
      const codes = Array.isArray(issue.codes) ? issue.codes.join(', ') : 'attention-required';
      lines.push(`${colors.yellow('•')} ${String(issue.group ?? 'delivery')} — ${resolutions} [${codes}]`);
      if (Array.isArray(issue.affectedConditions)) {
        for (const statement of issue.affectedConditions) lines.push(`  Affects: ${String(statement)}`);
      }
      if (Array.isArray(issue.residualUnknowns)) {
        for (const unknown of issue.residualUnknowns) {
          if (isRecord(unknown)) {
            lines.push(`  Unknown: ${String(unknown.statement ?? '')}`);
          }
        }
      }
    }
  }
  if (Array.isArray(brief.reviewFocus) && brief.reviewFocus.length) {
    lines.push('', colors.bold('Where direct review changes the decision'));
    for (const item of brief.reviewFocus) {
      if (!isRecord(item)) continue;
      lines.push(
        `${colors.cyan('•')} ${String(item.question ?? '')}`,
        `  Adoption impact: ${String(item.adoptionImpact ?? '')}`,
        `  Next: ${String(item.nextAction ?? '')}`,
      );
      if (Array.isArray(item.affectedConditions)) {
        for (const statement of item.affectedConditions) lines.push(`  Affects: ${String(statement)}`);
      }
    }
  }
  if (Array.isArray(brief.evidenceHistory) && brief.evidenceHistory.length) {
    lines.push('', colors.bold('Evidence and recovery history'));
    for (const history of brief.evidenceHistory) {
      if (!isRecord(history) || !isRecord(history.resolution)) continue;
      lines.push(`${colors.cyan('•')} ${String(history.attemptId ?? '')} — ${String(history.resolution.actualRoute ?? 'unknown')}`);
      if (Array.isArray(history.concerns)) {
        for (const concern of history.concerns) {
          if (isRecord(concern)) {
            lines.push(`  ${String(concern.cause ?? 'unknown')}: ${String(concern.diagnosis ?? '')}`);
          }
        }
      }
    }
  }
  if (isRecord(brief.runtimeEvidence)) {
    const changedFiles = Array.isArray(brief.runtimeEvidence.changedFiles)
      ? brief.runtimeEvidence.changedFiles : [];
    const checks = Array.isArray(brief.runtimeEvidence.checks)
      ? brief.runtimeEvidence.checks : [];
    lines.push('', colors.bold('Runtime observations'), `Changed files: ${changedFiles.length}`);
    for (const check of checks) {
      if (isRecord(check)) {
        lines.push(`${colors.cyan('•')} ${JSON.stringify(check.argv ?? [])} — ${String(check.status ?? 'unknown')} (${String(check.baselineRelation ?? 'unknown')})`);
      }
    }
  }
  if (isRecord(brief.requestedDecision)) {
    const actions = Array.isArray(brief.requestedDecision.actions)
      ? brief.requestedDecision.actions.join(' / ') : '';
    const exceptions = Number(brief.requestedDecision.acceptanceExceptionIssueCount ?? 0);
    lines.push(
      '',
      `${colors.bold('Developer decision required:')} ${actions}`,
      exceptions
        ? `Acceptance requires explicit exceptions for ${exceptions} current decision issue(s).`
        : 'No current decision issue requires an acceptance exception.',
    );
  }
}
