import { resolveCompileTask } from '../compile-input.ts';
import { activatedDirectiveIdsIR, resolveActivationDecisionsIR } from '../ir/activation/resolve-activation.ts';
import { buildGovernanceIR } from '../ir/build-ir.ts';
import { SEMANTIC_RELATION_POLICY } from '../ir/relations/policy.ts';
import { loadCompileSources } from '../load/compile-sources.ts';
import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import { verifyEvidenceRefs } from './evidence.ts';
import { contractVersionDiagnostic, isRecord, normalizeEvidenceRefs, validConfidence, validEvidenceRefs } from './shared.ts';
import type {
  ContractPayloadDiagnosticEntry,
  HostProposalSourceInput,
  SemanticContractContextInput,
  SemanticContractContextOutput,
  SemanticGovernanceGraphContractBundleInput,
  SemanticGovernanceGraphContractBundleOutput,
  SemanticGovernanceGraphContractInput,
  SemanticGovernanceGraphContractOutput,
  SemanticGovernanceGraphEdge,
  SemanticGovernanceGraphPayload,
  SemanticGovernanceGraphValidationInput,
  SemanticGovernanceGraphValidationResult,
  SemanticProposalDirectiveSummary,
  SemanticProposalObservationSummary,
} from './types.ts';
import type { DirectiveIR, HostProposalIR, ObservationIR } from '../ir/types.ts';

const SEMANTIC_GRAPH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodes: { type: 'array' },
    edges: { type: 'array' },
  },
  required: ['edges'],
};

export async function prepareSemanticContractContext(input: SemanticContractContextInput): Promise<SemanticContractContextOutput> {
  const resolvedTask = resolveCompileTask(input.compileInput);
  const compileInput = { ...input.compileInput, resolvedTask };
  const sources = compileInput.preloadedSources ?? await loadCompileSources(compileInput);
  const governanceIR = await buildGovernanceIR(compileInput, sources);
  const activationDecisions = resolveActivationDecisionsIR(governanceIR);
  const activatedDirectiveIds = activatedDirectiveIdsIR(activationDecisions);
  const activeDirectives = governanceIR.directives.filter((directive) => activatedDirectiveIds.has(directive.id));
  return {
    resolvedTask,
    directives: activeDirectives.map(summarizeDirectiveForProposal),
    observations: governanceIR.observations.map(summarizeObservationForProposal),
    loadedSources: sources,
  };
}

export async function prepareSemanticGovernanceGraphContractBundle(input: SemanticGovernanceGraphContractBundleInput): Promise<SemanticGovernanceGraphContractBundleOutput> {
  const context = await prepareSemanticContractContext(input);
  return {
    ...context,
    ...prepareSemanticGovernanceGraphContract({
      resolvedTask: context.resolvedTask,
      directives: context.directives,
      observations: context.observations,
      artifactPath: input.artifactPath,
    }),
  };
}

export function prepareSemanticGovernanceGraphContract(input: SemanticGovernanceGraphContractInput): SemanticGovernanceGraphContractOutput {
  const prompt = buildGraphPrompt(input);
  const artifact = {
    suggestedPath: input.artifactPath,
    format: 'json' as const,
    usage: `Write the semantic-governance-graph payload to ${input.artifactPath}, then re-run with --governance-graph-file ${input.artifactPath}.`,
  };
  return {
    graphPrompt: prompt,
    graphSchema: JSON.stringify(SEMANTIC_GRAPH_SCHEMA, null, 2),
    graphArtifact: artifact,
    contract: {
      contractVersion: 'ai-contract/v2',
      kind: 'semantic-governance-graph',
      schemaId: 'runtime.semantic-governance-graph',
      schemaVersion: '2.0',
      prompt,
      schema: SEMANTIC_GRAPH_SCHEMA,
      artifact,
      allowedIds: allowedIds(input),
      provenance: { owner: 'runtime', deterministic: true },
      context: {
        resolvedTask: {
          task_intent: input.resolvedTask.task_intent,
          context_profile: input.resolvedTask.context_profile,
        },
        directives: input.directives.map(compactDirectiveForContract),
        observations: input.observations.map(compactObservationForContract),
        edgeGuidance: {
          relations: ['reinforce', 'tension', 'suppress', 'ambient-only', 'unrelated'],
          impacts: ['execution-mode', 'review-focus', 'ambient-context', 'no-effect'],
          execution_intents: ['enforce', 'deviation-noted', 'ambient', 'suppress', 'no-change'],
          requirement: 'Create edges only when the directive and observation meaning materially affect execution, review focus, or ambient context for this task.',
        },
      },
      cacheKeyMaterial: {
        taskIntent: input.resolvedTask.task_intent,
        contextProfile: input.resolvedTask.context_profile,
        directiveIds: input.directives.map((directive) => directive.id),
        observationIds: input.observations.map((observation) => observation.id),
      },
    },
  };
}

