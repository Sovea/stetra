import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildSemanticRelationsIR } from '../src/ir/relations/build-relations.ts';
import { prepareSemanticGovernanceGraphContract, validateSemanticGovernanceGraphPayload } from '../src/ai-contracts/semantic-governance-graph.ts';
import { resolveContractPolicy } from '../src/contract-policy.ts';
import { resolveTask } from '../src/interpret/normalize-candidate.ts';
import { resolveExecutionDecisionsIR } from '../src/ir/execution/resolve-execution.ts';
import { validateAdherenceEvidencePayload } from '../src/ai-contracts/adherence-evidence.ts';
import { validateContextAcquisitionPayload } from '../src/ai-contracts/context-acquisition.ts';
import { validateTaskModelPayload } from '../src/ai-contracts/task-model.ts';
import { discoverBuiltinLayers, loadDirectiveFile } from '../src/load/load-playbook.ts';
import { directivesToIR } from '../src/ir/adapters/playbook.ts';
import { observationsToIR } from '../src/ir/adapters/rccl.ts';

const playbookRoot = fileURLToPath(new URL('../../playbook', import.meta.url));
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const evidenceRef = {
  kind: 'conversation',
  ref: 'user-request',
};
const staticEvidenceRef = {
  kind: 'file',
  ref: 'runtime/src/types.ts:1-1',
  file: 'runtime/src/types.ts',
  line_range: [1, 1],
};

{
  const layers = discoverBuiltinLayers(playbookRoot);
  const directives = [...layers.entries()].flatMap(([layerId, filePath]) => loadDirectiveFile(filePath, layerId));
  const byId = new Map(directives.map((directive) => [directive.id, directive]));
  const tagged = directives.filter((directive) => directive.traits && Object.values(directive.traits).some((value) => value === true));

  assert.ok(tagged.length > 0);
  assert.equal(byId.get('core-clear-boundaries-and-responsibilities-01')?.traits?.broad_scope, true);
  assert.equal(byId.get('ts-explicit-public-interfaces-01')?.traits?.compatibility_sensitive, true);
  assert.equal(byId.get('migration-control-compatibility-01')?.traits?.migration_sensitive, true);
  assert.equal(byId.get('migration-control-compatibility-01')?.traits?.compatibility_sensitive, true);
  assert.equal(byId.get('feature-careful-at-boundaries-01')?.traits?.safety_critical, true);
}

{
  const result = validateTaskModelPayload({
    contractVersion: 'ai-contract/v3',
    kind: 'task-interpretation',
  });
  assert.equal(result.models.length, 0);
  assert.equal(result.diagnostics.summary.rejected, 1);
  assert.equal(result.diagnostics.entries[0].reason, 'unsupported-value');
  assert.equal(result.diagnostics.entries[0].path, 'contractVersion');
}

{
  const result = validateContextAcquisitionPayload({
    requests: [{
      kind: 'rccl-incremental',
      mode: 'changed-files',
      target_files: ['a.ts', 'b.ts', 'c.ts'],
      changed_files: ['d.ts', 'e.ts'],
      reason: 'changed files exceed the bounded context window',
      confidence: 0.9,
      evidence_refs: [evidenceRef],
    }],
  });
  assert.equal(result.requests.length, 0);
  assert.equal(result.diagnostics.summary.rejected, 1);
  assert.equal(result.diagnostics.entries[0].reason, 'capped-by-policy');
}

{
  const result = validateContextAcquisitionPayload({
    requests: [{
      kind: 'rccl-incremental',
      mode: 'task-scoped',
      target_files: ['runtime/src/types.ts'],
      changed_files: [],
      reason: 'target file needs task-scoped RCCL context',
      confidence: 0.9,
      evidence_refs: [evidenceRef],
    }],
  });
  assert.equal(result.requests.length, 1);
  assert.equal(result.diagnostics.summary.accepted, 1);
}

{
  const result = validateTaskModelPayload({
    intent: {
      operation: {
        value: 'modify',
        confidence: 0.9,
        evidence_refs: [evidenceRef],
      },
    },
    context: {
      risk_level: {
        value: 'high',
        confidence: 0.8,
        evidence_refs: [evidenceRef],
      },
    },
    uncertainties: [],
  });
  assert.equal(result.models.length, 1);
  assert.equal(result.diagnostics.summary.accepted, 1);
}

