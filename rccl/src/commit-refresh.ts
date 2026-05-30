import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { consolidateObservations, materializeRcclObservations } from './consolidate/consolidate-observations.ts';
import { emitRccl, writeCandidateArtifact, writeConsolidationArtifact } from './io/emit-rccl.ts';
import { parseRccl } from './io/parse-rccl.ts';
import { validateRcclObservationRefreshPayload } from './validate-refresh.ts';
import { verifyEvidenceForDocument } from './verify/verify-evidence.ts';
import { verifyInductionForDocument } from './verify/verify-induction.ts';
import type {
  CandidateObservation,
  CandidateRcclDocument,
  CommitRcclObservationRefreshOptions,
  CommitRcclObservationRefreshResult,
  ConsolidationResult,
  EvidenceRef,
  RcclCounterexampleCommitSummary,
  RcclCounterexampleProposal,
  RcclDocument,
  RcclObservation,
  RcclObservationRefreshDocument,
  RcclObservationRefreshSummary,
  RcclSemanticEquivalenceCommitSummary,
  RcclSemanticEquivalenceProposal,
} from './types.ts';

const MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE = 0.7;
const MIN_COUNTEREXAMPLE_CONFIDENCE = 0.7;

interface ProposalAdjudication {
  accepted: boolean;
  reason: string;
}

interface EvidenceRefVerification {
  verified: boolean;
  verifiedCount: number;
  strongCount: number;
  verifiedRefs: EvidenceRef[];
  reason: string;
}

export function commitRcclObservationRefresh(
  projectRootInput: string,
  yamlText: string,
  options: CommitRcclObservationRefreshOptions = {},
): CommitRcclObservationRefreshResult {
  const projectRoot = resolve(projectRootInput);
  const existingPath = join(projectRoot, '.resonant-code', 'rccl.yaml');
  if (!existsSync(existingPath)) {
    return {
      status: 'failed',
      reason: 'missing-existing-rccl',
      errors: ['Existing .resonant-code/rccl.yaml is required before committing an incremental refresh.'],
    };
  }

  const parsedExisting = parseRccl(readFileSync(existingPath, 'utf-8'), { allowVerifiedFields: true });
  if (!parsedExisting.valid || !parsedExisting.data) {
    return {
      status: 'failed',
      reason: 'invalid-existing-rccl',
      errors: parsedExisting.errors ?? ['Existing .resonant-code/rccl.yaml could not be parsed.'],
    };
  }

  const existing = parsedExisting.data;
  const activeExisting = existing.observations.filter(isActiveObservation);
  const validation = validateRcclObservationRefreshPayload(yamlText, {
    allowedObservationIds: existing.observations.map((observation) => observation.id),
    activeObservationIds: activeExisting.map((observation) => observation.id),
  });

  if (!validation.valid || !validation.document) {
    return {
      status: 'failed',
      reason: 'invalid-refresh-payload',
      diagnostics: validation.diagnostics,
    };
  }

  const materialized = materializeRefresh(existing, validation.document, projectRoot);
  const draftDocument: RcclDocument = {
    version: '1.0',
    generated_at: validation.document.generated_at,
    git_ref: existing.git_ref,
    observations: materialized.activeObservations,
  };
  const evidenceVerified = verifyEvidenceForDocument(draftDocument, projectRoot);
  const verified = verifyInductionForDocument(evidenceVerified);
  const counterexampleAdjudication = applyCounterexamples(verified, validation.document.counterexamples ?? [], projectRoot);
  const result = emitRccl(counterexampleAdjudication.document, projectRoot);
  const debugArtifacts = options.debugArtifacts
    ? {
      enabled: true,
      candidates: writeCandidateArtifact(projectRoot, materialized.candidateDocument),
      consolidation: writeConsolidationArtifact(projectRoot, materialized.consolidation, counterexampleAdjudication.document),
    }
    : { enabled: false };

  return {
    status: 'committed',
    diagnostics: validation.diagnostics,
    refresh_summary: {
      ...materialized.summary,
      counterexamples: counterexampleAdjudication.summary,
    },
    result,
    debugArtifacts,
  };
}