export function validateSemanticGovernanceGraphPayload(input: SemanticGovernanceGraphValidationInput): SemanticGovernanceGraphValidationResult {
  const entries: ContractPayloadDiagnosticEntry[] = [];
  const versionDiagnostic = contractVersionDiagnostic(input.raw, 'semantic-governance-graph');
  if (versionDiagnostic) {
    return {
      proposal: buildHostProposal(input.source, { edges: [] }),
      diagnostics: buildContractPayloadDiagnostics('semantic-governance-graph', [versionDiagnostic], input.source),
    };
  }
  const allowedDirectiveIds = input.allowedDirectiveIds ? new Set(input.allowedDirectiveIds) : null;
  const allowedObservationIds = input.allowedObservationIds ? new Set(input.allowedObservationIds) : null;
  const edges = graphEdges(input.raw, entries);
  const accepted: SemanticGovernanceGraphEdge[] = [];
  const seen = new Set<string>();

  edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    if (!isGraphEdge(edge)) {
      entries.push(rejected(path, 'malformed-payload', 'Graph edge is missing required fields or has unsupported values.'));
      return;
    }
    if (allowedDirectiveIds && !allowedDirectiveIds.has(edge.directive_id)) {
      entries.push(rejected(path, 'invalid-id', 'Graph edge references a directive id outside allowedIds.', edge));
      return;
    }
    if (allowedObservationIds && !allowedObservationIds.has(edge.observation_id)) {
      entries.push(rejected(path, 'invalid-id', 'Graph edge references an observation id outside allowedIds.', edge));
      return;
    }
    const duplicateKey = `${edge.directive_id}::${edge.observation_id}::${edge.relation}`;
    if (seen.has(duplicateKey)) {
      entries.push(rejected(path, 'duplicate-id', 'Duplicate graph edge for directive, observation, and relation.', edge));
      return;
    }
    seen.add(duplicateKey);
    if (edge.confidence < SEMANTIC_RELATION_POLICY.hostSemantic.minConfidence) {
      entries.push(rejected(path, 'low-confidence', 'Graph edge confidence is below Runtime host semantic threshold.', edge));
      return;
    }
    if (!validEvidenceRefs(edge.evidence_refs)) {
      entries.push(rejected(path, 'missing-evidence', 'Graph edge must include evidence_refs.', edge));
      return;
    }
    const evidenceRefs = normalizeEvidenceRefs(edge.evidence_refs);
    const evidence = verifyEvidenceRefs(evidenceRefs, input.evidenceContext);
    if (isExecutionImpactingEdge(edge) && evidence.conversationOnly) {
      entries.push(rejected(path, 'conversation-only-evidence', 'Execution-impacting graph edges cannot be supported only by conversation evidence.', edge));
      return;
    }
    if (isExecutionImpactingEdge(edge) && !evidence.hasStaticEvidence) {
      entries.push(rejected(path, 'insufficient-static-evidence', 'Execution-impacting graph edges require at least one statically verified evidence ref.', edge));
      return;
    }
    accepted.push({ ...edge, evidence_refs: evidenceRefs });
    entries.push({
      status: 'accepted',
      reason: 'accepted',
      path,
      message: 'Semantic governance graph edge accepted for Runtime adjudication.',
      directiveId: edge.directive_id,
      observationId: edge.observation_id,
      confidence: edge.confidence,
    });
  });

  if (!edges.length && !entries.length) {
    entries.push({ status: 'unused', reason: 'empty-payload', path: 'edges', message: 'No semantic governance graph edges were provided.' });
  }

  return {
    proposal: buildHostProposal(input.source, { edges: accepted }),
    diagnostics: buildContractPayloadDiagnostics('semantic-governance-graph', entries, input.source),
  };
}

function isExecutionImpactingEdge(edge: SemanticGovernanceGraphEdge): boolean {
  return edge.impact === 'execution-mode'
    || (edge.execution_intent !== undefined && edge.execution_intent !== 'no-change');
}

export function loadSemanticGovernanceGraphPayload(raw: unknown, source: HostProposalSourceInput): HostProposalIR {
  return validateSemanticGovernanceGraphPayload({ raw, source }).proposal;
}