{
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'present',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    taskRisk: 'medium',
    task: {
      description: 'Update one implementation detail',
      operation: 'modify',
      targetFile: 'sample.ts',
      changedFiles: [],
      techStack: ['typescript'],
    },
    mode: 'standard',
    rcclRelevant: false,
  });
  assert.equal(policy.required.includes('task-model'), false);
  assert.ok(policy.optional.includes('task-model'));
  assert.equal(policy.required.includes('semantic-governance-graph'), false);
  assert.equal(policy.skipped.find((item) => item.kind === 'semantic-governance-graph')?.reason_id, 'rccl-not-relevant');
  assert.equal(policy.escalation, 'none');
}

{
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'present',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    taskRisk: 'high',
    task: {
      description: 'Modify public API behavior',
      operation: 'modify',
      targetFile: 'sample.ts',
      changedFiles: [],
      techStack: ['typescript'],
      riskLevel: 'high',
      interfaceSensitivity: 'public-api',
    },
    mode: 'standard',
    rcclRelevant: true,
  });
  assert.ok(policy.required.includes('task-model'));
  assert.equal(policy.required.includes('semantic-governance-graph'), false);
  assert.equal(policy.skipped.find((item) => item.kind === 'semantic-governance-graph')?.reason_id, 'waiting-for-task-model');
  assert.equal(policy.escalation, 'task-model');
}

{
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'present',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: true,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    taskRisk: 'medium',
    task: {
      description: 'Strictly governed change',
      operation: 'modify',
      targetFile: 'sample.ts',
      changedFiles: [],
      techStack: ['typescript'],
    },
    mode: 'strict',
    rcclRelevant: false,
  });
  assert.ok(policy.required.includes('semantic-governance-graph'));
}

{
  const task = {
    description: 'Preserve public API compatibility while updating behavior',
    targetFile: 'api/handler.ts',
    changedFiles: [],
    techStack: ['typescript'],
  };
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'absent',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task,
    mode: 'standard',
  });
  assert.equal(policy.required.includes('task-model'), false);
  assert.equal(policy.escalation, 'none');
  assert.equal(policy.diagnostics.deterministic_fallbacks.length, 0);
}

{
  const task = {
    description: 'Preserve public API compatibility while updating behavior',
    targetFile: 'api/handler.ts',
    changedFiles: [],
    techStack: ['typescript'],
    compatibilityRequirement: 'preserve-api',
  };
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'absent',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task,
    mode: 'standard',
  });
  assert.ok(policy.required.includes('task-model'));
  assert.equal(policy.diagnostics.task_model_required, true);
}

{
  const task = {
    description: 'Update handler formatting',
    targetFile: 'api/handler.ts',
    changedFiles: [],
    techStack: ['typescript'],
  };
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'absent',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task,
    mode: 'standard',
  });
  assert.equal(policy.required.includes('task-model'), false);
  assert.equal(policy.escalation, 'none');
  assert.equal(policy.diagnostics.deterministic_fallbacks.length, 0);
}

{
  const resolved = resolveTask({
    task: {
      description: 'Update component internals',
      targetFile: 'ui/component.tsx',
      changedFiles: [],
    },
    taskModels: [],
    interpretationMode: 'deterministic-only',
  });
  assert.deepEqual(resolved.task_intent.tech_stack, ['typescript']);
  const scopeResolution = resolved.input_provenance.context_resolution.find((item) => item.field === 'context.scope_size');
  assert.deepEqual(scopeResolution?.influence, []);
}

{
  const task = {
    description: 'Update helper formatting',
    targetFile: 'auth/token.ts',
    changedFiles: [],
    techStack: ['typescript'],
  };
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'absent',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task,
    mode: 'standard',
  });
  assert.equal(policy.required.includes('task-model'), false);
  assert.equal(policy.diagnostics.deterministic_fallbacks.length, 0);
}