function materializeRefresh(existing: RcclDocument, refresh: RcclObservationRefreshDocument, projectRoot: string): {
  activeObservations: RcclObservation[];
  candidateDocument: CandidateRcclDocument;
  consolidation: ConsolidationResult;
  summary: RcclObservationRefreshSummary;
} {
  const revisedCandidates = refresh.revise;
  const newCandidates = refresh.new_observations;
  const changedCandidates = [...revisedCandidates, ...newCandidates];
  const revisedById = new Map(revisedCandidates.map((candidate) => [candidate.provisional_id, materializeCandidate(candidate)]));
  const newObservations = newCandidates.map(materializeCandidate);
  const retiredIds = new Set(refresh.retire.map((entry) => entry.observation_id));
  const usedRevisions = new Set<string>();
  const carriedForward: string[] = [];
  const activeObservations: RcclObservation[] = [];

  for (const observation of existing.observations.filter(isActiveObservation)) {
    if (retiredIds.has(observation.id)) continue;
    const revised = revisedById.get(observation.id);
    if (revised) {
      activeObservations.push(revised);
      usedRevisions.add(observation.id);
      continue;
    }
    activeObservations.push(stripLifecycle(observation));
    if (!refresh.keep.includes(observation.id)) carriedForward.push(observation.id);
  }

  for (const id of revisedById.keys()) {
    if (!usedRevisions.has(id)) throw new Error(`Refresh revise "${id}" did not match an active observation.`);
  }
  activeObservations.push(...newObservations);
  const equivalenceAdjudication = applySemanticEquivalence(activeObservations, refresh.semantic_equivalence ?? [], projectRoot);

  const candidateDocument: CandidateRcclDocument = {
    version: '1.0',
    generated_at: refresh.generated_at,
    git_ref: existing.git_ref,
    observations: changedCandidates,
  };
  const consolidation = consolidateObservations(changedCandidates);

  return {
    activeObservations: equivalenceAdjudication.observations.sort((a, b) => a.id.localeCompare(b.id)),
    candidateDocument,
    consolidation,
    summary: {
      previous_observation_count: existing.observations.length,
      active_observation_count: equivalenceAdjudication.observations.length,
      kept: refresh.keep.slice().sort(),
      carried_forward: carriedForward.sort(),
      revised: revisedCandidates.map((candidate) => candidate.provisional_id).sort(),
      retired: refresh.retire.map((entry) => entry.observation_id).sort(),
      added: newCandidates.map((candidate) => candidate.provisional_id).sort(),
      semantic_equivalence: equivalenceAdjudication.summary,
      counterexamples: [],
    },
  };
}

function materializeCandidate(candidate: CandidateObservation): RcclObservation {
  const consolidation = consolidateObservations([candidate]);
  const [observation] = materializeRcclObservations(consolidation.observations);
  if (!observation) throw new Error(`Refresh candidate "${candidate.provisional_id}" could not be materialized.`);
  return observation;
}

function isActiveObservation(observation: RcclObservation): boolean {
  return observation.lifecycle?.status == null || observation.lifecycle.status === 'active';
}

function stripLifecycle(observation: RcclObservation): RcclObservation {
  const { lifecycle: _lifecycle, ...rest } = observation;
  return rest;
}

