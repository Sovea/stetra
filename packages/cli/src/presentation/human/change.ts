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
  if (isRecord(brief.changeMeaning)) {
    lines.push(
      '',
      colors.bold('Agent interpretation'),
      `${colors.bold('Intended outcome:')} ${String(brief.changeMeaning.intendedOutcome ?? '')}`,
      `${colors.bold('Actual system meaning:')} ${String(brief.changeMeaning.actualSystemMeaning ?? '')}`,
    );
    if (Array.isArray(brief.changeMeaning.importantSystemEffects)) {
      for (const effect of brief.changeMeaning.importantSystemEffects) {
        lines.push(`${colors.cyan('•')} ${String(effect)}`);
      }
    }
  }
  if (Array.isArray(brief.conditions) && brief.conditions.length) {
    lines.push('', colors.bold('Agent findings and assurance'));
    for (const condition of brief.conditions) {
      if (!isRecord(condition) || !isRecord(condition.finding)) continue;
      lines.push(
        `${colors.cyan('•')} ${String(condition.statement ?? '')} — ${String(condition.finding.status ?? 'unknown')}`,
        `  ${String(condition.finding.summary ?? '')}`,
      );
      if (!Array.isArray(condition.obligations)) continue;
      for (const obligation of condition.obligations) {
        if (!isRecord(obligation) || !isRecord(obligation.finding)
          || !isRecord(obligation.evidenceBoundary)) continue;
        lines.push(
          `  ${colors.cyan('↳')} ${String(obligation.statement ?? '')} — ${String(obligation.finding.status ?? 'unknown')}`,
          `    ${String(obligation.finding.conclusion ?? '')}`,
        );
        if (isRecord(obligation.evidencePath)) {
          lines.push(`    Evidence path: ${String(obligation.evidencePath.status ?? 'unknown')}`);
          if (Array.isArray(obligation.evidencePath.gaps)) {
            for (const gap of obligation.evidencePath.gaps) {
              if (isRecord(gap)) lines.push(`    Assurance gap: ${String(gap.kind)} — ${String(gap.reason)}`);
            }
          }
        }
        if (isRecord(obligation.evidenceBoundary.coverage)) {
          const coverage = obligation.evidenceBoundary.coverage;
          lines.push(`    Evidence coverage: ${String(coverage.status ?? 'unknown')} — ${String(coverage.rationale ?? '')}`);
          if (Array.isArray(coverage.gaps)) {
            for (const gap of coverage.gaps) lines.push(`    Uncovered: ${String(gap)}`);
          }
        }
        const findings = obligation.evidenceBoundary.challengeFindings;
        if (!Array.isArray(findings)) continue;
        for (const finding of findings) {
          if (!isRecord(finding) || !Array.isArray(finding.counterEvidence)) continue;
          for (const counterEvidence of finding.counterEvidence) {
            if (isRecord(counterEvidence)) {
              lines.push(
                `    Challenge counter-evidence [${String(counterEvidence.provenance ?? 'agent-judgment')}; ${String(counterEvidence.reproduction ?? 'unknown')}]: ${String(counterEvidence.statement ?? '')}`,
              );
            }
          }
        }
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
            lines.push(
              `  Unknown: ${String(unknown.statement ?? '')}`,
              `  Adoption impact: ${String(unknown.adoptionImpact ?? '')}`,
              `  Next: ${String(unknown.nextAction ?? '')}`,
            );
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