{
  const baseDirective = {
    id: 'd-public-api-compatibility',
    type: 'architecture',
    layer: 'core',
    scope: { path: '**/*' },
    prescription: 'should',
    weight: 'normal',
    description: 'Preserve public API compatibility during migration.',
    rationale: 'This prose should not create Runtime traits by keyword matching.',
    examples: [],
    source: { kind: 'builtin', layerId: 'builtin/core', filePath: 'playbook/core.yaml' },
  };
  const [inferredDirective] = directivesToIR([baseDirective], null);
  assert.equal(inferredDirective.traits.compatibilitySensitive, false);
  assert.equal(inferredDirective.traits.migrationSensitive, false);

  const [explicitDirective] = directivesToIR([{
    ...baseDirective,
    traits: {
      compatibility_sensitive: true,
      migration_sensitive: true,
    },
  }], null);
  assert.equal(explicitDirective.traits.compatibilitySensitive, true);
  assert.equal(explicitDirective.traits.migrationSensitive, true);

  const baseObservation = {
    id: 'obs-public-api-compatibility',
    semantic_key: 'public-api-compatibility',
    category: 'architecture',
    scope: '**/*',
    pattern: 'Legacy public API compatibility boundary exists during migration.',
    confidence: 0.9,
    adherence_quality: 'inconsistent',
    evidence: [{
      file: 'api/handler.ts',
      line_range: [1, 2],
      snippet: 'export function handler() {\n  return legacyShape();\n}',
    }],
    support: {
      source_slices: ['slice-1'],
      file_count: 1,
      cluster_count: 1,
      scope_basis: 'single-file',
    },
    verification: {
      evidence_status: 'verified',
      evidence_verified_count: 1,
      evidence_confidence: 0.9,
      induction_status: 'narrowly-supported',
      induction_confidence: 0.7,
      checked_at: '2026-01-01T00:00:00.000Z',
      disposition: 'keep',
    },
  };
  const [inferredObservation] = observationsToIR([baseObservation]);
  assert.equal(inferredObservation.traits.compatibilityBoundary, false);
  assert.equal(inferredObservation.traits.legacy, false);

  const [explicitObservation] = observationsToIR([{
    ...baseObservation,
    traits: {
      compatibility_boundary: true,
      legacy: true,
    },
  }]);
  assert.equal(explicitObservation.traits.compatibilityBoundary, true);
  assert.equal(explicitObservation.traits.legacy, true);
}

{
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'absent',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: false,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task: {
      description: 'Update one implementation detail',
      operation: 'modify',
      targetFile: 'sample.ts',
      changedFiles: [],
      riskLevel: 'low',
      scopeSize: 'single-file',
    },
    mode: 'standard',
  });
  assert.equal(policy.required.length, 0);
  assert.ok(policy.optional.includes('context-acquisition'));
  assert.equal(policy.escalation, 'none');
}

{
  const task = {
    description: 'Adjust implementation details after repository feedback',
    operation: 'modify',
    targetFile: 'sample.ts',
    changedFiles: [],
    techStack: ['typescript'],
    riskLevel: 'high',
  };
  const resolvedTask = resolveTask({
    task,
    taskModels: [],
    interpretationMode: 'deterministic-only',
  });
  const policy = resolveContractPolicy({
    sourceStatus: {
      localAugment: 'present',
      rccl: 'present',
      lockfile: 'absent',
      cache: 'miss',
    },
    providedContracts: {
      agentCapability: true,
      taskModel: true,
      semanticGovernanceGraph: false,
    },
    agentCapabilityProfile: {
      can_read_files: true,
      can_search_files: true,
      can_run_commands: true,
      can_inspect_diff: true,
      can_request_context: true,
    },
    task,
    resolvedTask,
    mode: 'standard',
    rcclRelevant: undefined,
  });
  assert.equal(policy.required.includes('semantic-governance-graph'), false);
  assert.equal(policy.skipped.find((item) => item.kind === 'semantic-governance-graph')?.reason_id, 'not-required-for-current-policy');
}

