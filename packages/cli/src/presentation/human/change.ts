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
  if (isRecord(output.contract)) appendContract(lines, output.contract, colors);
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
  if (Array.isArray(output.verifierMutations) && output.verifierMutations.length) {
    lines.push('', colors.bold('Verifier definitions changed'));
    for (const mutation of output.verifierMutations) {
      if (!isRecord(mutation)) continue;
      lines.push(`${colors.yellow('•')} ${String(mutation.path)} [${String(mutation.role)}] affects ${String(mutation.checkId)}`);
    }
  }
  if (isRecord(output.patch)) {
    lines.push('', `${colors.bold('Patch:')} ${String(output.patch.byteLength)} bytes; ${String(output.patch.digest)}`);
  }
  appendNext(lines, output.nextStep, colors);
  return lines.join('\n');
}

export function formatChangeFinalize(output: JsonObject, colors: Colors): string {
  const status = String(output.status ?? 'unknown');
  const title = status === 'handoff-ready'
    ? 'Cognitive Handoff ready for review'
    : status === 'rejected'
      ? 'Cognitive Handoff rejected'
      : 'Cognitive Handoff requires attention';
  const lines = [
    heading(title, colors),
    statusLine(status, colors),
  ];
  if (typeof output.systemMeaningUpdate === 'string') {
    lines.push('', colors.bold('System meaning update'), output.systemMeaningUpdate);
  }
  if (isRecord(output.runtimeFacts)) {
    appendRuntimeFacts(lines, output.runtimeFacts, colors);
  }
  if (Array.isArray(output.materialClaims) && output.materialClaims.length) {
    lines.push('', colors.bold('Material claims'));
    const claims = output.materialClaims.filter(isRecord);
    for (const basis of [
      'repository-evidence',
      'agent-judgment',
      'human-decision',
      'unverified',
    ]) {
      const group = claims.filter((claim) => claim.basis === basis);
      if (!group.length) continue;
      lines.push(colors.bold(basis));
      for (const claim of group) {
        lines.push(`${colors.cyan('•')} ${String(claim.statement)}${claim.adoptionCritical ? ' [adoption-critical]' : ''}`);
      }
    }
  }
  if (Array.isArray(output.residualUnknowns) && output.residualUnknowns.length) {
    lines.push('', colors.bold('Residual unknowns'));
    for (const unknown of output.residualUnknowns) {
      if (!isRecord(unknown)) continue;
      lines.push(`${colors.yellow('•')} ${String(unknown.statement)}`);
      lines.push(`  ${colors.bold('Validate:')} ${String(unknown.validationPath)}`);
    }
  }
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
  if (Array.isArray(output.reviewMap) && output.reviewMap.length) {
    lines.push('', colors.bold('Review Map'));
    for (const entry of output.reviewMap) {
      if (!isRecord(entry)) continue;
      lines.push(`${colors.cyan('•')} ${String(entry.priority)} — ${String(entry.rationale)}`);
      lines.push(`  ${String(entry.prevents)}`);
      const files = stringArray(entry.changedFiles);
      const checks = stringArray(entry.checkIds);
      const claims = stringArray(entry.claimIds);
      const unknowns = stringArray(entry.unknownIds);
      const selections = [
        files.length ? `files: ${files.join(', ')}` : '',
        checks.length ? `checks: ${checks.join(', ')}` : '',
        claims.length ? `claims: ${claims.join(', ')}` : '',
        unknowns.length ? `unknowns: ${unknowns.join(', ')}` : '',
      ].filter(Boolean);
      if (selections.length) lines.push(`  ${colors.bold('Inspect:')} ${selections.join('; ')}`);
    }
  }
  if (typeof output.humanAuthorityNotice === 'string') {
    lines.push('', colors.bold('Adoption authority'), output.humanAuthorityNotice);
  }
  if (isRecord(output.retention)
    && Array.isArray(output.retention.removedCompletedRunIds)
    && output.retention.removedCompletedRunIds.length) {
    lines.push(
      '',
      `${colors.bold('Retention:')} removed ${output.retention.removedCompletedRunIds.length} old completed run(s); prepared and facts-collected runs were untouched.`,
    );
  }
  appendNext(lines, output.nextStep, colors);
  return lines.join('\n');
}

function appendRuntimeFacts(lines: string[], facts: JsonObject, colors: Colors): void {
  lines.push('', colors.bold('Runtime facts'));
  if (typeof facts.factCollectionId === 'string') {
    lines.push(`${colors.bold('Collection:')} ${facts.factCollectionId}`);
  }
  if (Array.isArray(facts.changedFiles)) {
    lines.push(`${colors.bold('Changed files:')} ${facts.changedFiles.length}`);
    for (const file of facts.changedFiles) {
      if (!isRecord(file)) continue;
      const prior = typeof file.previousPath === 'string' ? ` from ${file.previousPath}` : '';
      lines.push(`${colors.cyan('•')} ${String(file.path)} — ${String(file.operation)}${prior}; ${String(file.representation)}`);
    }
  }
  if (Array.isArray(facts.checks)) {
    lines.push(`${colors.bold('Checks:')} ${facts.checks.length}`);
    for (const check of facts.checks) {
      if (!isRecord(check)) continue;
      const reason = typeof check.reason === 'string' ? ` — ${check.reason}` : '';
      lines.push(`${colors.cyan('•')} ${String(check.id)} — ${String(check.status)}${reason}`);
    }
  }
  if (Array.isArray(facts.verifierMutations) && facts.verifierMutations.length) {
    lines.push(colors.bold('Verifier mutations'));
    for (const mutation of facts.verifierMutations) {
      if (!isRecord(mutation)) continue;
      lines.push(`${colors.yellow('•')} ${String(mutation.path)} [${String(mutation.role)}] affects ${String(mutation.checkId)}`);
    }
  }
  if (isRecord(facts.patch)) {
    lines.push(`${colors.bold('Patch:')} ${String(facts.patch.byteLength)} bytes; ${String(facts.patch.digest)}`);
  }
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
  lines.push('', colors.dim('Use --json for exact Human Events, interpretations, facts, evidence, logs, and evaluation.'));
  return lines.join('\n');
}

function appendContract(lines: string[], contract: JsonObject, colors: Colors): void {
  if (isRecord(contract.authority) && Array.isArray(contract.authority.humanEvents)) {
    lines.push('', colors.bold('Exact Human Events'));
    for (const event of contract.authority.humanEvents) {
      if (!isRecord(event)) continue;
      lines.push(`${colors.cyan('•')} ${String(event.id)}: ${String(event.content)}`);
    }
  }
  if (Array.isArray(contract.interpretationTrace)) {
    lines.push('', colors.bold('Agent interpretations'));
    for (const interpretation of contract.interpretationTrace) {
      if (!isRecord(interpretation)) continue;
      const basis = isRecord(interpretation.basis)
        ? [...(Array.isArray(interpretation.basis.humanEventIds) ? interpretation.basis.humanEventIds : []),
            ...(Array.isArray(interpretation.basis.repositoryEvidenceIds) ? interpretation.basis.repositoryEvidenceIds : [])]
        : [];
      lines.push(`${colors.cyan('•')} ${String(interpretation.field)}: ${String(interpretation.value)} <- ${basis.join(', ')}`);
    }
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

function appendNext(lines: string[], value: unknown, colors: Colors): void {
  if (typeof value === 'string') lines.push('', `${colors.bold('Next:')} ${value}`);
}
