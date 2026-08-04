import type {
  AssurancePlan,
  CognitiveHandoff,
  FactBundle,
  HandoffEvaluation,
  HandoffEvidenceSelection,
} from '@sovea/resonant-code-core';

import { summarizeVerifierSurfaces } from './verifiers.ts';

export function renderCognitiveHandoffMarkdown(input: {
  evaluation: HandoffEvaluation;
  facts: FactBundle;
  handoff: CognitiveHandoff;
  assurancePlan: AssurancePlan;
}): string {
  const { evaluation, facts, handoff, assurancePlan } = input;
  const lines = [
    '## Cognitive Handoff',
    '',
    `Status: \`${evaluation.status}\``,
    '',
    `Assurance: \`${assurancePlan.profile}\``,
  ];
  if (!assurancePlan.requirements.length) {
    lines.push('', 'No predeclared material-claim requirement. Runtime fact triggers and Host-disclosed critical risks still escalate review.');
  } else {
    lines.push('', 'Required assurance dimensions:');
    for (const requirement of assurancePlan.requirements) {
      lines.push(`- \`${requirement.value}\` [${requirement.criticality}] — ${singleLine(requirement.rationale)}`);
    }
  }
  lines.push(
    '',
    '### System meaning update',
    '',
    blockquote(handoff.systemMeaningUpdate),
    '',
    '### Runtime facts',
    '',
    `Fact collection: \`${facts.factCollectionId}\``,
    '',
    `Changed files (${facts.changedFiles.length}):`,
  );
  if (!facts.changedFiles.length) lines.push('- None.');
  for (const file of facts.changedFiles) {
    const previous = file.previousPath ? ` from ${inlineCode(file.previousPath)}` : '';
    lines.push(`- ${inlineCode(file.path)} — ${file.operation}${previous}; ${file.representation}.`);
  }

  lines.push('', `Checks (${facts.checks.length}):`);
  if (!facts.checks.length) lines.push('- None configured.');
  for (const check of facts.checks) {
    const latest = check.attempts.at(-1)!;
    const exit = latest.exitCode === null ? '' : `; exit ${latest.exitCode}`;
    const reason = latest.reason ? `; ${singleLine(latest.reason)}` : '';
    const attempts = check.attempts.length === 1
      ? ''
      : `; ${check.attempts.length} attempts`;
    lines.push(`- \`${check.id}\` — ${latest.status}${exit}${reason}; timeout budget ${latest.timeoutMs} ms${attempts}.`);
    for (const prior of check.attempts.slice(0, -1)) {
      const priorReason = prior.reason ? `; ${singleLine(prior.reason)}` : '';
      lines.push(`  - Attempt ${prior.attempt}: ${prior.status}${priorReason}; timeout budget ${prior.timeoutMs} ms.`);
      appendStreamReference(lines, `attempt ${prior.attempt} stdout`, prior.stdout);
      appendStreamReference(lines, `attempt ${prior.attempt} stderr`, prior.stderr);
    }
    appendStreamReference(lines, 'stdout', latest.stdout);
    appendStreamReference(lines, 'stderr', latest.stderr);
  }

  const verifierSurfaces = summarizeVerifierSurfaces(facts.verifierMutations);
  if (verifierSurfaces.length) {
    lines.push('', 'Changed verifier surfaces:');
    for (const surface of verifierSurfaces) {
      lines.push(`- ${inlineCode(surface.path)} — ${surface.role}; checks: ${surface.checkIds.map((id) => `\`${id}\``).join(', ')}.`);
    }
  }
  if (facts.patch) {
    lines.push('', `Patch: ${inlineCode(facts.patch.path)}; ${facts.patch.byteLength} bytes; \`${facts.patch.digest}\`.`);
  } else {
    lines.push('', 'Patch: no representable text patch was produced.');
  }

  lines.push('', '### Material claims');
  if (!handoff.materialClaims.length) lines.push('', 'None required or disclosed.');
  for (const basis of [
    'repository-evidence',
    'agent-judgment',
    'human-decision',
    'unverified',
  ] as const) {
    const claims = handoff.materialClaims.filter((claim) => claim.basis === basis);
    if (!claims.length) continue;
    lines.push('', `#### ${basis}`);
    for (const claim of claims) {
      const critical = claim.adoptionCritical ? ' [adoption-critical]' : '';
      lines.push(`- \`${claim.id}\`${critical}: ${singleLine(claim.statement)}`);
      lines.push(`  - Adoption consequence: ${singleLine(claim.adoptionConsequence)}`);
      const evidence = formatEvidence(claim.evidence);
      if (evidence) lines.push(`  - Evidence selectors: ${evidence}`);
      if (claim.falsification) {
        lines.push(`  - Falsification: ${claim.falsification.status} — ${singleLine(claim.falsification.conclusion)}`);
        lines.push(`  - Failure hypothesis: ${singleLine(claim.falsification.failureHypothesis)}`);
        lines.push(`  - Challenge attempt: ${singleLine(claim.falsification.attempt)}`);
      }
    }
  }

  if (handoff.materialAlternatives?.length) {
    lines.push('', '### Material alternatives');
    for (const alternative of handoff.materialAlternatives) {
      lines.push(`- \`${alternative.id}\`: ${singleLine(alternative.description)}`);
      lines.push(`  - Tradeoff: ${singleLine(alternative.tradeoff)}`);
      lines.push(`  - Not chosen: ${singleLine(alternative.reasonNotChosen)}`);
    }
  }

  lines.push('', '### Residual unknowns');
  if (!handoff.residualUnknowns.length) lines.push('', 'None disclosed.');
  for (const unknown of handoff.residualUnknowns) {
    lines.push('', `- \`${unknown.id}\`: ${singleLine(unknown.statement)}`);
    lines.push(`  - Adoption impact: ${singleLine(unknown.adoptionImpact)}`);
    lines.push(`  - Validate or take over: ${singleLine(unknown.validationPath)}`);
    lines.push(`  - References: ${formatReferenceParts({
      changedFiles: unknown.references.changedFiles,
      claims: unknown.references.claims,
    }) || 'none'}`);
  }

  lines.push('', '### Attention');
  if (!evaluation.attention.length) lines.push('', 'No unresolved evidence-readiness attention.');
  for (const item of evaluation.attention) {
    lines.push('', `- \`${item.code}\`: ${singleLine(item.summary)}`);
    lines.push(`  - Adoption impact: ${singleLine(item.adoptionImpact)}`);
    const references = formatReferenceParts(item.references);
    if (references) lines.push(`  - Inspect: ${references}`);
    lines.push(`  - Action (${item.resolution.kind}): ${singleLine(item.resolution.action)}`);
  }

  lines.push('', '### Review Map');
  if (!handoff.reviewMap.length) lines.push('', 'No direct-review surface was selected.');
  for (const entry of handoff.reviewMap) {
    lines.push('', `- \`${entry.priority}\` / \`${entry.id}\`: ${singleLine(entry.rationale)}`);
    lines.push(`  - Prevents: ${singleLine(entry.prevents)}`);
    const references = formatReferenceParts({
      changedFiles: entry.changedFiles,
      checks: entry.checkIds,
      claims: entry.claimIds,
      unknowns: entry.unknownIds,
    });
    if (references) lines.push(`  - Inspect: ${references}`);
  }

  lines.push('', '### Adoption authority', '', evaluation.humanAuthorityNotice);
  return lines.join('\n');
}