{
  const result = prepareSemanticGovernanceGraphContract({
    resolvedTask: {
      task_intent: {
        operation: 'modify',
        target_layer: 'runtime',
        tech_stack: ['typescript'],
        target_file: 'runtime/src/example.ts',
        tags: ['governance'],
      },
      context_profile: {
        risk_level: 'high',
      },
    },
    directives: [{
      id: 'd1',
      semanticKey: 'runtime-contract-boundary',
      kind: 'architecture',
      prescription: 'must',
      weight: 'critical',
      layer: 'core',
      scope: 'runtime/src',
      description: 'Runtime owns validation and execution decisions.',
      rationale: 'Host agents may propose but Runtime must adjudicate.',
      traits: { safetyCritical: true },
    }],
    observations: [{
      id: 'o1',
      semanticKey: 'host-proposal-validation',
      category: 'architecture',
      scope: 'runtime/src',
      pattern: 'Host proposals are accepted through Runtime-owned validators.',
      adherence: { quality: 'good' },
      verification: { disposition: 'keep' },
      lifecycle: { status: 'active' },
      traits: { safetyCritical: true },
      evidenceRefs: ['runtime/src/example.ts:1-3'],
      evidence: [{
        file: 'runtime/src/example.ts',
        line_range: [1, 3],
        snippet: 'validate before adjudicating host proposals',
      }],
    }],
    artifactPath: '.resonant-code/context/semantic-governance-graphs/test.json',
  });
  assert.match(result.graphPrompt, /Runtime owns validation/);
  assert.match(result.graphPrompt, /Host proposals are accepted/);
  assert.equal(result.contract.context.directives[0].description, 'Runtime owns validation and execution decisions.');
  assert.equal(result.contract.context.observations[0].evidenceRefs[0], 'runtime/src/example.ts:1-3');
}

{
  const result = validateSemanticGovernanceGraphPayload({
    raw: {
      edges: [
        {
          directive_id: 'd1',
          observation_id: 'o1',
          relation: 'tension',
          confidence: 0.9,
          reason: 'repo observation changes execution mode',
          evidence_refs: [staticEvidenceRef],
          execution_intent: 'deviation-noted',
          impact: 'execution-mode',
        },
        {
          directive_id: 'd1',
          observation_id: 'o1',
          relation: 'tension',
          confidence: 0.9,
          reason: 'duplicate',
          evidence_refs: [staticEvidenceRef],
        },
      ],
    },
    source: { id: 'test' },
    allowedDirectiveIds: ['d1'],
    allowedObservationIds: ['o1'],
    evidenceContext: { projectRoot },
  });
  assert.equal(result.diagnostics.summary.accepted, 1);
  assert.equal(result.diagnostics.summary.rejected, 1);
  assert.ok(result.diagnostics.entries.some((entry) => entry.reason === 'duplicate-id'));
}

{
  const result = validateSemanticGovernanceGraphPayload({
    raw: {
      edges: [{
        directive_id: 'd1',
        observation_id: 'o1',
        relation: 'tension',
        confidence: 0.9,
        reason: 'conversation alone cannot alter execution mode',
        evidence_refs: [evidenceRef],
        execution_intent: 'deviation-noted',
        impact: 'execution-mode',
      }],
    },
    source: { id: 'test' },
    allowedDirectiveIds: ['d1'],
    allowedObservationIds: ['o1'],
  });
  assert.equal(result.diagnostics.summary.accepted, 0);
  assert.equal(result.diagnostics.summary.rejected, 1);
  assert.equal(result.diagnostics.entries[0].reason, 'conversation-only-evidence');
}

