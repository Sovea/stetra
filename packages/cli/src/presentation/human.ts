import type { Colors } from 'picocolors/types';

import { formatInit, formatReadiness } from './human/setup.ts';
import { heading, isRecord, statusLine } from './human/shared.ts';

export function formatHumanResult(command: string, output: unknown, colors: Colors): string {
  if (!isRecord(output)) return String(output);
  if (output.status === 'input-schema') return JSON.stringify(output, null, 2);
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
  if (typeof output.factsCurrency === 'string') lines.push(`Facts: ${output.factsCurrency}`);
  if (!isRecord(output.decisionBrief) && Array.isArray(output.corrections)) {
    for (const correction of output.corrections) {
      if (isRecord(correction)) lines.push(`Human correction (unattested input): ${String(correction.content)}`);
    }
  }
  if (isRecord(output.summary)) appendSummary(lines, output.summary, colors);
  if (isRecord(output.decisionBrief)) appendDecisionBrief(lines, output.decisionBrief, colors);
  if (isRecord(output.directive)) {
    lines.push('', `${colors.bold('Next:')} ${String(output.directive.kind ?? '')}`);
    if (typeof output.directive.message === 'string') lines.push(output.directive.message);
  }
  return lines.join('\n');
}

function appendSummary(lines: string[], summary: Record<string, unknown>, colors: Colors): void {
  if (isRecord(summary.facts)) appendSummary(lines, summary.facts, colors);
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
      lines.push(`Human request (unattested input): ${brief.changeMeaning.humanRequest.content}`);
    }
    if (Array.isArray(brief.changeMeaning.humanCorrections)) {
      for (const correction of brief.changeMeaning.humanCorrections) {
        if (isRecord(correction)) lines.push(`Human correction (unattested input): ${String(correction.content)}`);
      }
    }
    if (typeof brief.changeMeaning.intendedOutcome === 'string') {
      lines.push(`Intended: ${brief.changeMeaning.intendedOutcome}`);
    }
    for (const [field, label] of [['constraints', 'Constraint'], ['nonGoals', 'Non-goal']]) {
      const values = brief.changeMeaning[field];
      if (Array.isArray(values)) for (const value of values) lines.push(`${label}: ${String(value)}`);
    }
    if (isRecord(brief.changeMeaning.actualChange)) {
      lines.push(`Behavior: ${String(brief.changeMeaning.actualChange.behavior ?? '')}`);
      for (const mechanism of Array.isArray(brief.changeMeaning.actualChange.mechanism)
        ? brief.changeMeaning.actualChange.mechanism : []) {
        lines.push(`${colors.cyan('•')} Mechanism: ${String(mechanism)}`);
      }
      for (const [field, label] of [
        ['preservedInvariants', 'Invariant'], ['failureAndRecovery', 'Failure and recovery'],
        ['importantEffects', 'Effect'], ['materialTradeoffs', 'Tradeoff'],
      ]) {
        const values = brief.changeMeaning.actualChange[field];
        if (Array.isArray(values)) for (const value of values) lines.push(`${label}: ${String(value)}`);
      }
    }
  }
  if (isRecord(brief.runtimeEvidence)) {
    lines.push('', colors.bold('Runtime verification'));
    if (Array.isArray(brief.runtimeEvidence.changedFiles)) {
      for (const file of brief.runtimeEvidence.changedFiles) {
        if (isRecord(file)) lines.push(`${String(file.operation)}: ${String(file.path)}`);
      }
    }
    if (Array.isArray(brief.runtimeEvidence.checks)) {
      for (const check of brief.runtimeEvidence.checks) {
        if (isRecord(check)) lines.push(`${String(check.key)}: ${JSON.stringify(check.argv)} — ${String(check.status)}`);
      }
    }
    if (isRecord(brief.runtimeEvidence.verificationBoundary)) {
      const boundary = brief.runtimeEvidence.verificationBoundary;
      if (boundary.mode === 'no-command') lines.push(`No command: ${String(boundary.rationale)}`);
      if (boundary.mode === 'checks') lines.push('Checks were run after implementation. Semantic support remains Agent judgment.');
      lines.push('Verifier-change detection covers declared selectors only.');
      if (Array.isArray(boundary.verifierSelectors)) {
        if (!boundary.verifierSelectors.length) lines.push('Verifier selectors: none declared.');
        for (const selector of boundary.verifierSelectors) {
          if (isRecord(selector)) lines.push(`Verifier selector (${String(selector.checkKey)}): ${String(selector.path)} — ${String(selector.role)}`);
        }
      }
    }
    if (isRecord(brief.runtimeEvidence.refresh)) {
      lines.push(`Recheck reason (Agent judgment): ${String(brief.runtimeEvidence.refresh.reason)}`);
    }
  }
  if (isRecord(brief.recommendation)) {
    lines.push('', `${colors.bold('Recommendation:')} ${String(brief.recommendation.action ?? '')}`);
    if (typeof brief.recommendation.rationale === 'string') lines.push(brief.recommendation.rationale);
    if (Array.isArray(brief.recommendation.caveats)) {
      for (const caveat of brief.recommendation.caveats) lines.push(`Caveat: ${String(caveat)}`);
    }
  }
  if (Array.isArray(brief.attention) && brief.attention.length) {
    lines.push('', colors.bold('Attention'));
    for (const item of brief.attention) {
      if (isRecord(item)) {
        lines.push(`${colors.yellow('•')} ${String(item.message ?? item.code ?? '')}`);
        appendEvidence(lines, item.evidence);
      }
    }
  }
  if (Array.isArray(brief.concerns)) {
    for (const concern of brief.concerns) {
      if (!isRecord(concern)) continue;
      lines.push(`Concern (Agent judgment): ${String(concern.statement)} — ${String(concern.status)}`,
        String(concern.summary), `Adoption impact: ${String(concern.adoptionImpact)}`);
      if (Array.isArray(concern.gaps)) for (const gap of concern.gaps) lines.push(`Gap: ${String(gap)}`);
      appendEvidence(lines, concern.evidence);
    }
  }
  if (Array.isArray(brief.unknowns)) {
    for (const unknown of brief.unknowns) {
      if (!isRecord(unknown)) continue;
      lines.push(`Unknown (Agent judgment): ${String(unknown.statement)}`);
      if (typeof unknown.nextAction === 'string') lines.push(`Next: ${unknown.nextAction}`);
      appendEvidence(lines, unknown.evidence);
    }
  }
  if (Array.isArray(brief.reviewFocus) && brief.reviewFocus.length) {
    lines.push('', colors.bold('Review focus'));
    for (const item of brief.reviewFocus) {
      if (isRecord(item)) {
        lines.push(`${colors.cyan('•')} ${String(item.question ?? '')}`,
          `Adoption impact: ${String(item.adoptionImpact)}`, `Review: ${String(item.nextAction)}`);
        appendEvidence(lines, item.evidence);
      }
    }
  }
  if (isRecord(brief.decisionState) && isRecord(brief.decisionState.adoption)
    && brief.decisionState.adoption.status === 'pending') {
    lines.push('', 'Human adoption is pending: accept, request correction, reject, or defer.');
  }
}

function appendEvidence(lines: string[], evidence: unknown): void {
  if (!Array.isArray(evidence)) return;
  for (const item of evidence) {
    if (isRecord(item)) lines.push(`Evidence: ${String(item.path ?? item.checkKey ?? item.kind)}`);
  }
}