function applySemanticEquivalence(
  observations: RcclObservation[],
  proposals: RcclSemanticEquivalenceProposal[],
  projectRoot: string,
): { observations: RcclObservation[]; summary: RcclSemanticEquivalenceCommitSummary[] } {
  let current = observations.slice();
  const summary: RcclSemanticEquivalenceCommitSummary[] = [];

  for (const proposal of proposals) {
    const byId = new Map(current.map((observation) => [observation.id, observation]));
    const group = uniqueStrings(proposal.observation_ids)
      .map((id) => byId.get(id))
      .filter((observation): observation is RcclObservation => Boolean(observation));

    if (group.length < 2) {
      summary.push({
        observation_ids: proposal.observation_ids.slice().sort(),
        canonical_id: group[0]?.id ?? null,
        superseded_ids: [],
        confidence: proposal.confidence,
        status: 'unused',
        reason: 'semantic equivalence proposal did not reference at least two active observations after refresh actions',
      });
      continue;
    }

    const adjudication = adjudicateSemanticEquivalenceProposal(group, proposal, projectRoot);
    if (!adjudication.accepted) {
      summary.push({
        observation_ids: proposal.observation_ids.slice().sort(),
        canonical_id: null,
        superseded_ids: [],
        confidence: proposal.confidence,
        status: 'rejected',
        reason: adjudication.reason,
      });
      continue;
    }

    const canonical = chooseCanonicalObservation(group);
    const supersededIds = group
      .map((observation) => observation.id)
      .filter((id) => id !== canonical.id)
      .sort();
    const merged = mergeEquivalentObservations(canonical, group, supersededIds, proposal);
    current = current
      .filter((observation) => !supersededIds.includes(observation.id))
      .map((observation) => observation.id === canonical.id ? merged : observation);
    summary.push({
      observation_ids: proposal.observation_ids.slice().sort(),
      canonical_id: canonical.id,
      superseded_ids: supersededIds,
      confidence: proposal.confidence,
      status: 'applied',
      reason: proposal.reason,
    });
  }

  return { observations: current, summary };
}

function applyCounterexamples(
  document: RcclDocument,
  proposals: RcclCounterexampleProposal[],
  projectRoot: string,
): { document: RcclDocument; summary: RcclCounterexampleCommitSummary[] } {
  if (!proposals.length) return { document, summary: [] };

  const proposalsByObservation = new Map<string, RcclCounterexampleProposal[]>();
  for (const proposal of proposals) {
    const current = proposalsByObservation.get(proposal.observation_id) ?? [];
    current.push(proposal);
    proposalsByObservation.set(proposal.observation_id, current);
  }

  const summary: RcclCounterexampleCommitSummary[] = [];
  const handled = new Set<RcclCounterexampleProposal>();
  const observations = document.observations.map((observation) => {
    const candidates = (proposalsByObservation.get(observation.id) ?? [])
      .slice()
      .sort((left, right) => right.confidence - left.confidence);
    for (const proposal of candidates) {
      handled.add(proposal);
      const adjudication = adjudicateCounterexampleProposal(observation, proposal, projectRoot);
      if (!adjudication.accepted) {
        summary.push({
          observation_id: observation.id,
          confidence: proposal.confidence,
          status: 'rejected',
          action: 'none',
          reason: adjudication.reason,
        });
        continue;
      }
      const action = resolveCounterexampleAction(observation, proposal);
      summary.push({
        observation_id: observation.id,
        confidence: proposal.confidence,
        status: 'applied',
        action,
        reason: adjudication.reason,
      });
      return applyCounterexampleToObservation(observation, proposal, action);
    }
    return observation;
  });

  for (const proposal of proposals) {
    if (handled.has(proposal)) continue;
    summary.push({
      observation_id: proposal.observation_id,
      confidence: proposal.confidence,
      status: 'unused',
      action: 'none',
      reason: 'counterexample proposal did not reference an active observation after refresh materialization',
    });
  }

  return {
    document: { ...document, observations },
    summary: summary.sort((a, b) => a.observation_id.localeCompare(b.observation_id)),
  };
}