{
  const directive = {
    id: 'd1',
    semanticKey: 'shared-export-constant',
    kind: 'architecture',
    prescription: 'must',
    weight: 'critical',
    layer: { id: 'core' },
    scope: { path: 'sample.ts' },
    body: {
      description: 'Use exported constants consistently.',
      rationale: 'Shared values should be visible at module boundaries.',
    },
    traits: {
      rcclImmune: false,
      compatibilitySensitive: false,
      migrationSensitive: false,
      safetyCritical: false,
      broadScope: false,
    },
  };
  const observation = {
    id: 'o1',
    semanticKey: 'shared-export-constant',
    category: 'architecture',
    scope: { path: 'sample.ts' },
    pattern: 'Repository currently uses inconsistent exported constants.',
    adherence: {
      quality: 'poor',
      confidence: 0.9,
    },
    verification: {
      evidenceStatus: 'verified',
      evidenceVerifiedCount: 1,
      evidenceConfidence: 0.9,
      inductionConfidence: 0.9,
      disposition: 'keep',
    },
    lifecycle: {
      status: 'active',
      contentFingerprint: 'obs-fingerprint',
    },
    traits: {
      antiPattern: false,
      compatibilityBoundary: false,
      legacy: false,
      migrationBoundary: false,
    },
    evidence: [{
      file: 'sample.ts',
      line_range: [1, 1],
      snippet: 'export const alpha = 1;',
    }],
  };
  const bundle = {
    directives: [directive],
    observations: [observation],
    task: {
      operation: 'modify',
      targets: [{ path: 'sample.ts' }],
      context: {},
    },
    feedback: {
      directiveSignals: [],
      observationSignals: [],
      tensionSignals: [],
    },
    hostProposals: [{
      source: { id: 'host-graph' },
      kind: 'semantic-governance-graph',
      payload: {
        edges: [{
          directive_id: 'd1',
          observation_id: 'o1',
          relation: 'reinforce',
          confidence: 0.92,
          reason: 'Host reviewed the observation and found it reinforces this directive for the task.',
          evidence_refs: [{ kind: 'file', ref: 'sample.ts:1-1' }],
          impact: 'review-focus',
        }],
      },
    }],
  };

  const hostFirstRelations = buildSemanticRelationsIR(bundle);
  assert.equal(hostFirstRelations.length, 1);
  assert.equal(hostFirstRelations[0].proposedBy, 'host-agent');
  assert.equal(hostFirstRelations[0].adjudication.finalRelation, 'reinforce');

  const fallbackRelations = buildSemanticRelationsIR({ ...bundle, hostProposals: [] });
  assert.equal(fallbackRelations.length, 1);
  assert.equal(fallbackRelations[0].proposedBy, 'runtime-structural');
  assert.equal(fallbackRelations[0].adjudication.finalRelation, 'ambient-only');
  assert.equal(fallbackRelations[0].impact, 'ambient-context');

  const categoryOnlyRelations = buildSemanticRelationsIR({
    ...bundle,
    observations: [{
      ...observation,
      id: 'o2',
      semanticKey: 'module-layout-pattern',
    }],
    hostProposals: [],
  });
  assert.equal(categoryOnlyRelations.length, 0);
}

{
  const directive = {
    id: 'd-feedback-must',
    semanticKey: 'repository-feedback-boundary',
    kind: 'architecture',
    prescription: 'must',
    weight: 'critical',
    layer: { id: 'core' },
    scope: { path: 'sample.ts' },
    traits: { rcclImmune: false },
  };
  const observation = {
    id: 'o-feedback',
    semanticKey: 'repository-feedback-boundary',
    category: 'architecture',
    scope: { path: 'sample.ts' },
    pattern: 'Previous tasks found this repository boundary hard to apply.',
    adherence: {
      quality: 'inconsistent',
      confidence: 0.8,
    },
    verification: {
      evidenceStatus: 'verified',
      evidenceVerifiedCount: 1,
      evidenceConfidence: 0.9,
      inductionConfidence: 0.8,
      disposition: 'keep',
    },
    lifecycle: {
      status: 'active',
      contentFingerprint: 'feedback-fingerprint',
    },
    traits: {
      antiPattern: false,
      compatibilityBoundary: false,
      legacy: false,
      migrationBoundary: false,
    },
    evidence: [{
      file: 'sample.ts',
      line_range: [1, 1],
      snippet: 'export const alpha = 1;',
    }],
  };
  const bundle = {
    directives: [directive],
    observations: [observation],
    task: {
      operation: 'modify',
      targets: [{ path: 'sample.ts' }],
      context: {
        optimization_target: 'maintainability',
        hard_constraints: [],
        allowed_tradeoffs: [],
        avoid: [],
        risk_level: 'medium',
        scope_size: 'single-file',
        compatibility_requirement: 'none',
        interface_sensitivity: 'internal',
        refactor_tolerance: 'local-only',
        migration_phase: 'none',
      },
    },
    feedback: {
      directiveSignals: [],
      observationSignals: [{
        observationId: 'o-feedback',
        seenCount: 2,
        relationCount: 2,
        activeSeenCount: 2,
        staleSeenCount: 0,
        supersededSeenCount: 0,
        lastDisposition: 'keep',
        lastLifecycleStatus: 'active',
        lastContentFingerprint: 'feedback-fingerprint',
        lastSeen: '2026-01-01T00:00:00.000Z',
      }],
      tensionSignals: [{
        tensionKey: 'd-feedback-must::o-feedback',
        seenCount: 2,
        directiveId: 'd-feedback-must',
        observationId: 'o-feedback',
        lastExecutionMode: 'deviation-noted',
        lastSeen: '2026-01-01T00:00:00.000Z',
      }],
    },
    hostProposals: [],
  };

  const relations = buildSemanticRelationsIR(bundle);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].proposedBy, 'feedback');
  assert.equal(relations[0].adjudication.finalRelation, 'tension');
  assert.equal(relations[0].impact, 'review-focus');

  const decisions = resolveExecutionDecisionsIR(bundle, relations);
  assert.equal(decisions[0].mode, 'enforce');
  assert.ok(decisions[0].feedbackApplied.includes('feedback:recurring-tension'));
}

