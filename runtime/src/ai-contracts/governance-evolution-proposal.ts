import { existsSync, readFileSync } from 'node:fs';
import { parseYaml } from '../utils/yaml.ts';
import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import { isRecord, validConfidence, validEvidenceRefs } from './shared.ts';
import {
  AI_CONTRACT_VERSION,
  type ContractPayloadDiagnosticEntry,
  type GovernanceEvolutionProposal,
  type GovernanceEvolutionProposalContractInput,
  type GovernanceEvolutionProposalContractOutput,
} from './types.ts';

const GOVERNANCE_EVOLUTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: { type: 'array' },
  },
  required: ['proposals'],
};

export function prepareGovernanceEvolutionProposalContract(
  input: GovernanceEvolutionProposalContractInput,
): GovernanceEvolutionProposalContractOutput {
  const lockfileSummary = input.lockfileSummary ?? summarizeLockfileForEvolution(input.lockfilePath);
  const reviewGroups = buildGovernanceEvolutionReviewGroups();
  const artifact = {
    suggestedPath: input.artifactPath ?? '(review-only-response)',
    format: 'json' as const,
    usage: input.artifactPath
      ? `Write a review-only governance-evolution-proposal payload to ${input.artifactPath}. Runtime validates it but does not modify authoritative files.`
      : 'Return a review-only governance-evolution-proposal payload in the command response. Runtime validates it but does not modify authoritative files.',
  };
  const prompt = [
    'Prepare review-only governance evolution proposals from bounded lockfile summary signals.',
    'Do not write local augment, RCCL, or lockfile state. Runtime/RCCL validators will only accept the proposal as assistive review input.',
    'Use local-override, local-suppress, local-addition, or rccl-refresh only when repeated evidence justifies human review.',
    'Return JSON only.',
    '',
    `Lockfile summary: ${JSON.stringify(lockfileSummary)}`,
    `Review groups: ${JSON.stringify(reviewGroups)}`,
  ].join('\n');
  return {
    proposalPrompt: prompt,
    proposalSchema: JSON.stringify(GOVERNANCE_EVOLUTION_SCHEMA, null, 2),
    proposalArtifact: artifact,
    contract: {
      contractVersion: AI_CONTRACT_VERSION,
      kind: 'governance-evolution-proposal',
      schemaId: 'runtime.governance-evolution-proposal',
      schemaVersion: '2.0',
      prompt,
      schema: GOVERNANCE_EVOLUTION_SCHEMA,
      artifact,
      provenance: { owner: 'runtime', deterministic: true },
      context: {
        lockfileSummary,
        reviewGroups,
        authoritativeWritePolicy: 'review-only; no automatic local augment or RCCL writes',
      },
      cacheKeyMaterial: { schemaId: 'runtime.governance-evolution-proposal', lockfileSummary },
    },
    lockfileSummary,
    reviewGroups,
  };
}

export function validateGovernanceEvolutionProposalPayload(raw: unknown) {
  const entries: ContractPayloadDiagnosticEntry[] = [];
  const proposals: GovernanceEvolutionProposal['proposals'] = [];
  if (!isRecord(raw) || !Array.isArray(raw.proposals)) {
    entries.push({
      status: raw == null ? 'unused' : 'rejected',
      reason: raw == null ? 'empty-payload' : 'malformed-payload',
      path: 'proposals',
      message: 'Governance evolution proposal must include a proposals array.',
    });
    return { proposals, diagnostics: buildContractPayloadDiagnostics('governance-evolution-proposal', entries) };
  }
  raw.proposals.forEach((item, index) => {
    const path = `proposals[${index}]`;
    if (!isRecord(item) || !isProposalKind(item.kind) || typeof item.reason !== 'string' || !validConfidence(item.confidence) || !validEvidenceRefs(item.evidence_refs)) {
      entries.push({
        status: 'rejected',
        reason: 'malformed-payload',
        path,
        message: 'Evolution proposal must include kind, reason, confidence, and evidence_refs.',
        confidence: isRecord(item) && typeof item.confidence === 'number' ? item.confidence : undefined,
      });
      return;
    }
    proposals.push({
      kind: item.kind,
      ...(typeof item.target_id === 'string' ? { target_id: item.target_id } : {}),
      reason: item.reason,
      evidence_refs: item.evidence_refs,
      confidence: item.confidence,
    });
    entries.push({ status: 'accepted', reason: 'accepted', path, message: 'Governance evolution proposal accepted for review.', confidence: item.confidence });
  });
  return { proposals, diagnostics: buildContractPayloadDiagnostics('governance-evolution-proposal', entries) };
}