function adjudicateSemanticEquivalenceProposal(
  group: RcclObservation[],
  proposal: RcclSemanticEquivalenceProposal,
  projectRoot: string,
): ProposalAdjudication {
  if (proposal.confidence < MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE) {
    return rejectedAdjudication(`semantic equivalence confidence ${proposal.confidence} is below commit threshold ${MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE}`);
  }
  if (!sameCategory(group)) {
    return rejectedAdjudication('semantic equivalence rejected because observations are in different RCCL categories');
  }
  if (!semanticallyCompatibleObservations(group)) {
    return rejectedAdjudication('semantic equivalence rejected because semantic_key and pattern similarity are not deterministically compatible');
  }
  if (!hasObservationSupportOverlap(group)) {
    return rejectedAdjudication('semantic equivalence rejected because observations have no overlapping scope or evidence files');
  }
  const evidence = verifyProposalEvidenceRefs(proposal.evidence_refs, projectRoot, group);
  if (!evidence.verified) {
    return rejectedAdjudication(`semantic equivalence rejected because proposal evidence_refs failed static verification: ${evidence.reason}`);
  }
  return acceptedAdjudication(`semantic equivalence accepted after category, semantic-key/pattern, support-overlap, and evidence verification gates; ${proposal.reason}`);
}

function adjudicateCounterexampleProposal(
  observation: RcclObservation,
  proposal: RcclCounterexampleProposal,
  projectRoot: string,
): ProposalAdjudication {
  if (proposal.confidence < MIN_COUNTEREXAMPLE_CONFIDENCE) {
    return rejectedAdjudication(`counterexample confidence ${proposal.confidence} is below commit threshold ${MIN_COUNTEREXAMPLE_CONFIDENCE}`);
  }
  const evidence = verifyProposalEvidenceRefs(proposal.evidence_refs, projectRoot, [observation]);
  if (!evidence.verified) {
    return rejectedAdjudication(`counterexample rejected because evidence_refs failed static verification: ${evidence.reason}`);
  }
  if (!counterexampleTouchesObservationScope(evidence.verifiedRefs, observation)) {
    return rejectedAdjudication('counterexample rejected because verified evidence is outside the observation scope and evidence files');
  }
  if (!counterexampleAddsIndependentEvidence(evidence.verifiedRefs, observation)) {
    return rejectedAdjudication('counterexample rejected because verified evidence only restates the observation evidence instead of adding independent counterevidence');
  }
  return acceptedAdjudication(`counterexample accepted after static evidence verification and scope adjudication; ${proposal.reason}`);
}

function acceptedAdjudication(reason: string): ProposalAdjudication {
  return { accepted: true, reason };
}

function rejectedAdjudication(reason: string): ProposalAdjudication {
  return { accepted: false, reason };
}

function applyCounterexampleToObservation(
  observation: RcclObservation,
  proposal: RcclCounterexampleProposal,
  action: RcclCounterexampleCommitSummary['action'],
): RcclObservation {
  const confidenceCeiling = action === 'demoted-to-ambient' ? 0.4 : 0.6;
  const evidenceConfidence = Math.min(observation.verification.evidence_confidence ?? observation.confidence, confidenceCeiling);
  const inductionConfidence = Math.min(observation.verification.induction_confidence ?? evidenceConfidence, confidenceCeiling);
  return {
    ...observation,
    confidence: Number(Math.min(observation.confidence, Math.max(0.2, 1 - proposal.confidence), confidenceCeiling).toFixed(2)),
    verification: {
      ...observation.verification,
      evidence_confidence: Number(evidenceConfidence.toFixed(2)),
      induction_status: action === 'demoted-to-ambient' ? 'ambiguous' : observation.verification.induction_status,
      induction_confidence: Number(inductionConfidence.toFixed(2)),
      disposition: action === 'demoted-to-ambient' ? 'demote-to-ambient' : downgradeDisposition(observation.verification.disposition),
    },
  };
}

