import type { Colors } from 'picocolors/types';

import {
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
  appendNext(lines, output.nextStep, colors);
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
      lines.push(`${colors.cyan('•')} ${String(check.id)} — ${String(check.status)}`);
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
  appendNext(lines, output.nextStep, colors);
  return lines.join('\n');
}

export function formatChangeFinalize(output: JsonObject, colors: Colors): string {
  if (typeof output.presentationMarkdown === 'string') {
    const lines = [output.presentationMarkdown];
    appendNext(lines, output.nextStep, colors);
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
  appendNext(lines, output.nextStep, colors);
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
  if (Array.isArray(contract.humanEvents)) {
    lines.push('', colors.bold('Exact Human Events'));
    for (const event of contract.humanEvents) {
      if (!isRecord(event)) continue;
      lines.push(`${colors.cyan('•')} ${String(event.id)}: ${String(event.content)}`);
    }
  }
  if (Array.isArray(contract.interpretations)) {
    lines.push('', colors.bold('Agent interpretations'));
    for (const interpretation of contract.interpretations) {
      if (!isRecord(interpretation)) continue;
      const basis = isRecord(interpretation.basis)
        ? [...(Array.isArray(interpretation.basis.humanEventIds) ? interpretation.basis.humanEventIds : []),
            ...(Array.isArray(interpretation.basis.repositoryEvidenceIds) ? interpretation.basis.repositoryEvidenceIds : [])]
        : [];
      lines.push(`${colors.cyan('•')} ${String(interpretation.field)}: ${String(interpretation.value)} <- ${basis.join(', ')}`);
    }
  }
  if (isRecord(contract.assurancePlan)) {
    appendAssurancePlan(lines, contract.assurancePlan, colors);
  }
  if (isRecord(contract.authorization)) {
    lines.push('', colors.bold('Delegation boundary'));
    lines.push(String(contract.authorization.standingAuthorization));
    if (Array.isArray(contract.authorization.escalationBoundary)) {
      for (const boundary of contract.authorization.escalationBoundary) {
        lines.push(`${colors.yellow('•')} ${String(boundary)}`);
      }
    }
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

function appendNext(lines: string[], value: unknown, colors: Colors): void {
  if (typeof value === 'string') lines.push('', `${colors.bold('Next:')} ${value}`);
}