{
  const decisions = resolveExecutionDecisionsIR({
    directives: [{
      id: 'd1',
      kind: 'architecture',
      prescription: 'must',
      weight: 'critical',
      traits: { rcclImmune: false },
    }],
    task: {
      context: {
        optimization_target: 'maintainability',
        hard_constraints: [],
        allowed_tradeoffs: [],
        avoid: [],
        risk_level: 'medium',
        scope_size: 'single-file',
        compatibility_requirement: 'none',
        interface_sensitivity: 'internal',
        refactor_tolerance: 'local-only',
        migration_phase: 'none',
      },
    },
    feedback: { directiveSignals: [], observationSignals: [] },
  }, [{
    id: 'rel1',
    directiveId: 'd1',
    observationId: 'o1',
    proposedBy: 'host-agent',
    relation: 'tension',
    confidence: 0.9,
    basis: {
      scope: true,
      semanticKey: false,
      category: false,
      evidence: true,
      hostReasoning: true,
      feedback: false,
    },
    signals: [],
    evidenceRefs: ['runtime/src/example.ts:1-3'],
    reasoningSummary: 'repo reality requires compatibility boundary handling',
    impact: 'execution-mode',
    executionIntent: 'ambient',
    adjudication: {
      status: 'accepted',
      finalRelation: 'tension',
      reason: 'accepted',
    },
  }]);
  assert.equal(decisions[0].mode, 'deviation-noted');
  assert.equal(decisions[0].basis, 'governance-graph');
  assert.ok(decisions[0].contextApplied.includes('execution_intent_floor:must-deviation-noted'));
}

{
  const directive = {
    id: 'd1',
    kind: 'architecture',
    prescription: 'should',
    weight: 'normal',
    traits: {
      rcclImmune: false,
      compatibilitySensitive: true,
      migrationSensitive: false,
      safetyCritical: false,
      broadScope: false,
    },
  };
  const relation = {
    id: 'rel1',
    directiveId: 'd1',
    observationId: 'o1',
    proposedBy: 'host-agent',
    relation: 'tension',
    confidence: 0.9,
    basis: {
      scope: true,
      semanticKey: false,
      category: false,
      evidence: true,
      hostReasoning: true,
      feedback: false,
    },
    signals: [],
    evidenceRefs: ['api/handler.ts:1-3'],
    reasoningSummary: 'verified repository reality creates a compatibility boundary',
    impact: 'execution-mode',
    adjudication: {
      status: 'accepted',
      finalRelation: 'tension',
      reason: 'accepted',
    },
  };
  const deterministicTask = resolveTask({
    task: {
      description: 'Preserve public API compatibility while updating behavior',
      targetFile: 'api/handler.ts',
      changedFiles: [],
      techStack: ['typescript'],
    },
    taskModels: [],
    interpretationMode: 'deterministic-only',
  });
  const deterministicDecision = resolveExecutionDecisionsIR({
    directives: [directive],
    task: {
      context: deterministicTask.context_profile,
      provenance: deterministicTask.input_provenance.resolved_fields,
    },
    feedback: { directiveSignals: [], observationSignals: [] },
  }, [relation]);
  assert.equal(deterministicDecision[0].mode, 'ambient');
  assert.equal(deterministicDecision[0].contextRulesApplied.includes('context.compatibility.promote-compatible-should'), false);

  const explicitTask = resolveTask({
    task: {
      description: 'Preserve public API compatibility while updating behavior',
      targetFile: 'api/handler.ts',
      changedFiles: [],
      techStack: ['typescript'],
      compatibilityRequirement: 'preserve-api',
    },
    taskModels: [],
    interpretationMode: 'deterministic-only',
  });
  const explicitDecision = resolveExecutionDecisionsIR({
    directives: [directive],
    task: {
      context: explicitTask.context_profile,
      provenance: explicitTask.input_provenance.resolved_fields,
    },
    feedback: { directiveSignals: [], observationSignals: [] },
  }, [relation]);
  assert.equal(explicitDecision[0].mode, 'deviation-noted');
  assert.ok(explicitDecision[0].contextRulesApplied.includes('context.compatibility.promote-compatible-should'));
}