function resolveCounterexampleAction(
  observation: RcclObservation,
  proposal: RcclCounterexampleProposal,
): RcclCounterexampleCommitSummary['action'] {
  const broadScope = observation.support.scope_basis !== 'single-file'
    || observation.scope.includes('*')
    || observation.scope.endsWith('/')
    || !observation.evidence.some((evidence) => normalizePath(evidence.file) === normalizePath(observation.scope));
  const alreadyWeak = observation.verification.disposition !== 'keep'
    || observation.verification.induction_status === 'overgeneralized'
    || observation.verification.induction_status === 'ambiguous';
  if (proposal.confidence >= 0.85 && (broadScope || alreadyWeak)) return 'demoted-to-ambient';
  return 'reduced-confidence';
}

function downgradeDisposition(disposition: RcclObservation['verification']['disposition']): RcclObservation['verification']['disposition'] {
  if (disposition === 'demote-to-ambient') return disposition;
  return 'keep-with-reduced-confidence';
}

function chooseCanonicalObservation(group: RcclObservation[]): RcclObservation {
  return group.slice().sort((left, right) => {
    const confidence = right.confidence - left.confidence;
    if (confidence !== 0) return confidence;
    const evidenceCount = right.evidence.length - left.evidence.length;
    if (evidenceCount !== 0) return evidenceCount;
    return left.id.localeCompare(right.id);
  })[0];
}

function mergeEquivalentObservations(
  canonical: RcclObservation,
  group: RcclObservation[],
  supersededIds: string[],
  proposal: RcclSemanticEquivalenceProposal,
): RcclObservation {
  const evidence = dedupeEvidence(group.flatMap((observation) => observation.evidence));
  const sourceSlices = uniqueStrings(group.flatMap((observation) => observation.support.source_slices));
  const supersedes = uniqueStrings([
    ...(canonical.lifecycle?.supersedes ?? []),
    ...supersededIds,
  ]).sort();
  return {
    ...canonical,
    confidence: Number(Math.min(Math.max(...group.map((observation) => observation.confidence)), proposal.confidence).toFixed(2)),
    evidence,
    support: {
      source_slices: sourceSlices,
      file_count: Math.max(uniqueStrings(evidence.map((item) => normalizePath(item.file))).length, canonical.support.file_count),
      cluster_count: Math.max(...group.map((observation) => observation.support.cluster_count)),
      scope_basis: canonical.support.scope_basis,
    },
    verification: {
      evidence_status: null,
      evidence_verified_count: null,
      evidence_confidence: null,
      induction_status: null,
      induction_confidence: null,
      checked_at: null,
      disposition: null,
    },
    lifecycle: {
      first_seen_git_ref: canonical.lifecycle?.first_seen_git_ref ?? null,
      last_seen_git_ref: canonical.lifecycle?.last_seen_git_ref ?? null,
      last_verified_at: canonical.lifecycle?.last_verified_at ?? null,
      content_fingerprint: canonical.lifecycle?.content_fingerprint ?? 'semantic-equivalence-merge',
      status: 'active',
      supersedes,
    },
  };
}

function dedupeEvidence(evidence: RcclObservation['evidence']): RcclObservation['evidence'] {
  const byKey = new Map<string, RcclObservation['evidence'][number]>();
  for (const item of evidence) {
    const normalized = {
      file: normalizePath(item.file),
      line_range: [item.line_range[0], item.line_range[1]] as [number, number],
      snippet: item.snippet,
    };
    const key = `${normalized.file}:${normalized.line_range[0]}-${normalized.line_range[1]}:${normalized.snippet}`;
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const file = left.file.localeCompare(right.file);
    if (file !== 0) return file;
    if (left.line_range[0] !== right.line_range[0]) return left.line_range[0] - right.line_range[0];
    return left.line_range[1] - right.line_range[1];
  });
}

function sameCategory(observations: RcclObservation[]): boolean {
  return new Set(observations.map((observation) => observation.category)).size === 1;
}

