import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActivationDecisionsIR } from '../src/ir/activation/resolve-activation.ts';
import type { ChangeType, Operation } from '../src/types.ts';
import type { DirectiveIR, GovernanceIRBundle, TaskIR } from '../src/ir/types.ts';

const changeTypes: ChangeType[] = ['feature', 'bugfix', 'refactor', 'migration'];
const operations: Operation[] = ['create', 'modify'];

for (const changeType of changeTypes) {
  for (const operation of operations) {
    test(`${changeType} activates independently of ${operation} operation`, () => {
      const decisions = resolveActivationDecisionsIR(bundle(changeType, operation));
      const activated = decisions.filter((decision) => decision.status === 'activated').map((decision) => decision.directiveId);
      assert.deepEqual(activated, [`directive-${changeType}`]);
    });
  }
}

test('unknown change type does not activate a task-type layer', () => {
  const decisions = resolveActivationDecisionsIR(bundle('unknown', 'modify'));
  assert.equal(decisions.every((decision) => decision.status === 'skipped' && decision.reason === 'layer-mismatch'), true);
});

function bundle(changeType: ChangeType, operation: Operation): GovernanceIRBundle {
  const task: TaskIR = {
    irVersion: 'governance-ir/v1',
    id: 'task',
    workflow: 'code',
    changeType,
    operation,
    targetLayer: 'module',
    targets: [],
    techStack: [],
    tags: [],
    context: contextProfile(),
    provenance: [],
    unresolved: changeType === 'unknown' ? ['intent.change_type'] : [],
    diagnostics: { clarificationRecommended: changeType === 'unknown', ambiguityReasons: [] },
  };
  return {
    task,
    directives: changeTypes.map(directive),
  } as unknown as GovernanceIRBundle;
}

function directive(changeType: Exclude<ChangeType, 'unknown'>): DirectiveIR {
  return {
    irVersion: 'governance-ir/v1',
    id: `directive-${changeType}`,
    semanticKey: `directive-${changeType}`,
    source: { kind: 'builtin-playbook', id: changeType, path: `playbook/task-types/${changeType}.yaml` },
    layer: { id: `builtin/task-types/${changeType}`, rank: 50 },
    scope: { path: '**/*' },
    kind: 'constraint',
    prescription: 'must',
    weight: 'high',
    priority: { layerRank: 50, prescriptionRank: 2, weightRank: 3, localOverrideRank: 0 },
    body: { description: changeType, rationale: changeType, exceptions: [], examples: [{ note: changeType }] },
    traits: { rcclImmune: false, safetyCritical: false, broadScope: false, compatibilitySensitive: false, migrationSensitive: false },
    local: { overrideApplied: false, augmentApplied: false, suppressed: false },
  };
}

function contextProfile() {
  return {
    optimization_target: 'maintainability' as const,
    hard_constraints: [],
    allowed_tradeoffs: [],
    avoid: [],
    risk_level: 'medium' as const,
    scope_size: 'module' as const,
    compatibility_requirement: 'none' as const,
    interface_sensitivity: 'internal' as const,
    refactor_tolerance: 'bounded' as const,
    migration_phase: 'none' as const,
    review_goal: 'correctness' as const,
  };
}