function isProposalKind(value: unknown): value is GovernanceEvolutionProposal['proposals'][number]['kind'] {
  return value === 'local-override' || value === 'local-suppress' || value === 'local-addition' || value === 'rccl-refresh';
}

function buildGovernanceEvolutionReviewGroups(): GovernanceEvolutionProposalContractOutput['reviewGroups'] {
  return [
    {
      group: 'playbook-candidate',
      proposalKinds: ['local-override', 'local-suppress', 'local-addition'],
      reviewRule: 'Use only for durable prescriptive guidance changes that a human should review before local augment changes.',
    },
    {
      group: 'rccl-candidate',
      proposalKinds: ['rccl-refresh'],
      reviewRule: 'Use for observational signals that should be refreshed through RCCL commit or commit-refresh, never by direct runtime write.',
    },
    {
      group: 'no-action',
      proposalKinds: [],
      reviewRule: 'Prefer no proposal when lockfile signals are weak, one-off, unverified, or already explained by task-local context.',
    },
  ];
}

function summarizeLockfileForEvolution(lockfilePath?: string): unknown {
  if (!lockfilePath || !existsSync(lockfilePath)) {
    return { status: 'absent', directive_count: 0, observation_count: 0, tension_count: 0 };
  }
  try {
    const parsed = parseYaml(readFileSync(lockfilePath, 'utf-8'));
    if (!isRecord(parsed)) return { status: 'unreadable', reason: 'lockfile root is not an object' };
    const directives = isRecord(parsed.directives) ? parsed.directives : {};
    const observations = isRecord(parsed.observations) ? parsed.observations : {};
    const tensions = isRecord(parsed.tensions) ? parsed.tensions : {};
    const governanceSummary = isRecord(parsed.governance_summary) ? parsed.governance_summary : {};
    return {
      status: 'present',
      directive_count: Object.keys(directives).length,
      observation_count: Object.keys(observations).length,
      tension_count: Object.keys(tensions).length,
      total_tasks: numberField(governanceSummary.total_tasks),
      last_tension_count: numberField(governanceSummary.last_tension_count),
      last_observation_count: numberField(governanceSummary.last_observation_count),
      directives: summarizeDirectiveSignals(directives),
      observations: summarizeObservationSignals(observations),
    };
  } catch (error) {
    return {
      status: 'unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeDirectiveSignals(directives: Record<string, unknown>): unknown[] {
  return Object.entries(directives).slice(0, 20).map(([id, value]) => {
    const entry = isRecord(value) ? value : {};
    const quality = isRecord(entry.quality_signal) ? entry.quality_signal : {};
    const overall = isRecord(quality.overall) ? quality.overall : {};
    return {
      id,
      followed: numberField(overall.followed),
      ignored: numberField(overall.ignored),
      partial: numberField(overall.partial),
      unverified: numberField(overall.unverified),
      follow_rate: numberField(overall.follow_rate),
      trend: stringField(overall.trend),
      signal_confidence: stringField(quality.signal_confidence),
      last_evaluation_source: stringField(quality.last_evaluation_source),
    };
  });
}

function summarizeObservationSignals(observations: Record<string, unknown>): unknown[] {
  return Object.entries(observations).slice(0, 20).map(([id, value]) => {
    const entry = isRecord(value) ? value : {};
    return {
      id,
      seen_count: numberField(entry.seen_count),
      relation_count: numberField(entry.relation_count),
      last_disposition: stringField(entry.last_disposition),
      last_lifecycle_status: stringField(entry.last_lifecycle_status),
    };
  });
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