function graphEdges(raw: unknown, entries: ContractPayloadDiagnosticEntry[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (!isRecord(raw)) {
    entries.push(rejected('payload', 'malformed-payload', 'Semantic governance graph payload must be an object with an edges array.'));
    return [];
  }
  if (!Array.isArray(raw.edges)) {
    entries.push(rejected('edges', 'malformed-payload', 'Semantic governance graph edges field must be an array.'));
    return [];
  }
  return raw.edges;
}

function isGraphEdge(value: unknown): value is SemanticGovernanceGraphEdge {
  if (!isRecord(value)) return false;
  return typeof value.directive_id === 'string'
    && typeof value.observation_id === 'string'
    && isRelation(value.relation)
    && validConfidence(value.confidence)
    && typeof value.reason === 'string'
    && validEvidenceRefs(value.evidence_refs)
    && (value.impact === undefined || isImpact(value.impact))
    && (value.review_priority === undefined || isReviewPriority(value.review_priority))
    && (value.execution_intent === undefined || isExecutionIntent(value.execution_intent));
}

function isRelation(value: unknown): boolean {
  return value === 'reinforce' || value === 'tension' || value === 'suppress' || value === 'ambient-only' || value === 'unrelated';
}

function isImpact(value: unknown): boolean {
  return value === 'execution-mode' || value === 'review-focus' || value === 'ambient-context' || value === 'no-effect';
}

function isReviewPriority(value: unknown): boolean {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'critical';
}

function isExecutionIntent(value: unknown): boolean {
  return value === 'enforce' || value === 'deviation-noted' || value === 'ambient' || value === 'suppress' || value === 'no-change';
}

function buildHostProposal(source: HostProposalSourceInput, payload: SemanticGovernanceGraphPayload): HostProposalIR {
  return {
    irVersion: 'governance-ir/v1',
    source: {
      kind: 'host-proposal',
      id: source.id,
      ...(source.path ? { path: source.path } : {}),
    },
    kind: 'semantic-governance-graph',
    payload,
  };
}

function rejected(
  path: string,
  reason: ContractPayloadDiagnosticEntry['reason'],
  message: string,
  edge?: Partial<SemanticGovernanceGraphEdge>,
): ContractPayloadDiagnosticEntry {
  return {
    status: 'rejected',
    reason,
    path,
    message,
    directiveId: edge?.directive_id,
    observationId: edge?.observation_id,
    confidence: edge?.confidence,
  };
}

function summarizeDirectiveForProposal(directive: DirectiveIR): SemanticProposalDirectiveSummary {
  return {
    id: directive.id,
    semanticKey: directive.semanticKey,
    kind: directive.kind,
    prescription: directive.prescription,
    weight: directive.weight,
    layer: directive.layer.id,
    scope: directive.scope.path,
    description: directive.body.description,
    rationale: directive.body.rationale,
    traits: directive.traits,
  };
}

function summarizeObservationForProposal(observation: ObservationIR): SemanticProposalObservationSummary {
  return {
    id: observation.id,
    semanticKey: observation.semanticKey,
    category: observation.category,
    scope: observation.scope.path,
    pattern: observation.pattern,
    adherence: observation.adherence,
    verification: observation.verification,
    lifecycle: observation.lifecycle,
    traits: observation.traits,
    evidenceRefs: observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`),
    evidence: observation.evidence.map((evidence) => ({
      file: evidence.file,
      line_range: evidence.line_range,
      snippet: evidence.snippet,
    })),
  };
}

function buildGraphPrompt(input: SemanticGovernanceGraphContractInput): string {
  const directives = input.directives.map(compactDirectiveForContract);
  const observations = input.observations.map(compactObservationForContract);
  return [
    'Produce a semantic-governance-graph payload for Runtime.',
    'Edges connect active directives to RCCL observations when repository reality changes how guidance should execute for this task.',
    'Every edge must include evidence_refs from task context, RCCL evidence, files, diff, commands, or runtime trace.',
    'Runtime will validate IDs, confidence, scope, verification, lifecycle, and final execution mode deterministically.',
    'Use the directive and observation summaries below; do not infer relations from IDs alone.',
    'Return JSON only.',
    '',
    `Resolved task intent: ${JSON.stringify(input.resolvedTask.task_intent)}`,
    `Resolved context profile: ${JSON.stringify(input.resolvedTask.context_profile)}`,
    `Allowed directive ids: ${input.directives.map((item) => item.id).join(', ') || '(none)'}`,
    `Allowed observation ids: ${input.observations.map((item) => item.id).join(', ') || '(none)'}`,
    '',
    'Directive summaries:',
    JSON.stringify(directives, null, 2),
    '',
    'Observation summaries:',
    JSON.stringify(observations, null, 2),
  ].join('\n');
}

function allowedIds(input: SemanticGovernanceGraphContractInput) {
  return {
    directiveIds: input.directives.map((directive) => directive.id),
    observationIds: input.observations.map((observation) => observation.id),
  };
}

function compactDirectiveForContract(directive: SemanticProposalDirectiveSummary) {
  return {
    id: directive.id,
    semanticKey: directive.semanticKey,
    kind: directive.kind,
    prescription: directive.prescription,
    weight: directive.weight,
    layer: directive.layer,
    scope: directive.scope,
    description: truncate(directive.description, 360),
    rationale: truncate(directive.rationale, 360),
    traits: directive.traits,
  };
}

function compactObservationForContract(observation: SemanticProposalObservationSummary) {
  return {
    id: observation.id,
    semanticKey: observation.semanticKey,
    category: observation.category,
    scope: observation.scope,
    pattern: truncate(observation.pattern, 420),
    adherence: observation.adherence,
    verification: observation.verification,
    lifecycle: observation.lifecycle,
    traits: observation.traits,
    evidenceRefs: observation.evidenceRefs,
    evidence: observation.evidence.slice(0, 4).map((evidence) => ({
      file: evidence.file,
      line_range: evidence.line_range,
      snippet: truncate(evidence.snippet, 260),
    })),
  };
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
