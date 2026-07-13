import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { compile } from '../src/compile.ts';
import { planGuidance } from '../src/plan-guidance.ts';
import { validateSemanticGovernanceGraphPayload } from '../src/ai-contracts/semantic-governance-graph.ts';
import { hostArtifactEnvelope } from '../src/ai-contracts/shared.ts';
import { applyEgoBudget, EGO_BUDGET } from '../src/ir/ego/budget.ts';
import { assertUniqueDirectiveIds, loadDirectiveFile, loadLocalPlaybook } from '../src/load/load-playbook.ts';

const builtinRoot = resolve(import.meta.dirname, '../../playbook');
const projectRoot = resolve(import.meta.dirname, '../..');

test('invalid playbook enums and missing rationale/examples are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-playbook-'));
  try {
    const file = join(root, 'invalid.yaml');
    writeFileSync(file, `- id: invalid\n  type: anything\n  scope: "**/*"\n  prescription: maybe\n  weight: huge\n  description: test\n  rationale: ""\n  examples: []\n`, 'utf8');
    assert.throws(() => loadDirectiveFile(file, 'builtin/core'), /Invalid type/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('v3 local playbook data is rejected after the v1 reset', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-old-local-playbook-'));
  try {
    const file = join(root, 'local-augment.yaml');
    writeFileSync(file, 'version: "3.0"\noverrides: []\naugments: []\nsuppresses: []\nadditions: []\n', 'utf8');
    assert.throws(() => loadLocalPlaybook(file), /UNSUPPORTED_SCHEMA_VERSION.*schema 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('duplicate directive ids are rejected globally', () => {
  const source = { kind: 'builtin' as const, layerId: 'builtin/core', filePath: 'a.yaml' };
  const directive = { id: 'duplicate', type: 'constraint' as const, layer: 'core', scope: { path: '**/*' }, prescription: 'must' as const, weight: 'high' as const, description: 'x', rationale: 'y', examples: [{ note: 'z' }], source };
  assert.throws(() => assertUniqueDirectiveIds([directive, { ...directive, source: { ...source, filePath: 'b.yaml' } }]), /Duplicate directive id/);
});

test('semantic graph caps validated candidates at five per directive', () => {
  const edges = Array.from({ length: 8 }, (_, index) => ({
    directive_id: 'd1', observation_id: `o${index}`, relation: 'ambient-only' as const, confidence: 0.9 - index / 100,
    reason: `candidate ${index}`, evidence_refs: [{ kind: 'file' as const, ref: 'runtime/src/types.ts:1-1', file: 'runtime/src/types.ts', line_range: [1, 1] as [number, number] }],
  }));
  const result = validateSemanticGovernanceGraphPayload({
    raw: { edges }, source: { id: 'cap-test' }, allowedDirectiveIds: ['d1'], allowedObservationIds: edges.map((edge) => edge.observation_id),
    evidenceContext: { projectRoot, observations: edges.map((edge) => ({ id: edge.observation_id, evidence: [], verification: { disposition: 'keep' } })) },
  });
  assert.equal((result.proposal.payload as { edges: unknown[] }).edges.length, 5);
  assert.equal(result.diagnostics.summary.accepted, 5);
  assert.equal(result.diagnostics.summary.unused, 3);
  assert.ok(result.diagnostics.entries.filter((entry) => entry.reason === 'capped-by-policy').length === 3);
});

test('EGO budget is bounded and hard overflow is diagnosable', () => {
  const result = applyEgoBudget({
    taskIntent: { workflow: 'code', change_type: 'feature', operation: 'modify', target_layer: 'unknown', tech_stack: [], changed_files: [], tags: [] },
    guidance: {
      must_follow: Array.from({ length: 30 }, (_, index) => ({ id: `d${index}`, statement: `hard ${index}`, rationale: 'rationale', prescription: 'must' as const, exceptions: [], examples: [{ note: 'example' }, { note: 'extra' }], execution_mode: 'enforce' as const })),
      avoid: [], context_tensions: [], ambient: Array.from({ length: 20 }, (_, index) => `ambient ${index}`),
    },
  });
  assert.equal(result.exceeded, true);
  assert.ok(result.ego.guidance.must_follow.length <= EGO_BUDGET.hardItems);
  assert.ok(result.ego.guidance.ambient.length <= EGO_BUDGET.ambientItems);
  assert.ok(JSON.stringify(result.ego).length <= EGO_BUDGET.serializedCharacters);
  assert.ok(result.omissions.some((item) => item.reason === 'hard-item-limit'));
});

test('same compile input produces a stable v1 packet', async () => {
  const input = {
    builtinRoot, projectRoot,
    task: { description: 'Modify a small feature', workflow: 'code' as const, changeType: 'feature' as const, operation: 'modify' as const, targetFile: 'runtime/src/types.ts', changedFiles: ['runtime/src/types.ts'], techStack: ['typescript'] },
  };
  const first = await compile(input);
  const second = await compile(input);
  assert.deepEqual(second.packet, first.packet);
  assert.ok(first.trace.activation.selected_layers.includes('builtin/task-types/feature'));
});

test('compile accepts the exact semantic graph contract issued by planGuidance', async () => {
  const task = {
    description: 'Migrate the v1 Runtime lifecycle',
    workflow: 'code' as const,
    changeType: 'migration' as const,
    operation: 'modify' as const,
    targetFile: 'runtime/src/index.ts',
    changedFiles: ['runtime/src/index.ts', 'skills/code/internal/workflow.mjs'],
    techStack: ['typescript'],
    riskLevel: 'high' as const,
    scopeSize: 'cross-cutting' as const,
    compatibilityRequirement: 'breaking-allowed' as const,
    migrationPhase: 'cutover' as const,
  };
  const paths = {
    agentCapabilityProfile: 'agent-capability.json',
    taskModel: 'task-model.json',
    semanticGovernanceGraph: 'semantic-graph.json',
    contextAcquisition: 'context-acquisition.json',
  };
  const base = {
    builtinRoot,
    projectRoot,
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    lockfilePath: resolve(projectRoot, '.resonant-code/playbook.lock.yaml'),
    task,
  };
  const initialPlan = await planGuidance({ ...base, mode: 'strict', artifactPaths: paths });
  const taskContract = initialPlan.requiredContracts.find((item) => item.kind === 'task-model')!.contract;
  const taskArtifact = hostArtifactEnvelope(taskContract, {
    intent: {
      workflow: evidenceField('code'),
      change_type: evidenceField('migration'),
      operation: evidenceField('modify'),
    },
    context: {
      risk_level: evidenceField('high'),
      scope_size: evidenceField('cross-cutting'),
      compatibility_requirement: evidenceField('breaking-allowed'),
      migration_phase: evidenceField('cutover'),
    },
    uncertainties: [],
  });
  const planned = await planGuidance({
    ...base,
    mode: 'strict',
    artifactPaths: paths,
    artifacts: { taskModel: { raw: taskArtifact, path: paths.taskModel } },
  });
  const graphContract = planned.requiredContracts.find((item) => item.kind === 'semantic-governance-graph')!.contract;
  const output = await compile({
    ...base,
    artifacts: {
      taskModel: { raw: taskArtifact, path: paths.taskModel },
      semanticGovernanceGraph: { raw: hostArtifactEnvelope(graphContract, { edges: [] }), path: paths.semanticGovernanceGraph },
    },
  });
  assert.equal(output.packet.status, 'compiled');
  assert.equal(output.contractDiagnostics.some((item) => item.summary.rejected > 0), false);
});

test('forged host proposals and wrong artifact fingerprints cannot affect EGO', async () => {
  const task = { description: 'Modify a feature', workflow: 'code' as const, changeType: 'feature' as const, operation: 'modify' as const, targetFile: 'runtime/src/types.ts' };
  const baseline = await compile({ builtinRoot, projectRoot, task });
  const output = await compile({
    builtinRoot, projectRoot,
    task,
    artifacts: {
      semanticGovernanceGraph: {
        raw: { schema_version: 1, kind: 'semantic-governance-graph', request_id: 'forged', context_fingerprint: 'wrong', payload: { edges: [{ directive_id: 'unknown', observation_id: 'unknown', relation: 'suppress' }] } },
      },
    },
    hostProposals: [{ kind: 'semantic-governance-graph', source: { id: 'forged' }, payload: { edges: [{ directive_id: 'core-simplicity-over-cleverness-01', observation_id: 'forged', relation: 'suppress' }] } }] as any,
  });
  assert.equal(output.packet.status, 'needs-attention');
  assert.ok(output.contractDiagnostics.some((diagnostic) => diagnostic.entries.some((entry) => entry.path === 'request_id')));
  assert.equal(output.packet.governance.semantic_merge.merge_summary.host_graph_edge_count, 0);
  assert.deepEqual(output.ego, baseline.ego);
});

test('v3 host artifact envelopes are rejected after the v1 reset', async () => {
  const output = await compile({
    builtinRoot,
    projectRoot,
    task: { description: 'Modify a feature', workflow: 'code', changeType: 'feature', operation: 'modify', targetFile: 'runtime/src/types.ts' },
    artifacts: {
      semanticGovernanceGraph: {
        raw: { schema_version: 3, kind: 'semantic-governance-graph', request_id: 'old-v3', context_fingerprint: 'old-v3', payload: { edges: [] } },
      },
    },
  });
  assert.equal(output.packet.status, 'needs-attention');
  assert.ok(output.contractDiagnostics.some((diagnostic) => diagnostic.entries.some((entry) => entry.path === 'schema_version' && entry.reason === 'unsupported-schema-version')));
});

test('unknown change type does not activate task-type guidance and records fallback', async () => {
  const output = await compile({ builtinRoot, projectRoot, task: { description: 'Inspect an ambiguous change', workflow: 'code', operation: 'modify', targetFile: 'README.md' } });
  assert.equal(output.packet.task.change_type, 'unknown');
  assert.ok(!output.trace.activation.selected_layers.some((layer) => layer.startsWith('builtin/task-types/')));
  assert.ok(output.packet.interpretation.input_provenance.unresolved_fields.includes('intent.change_type'));
});

function evidenceField(value: string) {
  return {
    value,
    confidence: 1,
    evidence_refs: [{ kind: 'conversation' as const, ref: 'lifecycle-regression-test' }],
  };
}