function semanticallyCompatibleObservations(observations: RcclObservation[]): boolean {
  if (new Set(observations.map((observation) => observation.semantic_key)).size === 1) return true;
  for (let index = 0; index < observations.length; index += 1) {
    for (let next = index + 1; next < observations.length; next += 1) {
      if (textSimilarity(semanticText(observations[index]), semanticText(observations[next])) < 0.72) return false;
    }
  }
  return true;
}

function semanticText(observation: RcclObservation): string {
  return `${observation.semantic_key} ${observation.category} ${observation.pattern}`;
}

function hasObservationSupportOverlap(observations: RcclObservation[]): boolean {
  return observations.every((observation) =>
    observations.some((other) => other.id !== observation.id && observationsOverlap(observation, other)));
}

function observationsOverlap(left: RcclObservation, right: RcclObservation): boolean {
  return scopesOverlap(left.scope, right.scope)
    || evidenceFilesOverlap(left, right)
    || sourceSlicesOverlap(left, right);
}

function sourceSlicesOverlap(left: RcclObservation, right: RcclObservation): boolean {
  const rightSlices = new Set(right.support.source_slices);
  return left.support.source_slices.some((slice) => rightSlices.has(slice));
}

function evidenceFilesOverlap(left: RcclObservation, right: RcclObservation): boolean {
  const rightFiles = new Set(right.evidence.map((evidence) => normalizePath(evidence.file)));
  return left.evidence.some((evidence) => rightFiles.has(normalizePath(evidence.file)));
}

function scopesOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeScope(left);
  const normalizedRight = normalizeScope(right);
  if (normalizedLeft === '*' || normalizedLeft === '**' || normalizedLeft === '**/*') return true;
  if (normalizedRight === '*' || normalizedRight === '**' || normalizedRight === '**/*') return true;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.includes('*') || normalizedRight.includes('*')) {
    const leftPrefix = normalizedLeft.split('*')[0].replace(/\/$/, '');
    const rightPrefix = normalizedRight.split('*')[0].replace(/\/$/, '');
    return Boolean(leftPrefix && rightPrefix && (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)));
  }
  return normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function normalizeScope(scope: string): string {
  return normalizePath(scope).replace(/\/+$/, '');
}

function counterexampleTouchesObservationScope(refs: EvidenceRef[], observation: RcclObservation): boolean {
  return refs.some((ref) => {
    if (ref.kind === 'rccl-evidence') return rcclEvidenceRefMatchesObservation(ref, observation);
    if (!ref.file) return false;
    const file = normalizePath(ref.file);
    return fileMatchesScope(file, observation.scope)
      || observation.evidence.some((evidence) => normalizePath(evidence.file) === file);
  });
}

function counterexampleAddsIndependentEvidence(refs: EvidenceRef[], observation: RcclObservation): boolean {
  return refs.some((ref) => {
    if (ref.kind === 'rccl-evidence') return false;
    if (!ref.file || !ref.line_range) return false;
    return !observation.evidence.some((evidence) =>
      normalizePath(evidence.file) === normalizePath(ref.file ?? '')
      && evidence.line_range[0] === ref.line_range?.[0]
      && evidence.line_range[1] === ref.line_range?.[1]);
  });
}

function fileMatchesScope(file: string, scope: string): boolean {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === '*' || normalizedScope === '**' || normalizedScope === '**/*') return true;
  if (normalizedScope.includes('*')) {
    const prefix = normalizedScope.split('*')[0].replace(/\/$/, '');
    return prefix ? file.startsWith(prefix) : true;
  }
  return file === normalizedScope || file.startsWith(`${normalizedScope}/`);
}