function appendStreamReference(
  lines: string[],
  label: string,
  stream: FactBundle['checks'][number]['attempts'][number]['stdout'],
): void {
  if (!stream.byteLength && !stream.truncated) return;
  const log = stream.logPath ? `; log ${inlineCode(stream.logPath)}` : '';
  const truncated = stream.truncated ? '; persisted output truncated' : '';
  lines.push(`  - ${label}: ${stream.byteLength} bytes${truncated}${log}.`);
}

function formatEvidence(value: HandoffEvidenceSelection): string {
  return formatReferenceParts({
    changedFiles: value.changedFiles,
    checks: value.checks,
    repositoryEvidence: value.repositoryEvidence,
    humanEvents: value.humanEvents,
    patch: value.patch,
  });
}

function formatReferenceParts(value: {
  changedFiles?: string[];
  checks?: string[];
  claims?: string[];
  unknowns?: string[];
  repositoryEvidence?: string[];
  humanEvents?: string[];
  patch?: boolean;
}): string {
  return [
    formatList('files', value.changedFiles, true),
    formatList('checks', value.checks),
    formatList('claims', value.claims),
    formatList('unknowns', value.unknowns),
    formatList('repository evidence', value.repositoryEvidence),
    formatList('Human Events', value.humanEvents),
    value.patch ? 'complete patch' : '',
  ].filter(Boolean).join('; ');
}

function formatList(label: string, values: string[] | undefined, paths = false): string {
  if (!values?.length) return '';
  return `${label}: ${values.map((value) => paths ? inlineCode(value) : `\`${value}\``).join(', ')}`;
}

function inlineCode(value: string): string {
  const visible = value.replace(/[\u0000-\u001f\u007f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `\`${visible.replaceAll('`', '\\u0060')}\``;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function blockquote(value: string): string {
  return value.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}