{
  const bundle = {
    directives: [{
      id: 'd1',
      kind: 'architecture',
      prescription: 'must',
      weight: 'critical',
      traits: { rcclImmune: false },
    }],
    task: {
      context: {
        optimization_target: 'maintainability',
        hard_constraints: [],
        allowed_tradeoffs: [],
        avoid: [],
        risk_level: 'medium',
        scope_size: 'single-file',
        compatibility_requirement: 'none',
        interface_sensitivity: 'internal',
        refactor_tolerance: 'local-only',
        migration_phase: 'none',
      },
    },
    feedback: { directiveSignals: [], observationSignals: [] },
  };
  const baseRelation = {
    id: 'rel1',
    directiveId: 'd1',
    observationId: 'o1',
    proposedBy: 'host-agent',
    relation: 'ambient-only',
    confidence: 0.9,
    basis: {
      scope: true,
      semanticKey: false,
      category: false,
      evidence: true,
      hostReasoning: true,
      feedback: false,
    },
    signals: [],
    evidenceRefs: ['runtime/src/example.ts:1-3'],
    reasoningSummary: 'ambient context only',
    impact: 'execution-mode',
    executionIntent: 'deviation-noted',
    adjudication: {
      status: 'accepted',
      finalRelation: 'ambient-only',
      reason: 'accepted',
    },
  };
  const ambientOnlyDecision = resolveExecutionDecisionsIR(bundle, [baseRelation]);
  assert.equal(ambientOnlyDecision[0].mode, 'enforce');
  assert.equal(ambientOnlyDecision[0].basis, 'prescription');

  const tensionEnforceDecision = resolveExecutionDecisionsIR(bundle, [{
    ...baseRelation,
    id: 'rel2',
    relation: 'tension',
    reasoningSummary: 'tension cannot be overridden to enforce',
    executionIntent: 'enforce',
    adjudication: {
      status: 'accepted',
      finalRelation: 'tension',
      reason: 'accepted',
    },
  }]);
  assert.equal(tensionEnforceDecision[0].mode, 'deviation-noted');
  assert.equal(tensionEnforceDecision[0].basis, 'governance-graph');
}

{
  const result = validateAdherenceEvidencePayload({
    verdicts: [
      {
        directive_id: 'd1',
        verdict: 'unverified',
        confidence: 0.7,
        evidence_refs: [],
        reason: 'not inspected',
      },
      {
        directive_id: 'd2',
        verdict: 'followed',
        confidence: 0.9,
        evidence_refs: [evidenceRef],
        reason: 'implementation evidence inspected',
      },
    ],
  }, ['d1', 'd2']);
  assert.equal(result.verdicts.length, 2);
  assert.equal(result.verdicts[1].verdict, 'unverified');
  assert.equal(result.diagnostics.summary.accepted, 1);
  assert.equal(result.diagnostics.summary.downgraded, 1);
}

{
  const result = validateAdherenceEvidencePayload({
    verdicts: [{
      directive_id: 'd1',
      verdict: 'followed',
      confidence: 0.9,
      evidence_refs: [{ kind: 'diff', ref: 'working-tree-diff' }],
      reason: 'diff was mentioned but no captured snapshot hash was provided',
    }],
  }, ['d1'], { projectRoot });
  assert.equal(result.verdicts.length, 1);
  assert.equal(result.verdicts[0].verdict, 'unverified');
  assert.equal(result.diagnostics.summary.downgraded, 1);
  assert.equal(result.diagnostics.entries[0].reason, 'insufficient-static-evidence');
}
