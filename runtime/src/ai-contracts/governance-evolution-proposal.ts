import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import { isRecord, validConfidence, validEvidenceRefs } from './shared.ts';
import type {
  ContractPayloadDiagnosticEntry,
  GovernanceEvolutionProposal,
} from './types.ts';

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
