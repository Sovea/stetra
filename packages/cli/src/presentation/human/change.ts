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
    heading(status === 'prepared' ? 'Semantic Contract prepared' : 'Semantic Contract not runnable', colors),
    statusLine(status, colors),
  ];
  if (isRecord(output.semanticContract)) {
    appendContract(lines, output.semanticContract, colors);
  }
  if (Array.isArray(output.issues) && output.issues.length) {
    lines.push('', colors.bold(status === 'authority-invalid' ? 'Authority issues' : 'Preparation issues'));
    for (const issue of output.issues) {
      if (!isRecord(issue)) continue;
      lines.push(`${colors.yellow('•')} ${String(issue.path)}: ${String(issue.message)}`);
      if (typeof issue.remediation === 'string') {
        lines.push(`  ${colors.bold('Action:')} ${issue.remediation}`);
      }
    }
  }
  if (isRecord(output.fork)) {
    lines.push('', colors.bold('Human decision required'));
    lines.push(String(output.fork.question));
    if (Array.isArray(output.fork.alternatives)) {
      for (const alternative of output.fork.alternatives) {
        lines.push(`${colors.yellow('•')} ${String(alternative)}`);
      }
    }
    if (typeof output.fork.decisionImpact === 'string') {
      lines.push(`${colors.bold('Decision impact:')} ${output.fork.decisionImpact}`);
    }
  }
  if (isRecord(output.baseline)) {
    lines.push(
      '',
      `${colors.bold('Baseline:')} ${String(output.baseline.entryCount ?? 0)} files; ${String(output.baseline.fingerprint ?? 'unknown fingerprint')}`,
    );
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeCollect(output: JsonObject, colors: Colors): string {
  const lines = [
    heading('Actual change collected', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (isRecord(output.assurancePlan)) {
    appendAssurancePlan(lines, output.assurancePlan, colors);
  }
  if (Array.isArray(output.changedFiles)) {
    const counts = countValues(output.changedFiles
      .filter(isRecord)
      .map((file) => String(file.operation ?? 'unknown')));
    lines.push(`${colors.bold('Changed files:')} ${output.changedFiles.length}${formatCounts(counts)}`);
    for (const file of output.changedFiles) {
      if (!isRecord(file)) continue;
      const prior = typeof file.previousPath === 'string' ? ` from ${file.previousPath}` : '';
      lines.push(`${colors.cyan('•')} ${String(file.path)} — ${String(file.operation)}${prior}; ${String(file.representation)}`);
    }
  }
  if (Array.isArray(output.checks)) {
    const counts = countValues(output.checks
      .filter(isRecord)
      .map((check) => String(check.status ?? 'unknown')));
    lines.push('', `${colors.bold('Checks:')} ${output.checks.length}${formatCounts(counts)}`);
    for (const check of output.checks) {
      if (!isRecord(check)) continue;
      const attempts = Number(check.attemptCount ?? 0);
      const suffix = attempts > 1 ? `; ${attempts} attempts` : '';
      const timeout = Number.isFinite(Number(check.timeoutMs))
        ? `; timeout ${String(check.timeoutMs)} ms`
        : '';
      lines.push(`${colors.cyan('•')} ${String(check.id)} — ${String(check.status)}${timeout}${suffix}`);
    }
  }
  if (Array.isArray(output.verifierSurfaces) && output.verifierSurfaces.length) {
    lines.push('', colors.bold('Verifier definitions changed'));
    for (const mutation of output.verifierSurfaces) {
      if (!isRecord(mutation)) continue;
      const checkIds = stringArray(mutation.checkIds);
      lines.push(`${colors.yellow('•')} ${String(mutation.path)} [${String(mutation.role)}] affects ${checkIds.join(', ')}`);
    }
  }
  if (isRecord(output.patch)) {
    lines.push('', `${colors.bold('Patch:')} ${String(output.patch.byteLength)} bytes; ${String(output.patch.digest)}`);
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

export function formatChangeFinalize(output: JsonObject, colors: Colors): string {
  if (typeof output.presentationMarkdown === 'string') {
    const lines = [output.presentationMarkdown];
    appendHostAction(lines, output.hostAction, colors);
    return lines.join('\n');
  }
  const status = String(output.status ?? 'unknown');
  const lines = [
    heading('Cognitive Handoff not completed', colors),
    statusLine(status, colors),
  ];
  if (Array.isArray(output.attention) && output.attention.length) {
    lines.push('', colors.bold('Attention'));
    for (const item of output.attention) {
      if (!isRecord(item)) continue;
      lines.push(`${colors.yellow('•')} ${String(item.summary ?? item.code)} [${String(item.code)}]`);
      if (typeof item.adoptionImpact === 'string') {
        lines.push(`  ${colors.bold('Impact:')} ${item.adoptionImpact}`);
      }
      if (isRecord(item.references)) {
        const references = formatAttentionReferences(item.references);
        if (references) lines.push(`  ${colors.bold('Inspect:')} ${references}`);
      }
      if (isRecord(item.resolution)) {
        lines.push(`  ${colors.bold(`Action (${String(item.resolution.kind)}):`)} ${String(item.resolution.action)}`);
      }
    }
  }
  if (typeof output.humanAuthorityNotice === 'string') {
    lines.push('', colors.bold('Adoption authority'), output.humanAuthorityNotice);
  }
  appendHostAction(lines, output.hostAction, colors);
  return lines.join('\n');
}

function formatAttentionReferences(value: JsonObject): string {
  const references = [
    listReference('files', value.changedFiles),
    listReference('checks', value.checks),
    listReference('claims', value.claims),
    listReference('unknowns', value.unknowns),
    listReference('repository evidence', value.repositoryEvidence),
    listReference('Human Events', value.humanEvents),
    value.patch === true ? 'complete patch' : '',
  ].filter(Boolean);
  return references.join('; ');
}

function listReference(label: string, value: unknown): string {
  const values = stringArray(value);
  return values.length ? `${label}: ${values.join(', ')}` : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function formatChangeExplain(output: JsonObject, colors: Colors): string {
  if (typeof output.presentationMarkdown === 'string') {
    return output.presentationMarkdown;
  }
  const lines = [
    heading('Semantic Handoff run', colors),
    statusLine(String(output.state ?? 'unknown'), colors),
  ];
  if (isRecord(output.contract) && isRecord(output.contract.semantic)) {
    const outcome = output.contract.semantic.desiredOutcome;
    if (isRecord(outcome)) lines.push('', `${colors.bold('Desired outcome:')} ${String(outcome.value)}`);
  }
  if (isRecord(output.factBundle) && Array.isArray(output.factBundle.changedFiles)) {
    lines.push(`${colors.bold('Collected files:')} ${output.factBundle.changedFiles.length}`);
  }
  if (isRecord(output.handoff) && typeof output.handoff.systemMeaningUpdate === 'string') {
    lines.push('', colors.bold('System meaning update'), output.handoff.systemMeaningUpdate);
  }
  if (isRecord(output.evaluation)) {
    lines.push(`${colors.bold('Evaluation:')} ${String(output.evaluation.status ?? 'unknown')}`);
  }
  if (typeof output.issue === 'string') {
    lines.push('', `${colors.yellow('•')} ${output.issue}`);
  }
  lines.push('', colors.dim('Use --json for exact Human Events, interpretations, facts, evidence, logs, and evaluation.'));
  return lines.join('\n');
}

function appendContract(lines: string[], contract: JsonObject, colors: Colors): void {
  if (isRecord(contract.semantic)) {
    lines.push('', colors.bold('Compiled semantics'));
    appendSemanticValue(lines, 'Desired outcome', contract.semantic.desiredOutcome, colors);
    appendSemanticValues(lines, 'Constraint', contract.semantic.constraints, colors);
    appendSemanticValues(lines, 'Non-goal', contract.semantic.nonGoals, colors);
    appendSemanticValues(lines, 'Focus', contract.semantic.focus, colors);
    appendSemanticValue(lines, 'Consequence', contract.semantic.consequence, colors);
  }
  if (isRecord(contract.assurancePlan)) {
    appendAssurancePlan(lines, contract.assurancePlan, colors);
  }
  if (isRecord(contract.authority)) {
    const eventIds = stringArray(contract.authority.humanEventIds);
    const evidenceIds = stringArray(contract.authority.repositoryEvidenceIds);
    lines.push('', colors.bold('Authority references'));
    lines.push(`Human Events: ${eventIds.length ? eventIds.join(', ') : 'none'}`);
    lines.push(`Repository evidence: ${evidenceIds.length ? evidenceIds.join(', ') : 'none'}`);
  }
  if (isRecord(contract.verification)) {
    lines.push('', colors.bold('Frozen verification'));
    if (contract.verification.mode === 'checks' && Array.isArray(contract.verification.checks)) {
      for (const check of contract.verification.checks) {
        if (!isRecord(check)) continue;
        lines.push(`${colors.cyan('•')} ${String(check.id)} [${String(check.source)}] — ${String(check.rationale)}`);
      }
    } else {
      lines.push(`No command: ${String(contract.verification.rationale ?? '')}`);
    }
  }
}

function appendSemanticValues(
  lines: string[],
  label: string,
  values: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(values)) return;
  for (const value of values) appendSemanticValue(lines, label, value, colors);
}

function appendSemanticValue(
  lines: string[],
  label: string,
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value)) return;
  const basis = isRecord(value.basis)
    ? [
        ...stringArray(value.basis.humanEventIds),
        ...stringArray(value.basis.repositoryEvidenceIds),
      ]
    : [];
  const source = basis.length ? ` <- ${basis.join(', ')}` : '';
  lines.push(`${colors.cyan('•')} ${label}: ${String(value.value)}${source}`);
}

function appendAssurancePlan(lines: string[], plan: JsonObject, colors: Colors): void {
  lines.push('', colors.bold(`Assurance: ${String(plan.profile ?? 'unknown')}`));
  const requirements = plan.requirements;
  if (!Array.isArray(requirements) || !requirements.length) {
    lines.push('No predeclared material-claim requirement.');
    return;
  }
  for (const requirement of requirements) {
    if (!isRecord(requirement)) continue;
    lines.push(`${colors.cyan('•')} ${String(requirement.value)} [${String(requirement.criticality)}] — ${String(requirement.rationale)}`);
  }
}