function verifyProposalEvidenceRefs(
  refs: EvidenceRef[],
  projectRoot: string,
  observations: RcclObservation[],
): EvidenceRefVerification {
  let verifiedCount = 0;
  let strongCount = 0;
  const verifiedRefs: EvidenceRef[] = [];
  const failures: string[] = [];

  for (const ref of refs) {
    const result = verifyProposalEvidenceRef(ref, projectRoot, observations);
    if (result.verified) {
      verifiedCount += 1;
      if (result.strong) strongCount += 1;
      verifiedRefs.push(ref);
    } else {
      failures.push(result.reason);
    }
  }

  return {
    verified: verifiedCount > 0,
    verifiedCount,
    strongCount,
    verifiedRefs,
    reason: verifiedCount > 0
      ? `${verifiedCount}/${refs.length} evidence ref(s) statically verified`
      : failures.slice(0, 3).join('; ') || 'no statically verifiable evidence refs',
  };
}

function verifyProposalEvidenceRef(
  ref: EvidenceRef,
  projectRoot: string,
  observations: RcclObservation[],
): { verified: boolean; strong: boolean; reason: string } {
  if (ref.kind === 'rccl-evidence') {
    return rcclEvidenceRefMatchesAnyObservation(ref, observations)
      ? { verified: true, strong: true, reason: 'rccl-evidence ref matches existing observation evidence' }
      : { verified: false, strong: false, reason: `rccl-evidence ref ${ref.ref} does not match observation evidence` };
  }
  if (ref.kind !== 'file' && ref.kind !== 'diff') {
    return { verified: false, strong: false, reason: `${ref.kind} evidence is not statically verifiable by RCCL commit` };
  }
  if (!ref.file || !ref.line_range) {
    return { verified: false, strong: false, reason: `${ref.ref} is missing file or line_range` };
  }

  const fullPath = join(projectRoot, ref.file);
  if (!existsSync(fullPath)) return { verified: false, strong: false, reason: `${ref.file} does not exist` };
  const lines = readFileSync(fullPath, 'utf-8').replace(/\r\n/g, '\n').split('\n');
  const [start, end] = ref.line_range;
  if (start < 1 || end < start || end > lines.length) {
    return { verified: false, strong: false, reason: `${ref.file}:${start}-${end} is outside file bounds` };
  }
  if (ref.snippet_hash) {
    const actual = lines.slice(start - 1, end).join('\n');
    if (!snippetHashMatches(actual, ref.snippet_hash)) {
      return { verified: false, strong: false, reason: `${ref.file}:${start}-${end} snippet_hash does not match current source` };
    }
    return { verified: true, strong: true, reason: `${ref.file}:${start}-${end} hash verified` };
  }
  return { verified: true, strong: false, reason: `${ref.file}:${start}-${end} range verified` };
}

function rcclEvidenceRefMatchesAnyObservation(ref: EvidenceRef, observations: RcclObservation[]): boolean {
  return observations.some((observation) => rcclEvidenceRefMatchesObservation(ref, observation));
}

function rcclEvidenceRefMatchesObservation(ref: EvidenceRef, observation: RcclObservation): boolean {
  return observation.evidence.some((evidence) => evidenceRefMatchesEvidence(ref, evidence.file, evidence.line_range));
}

function evidenceRefMatchesEvidence(ref: EvidenceRef, file: string, lineRange: [number, number]): boolean {
  const normalizedFile = normalizePath(file);
  const expected = `${normalizedFile}:${lineRange[0]}-${lineRange[1]}`;
  if (normalizePath(ref.ref) === expected) return true;
  if (!ref.file || !ref.line_range) return false;
  return normalizePath(ref.file) === normalizedFile
    && ref.line_range[0] === lineRange[0]
    && ref.line_range[1] === lineRange[1];
}

function snippetHashMatches(snippet: string, expectedHash: string): boolean {
  const expected = expectedHash.replace(/^sha(?:1|256):/i, '').toLowerCase();
  const normalized = snippet.replace(/\r\n/g, '\n');
  const sha1 = createHash('sha1').update(normalized).digest('hex');
  const sha256 = createHash('sha256').update(normalized).digest('hex');
  return expected === sha1 || expected === sha256;
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
