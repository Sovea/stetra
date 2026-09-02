import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDelegation,
  type CompileDelegationInput,
  type TaskContract,
} from '@sovea/stetra-core';

import {
  compileHandoffAuthoring,
  compilePrepareAuthoring,
  compileVerificationRevisionAuthoring,
  DEFAULT_EXECUTION_BUDGET,
} from '../src/workflow/authoring-compiler.ts';

test('Prepare authoring binds transport identity, basis, defaults, and verification mode', () => {
  const compiled = compilePrepareAuthoring({
    prepareRequestId: 'prepare:semantic-authoring',
    source: {
      developerEvents: [
        { key: 'request', content: 'Preserve the public behavior.' },
        { key: 'choice', content: 'Keep strict compatibility.' },
      ],
      task: {
        desiredOutcome: 'Change the implementation without changing callers.',
        constraints: ['Preserve compatibility.'],
        nonGoals: [],
        focus: ['src/feature.ts'],
        repositoryEvidenceKeys: [],
      },
      assurance: {
        kind: 'routine',
        rationale: 'No bounded adoption condition is required for this compiler fixture.',
      },
      verification: {
        mode: 'no-command',
        rationale: 'The compiler fixture does not execute repository behavior.',
      },
    },
  });
  assert.equal(compiled.prepareRequestId, 'prepare:semantic-authoring');
  assert.deepEqual(compiled.task.basis.developerEventKeys, ['request', 'choice']);
  assert.deepEqual(compiled.executionBudget, DEFAULT_EXECUTION_BUDGET);
  assert.equal(compiled.noCommandRationale, 'The compiler fixture does not execute repository behavior.');
  assert.equal('checks' in compiled, false);
});

test('Verification authoring expands execution rebindings and keyed plan operations', () => {
  const contract = contractFixture();
  const rebound = compileVerificationRevisionAuthoring({
    contract,
    source: {
      kind: 'execution-rebinding',
      rationale: 'Use the available executable entry.',
      equivalenceClaim: 'The rebound argv exercises the same bounded verifier.',
      rebindings: [{
        checkKey: 'suite',
        execution: {
          preparation: [],
          assertion: { argv: ['node', '--test', 'test/rebound.test.ts'] },
        },
      }],
    },
  });
  assert.deepEqual(rebound.checks?.[0].execution.assertion.argv, [
    'node', '--test', 'test/rebound.test.ts',
  ]);
  assert.equal(rebound.checks?.[0].rationale, 'Exercise the public behavior.');

  const replaced = compileVerificationRevisionAuthoring({
    contract,
    source: {
      kind: 'verification-plan',
      rationale: 'Change the bounded acceptance surface.',
      equivalenceClaim: 'The replacement remains bound to the declared behavior.',
      plan: {
        mode: 'checks',
        operations: [{
          action: 'replace',
          checkKey: 'suite',
          check: {
            ...rebound.checks![0],
            rationale: 'Exercise the replacement acceptance surface.',
          },
        }],
      },
    },
  });
  assert.equal(replaced.checks?.[0].rationale, 'Exercise the replacement acceptance surface.');
  assert.throws(() => compileVerificationRevisionAuthoring({
    contract,
    source: {
      kind: 'verification-plan',
      rationale: 'Remove an unknown verifier.',
      equivalenceClaim: 'No equivalence is implied by this invalid fixture.',
      plan: { mode: 'checks', operations: [{ action: 'remove', checkKey: 'missing' }] },
    },
  }), /unknown check key missing/);
});

test('Handoff authoring derives canonical Review Decision reverse references once', () => {
  const contract = contractFixture();
  const compiled = compileHandoffAuthoring({
    contract,
    source: {
      actualChange: {
        behavior: 'The public behavior is preserved.',
        mechanism: ['The implementation keeps the legacy branch.'],
        preservedInvariants: ['Compatibility remains intact.'],
        failureAndRecovery: [],
        importantEffects: [],
        materialTradeoffs: [],
      },
      conditions: {
        compatibility: {
          status: 'unknown',
          summary: 'Direct review remains required.',
          obligations: {
            'legacy-path': {
              status: 'unknown',
              evidence: [],
              evidenceCoverage: {
                status: 'insufficient',
                rationale: 'The compiler fixture has no Runtime facts.',
                gaps: ['No observation was collected.'],
              },
              falsification: {
                attempt: 'Defined the bounded failure hypothesis.',
                observedResult: 'No Runtime observation is present in this fixture.',
              },
              counterEvidence: [],
              conclusion: 'The obligation remains unknown.',
            },
          },
        },
      },
      residualUnknowns: [],
      reviewDecisions: [{
        key: 'review-compatibility',
        targets: [
          { kind: 'condition', conditionKey: 'compatibility' },
          { kind: 'obligation', conditionKey: 'compatibility', obligationKey: 'legacy-path' },
        ],
        question: 'Is compatibility adequately preserved?',
        adoptionImpact: 'A compatibility break blocks adoption.',
        nextAction: 'Inspect the legacy path.',
        evidence: [],
      }],
      recommendation: {
        action: 'defer',
        rationale: 'Direct review remains required.',
        caveats: [],
      },
    },
  });
  assert.deepEqual(compiled.conditions[0].reviewDecisionKeys, ['review-compatibility']);
  assert.deepEqual(
    compiled.conditions[0].obligations[0].reviewDecisionKeys,
    ['review-compatibility'],
  );
  assert.deepEqual(compiled.reviewDecisions[0].conditionKeys, ['compatibility']);
  assert.deepEqual(compiled.reviewDecisions[0].obligationKeys, [{
    conditionKey: 'compatibility', obligationKey: 'legacy-path',
  }]);
});

function contractFixture(): TaskContract {
  const input: CompileDelegationInput = {
    protocol: 'cognitive-adoption',
    schemaVersion: '1',
    developerEvents: [{ key: 'request', content: 'Preserve compatibility.' }],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change the implementation without breaking callers.',
      constraints: ['Preserve compatibility.'],
      nonGoals: [],
      focus: ['src/feature.ts'],
    },
    materialDecisionForks: [],
    assurance: {
      kind: 'conditioned',
      conditions: [{
        key: 'compatibility',
        statement: 'Existing callers retain their behavior.',
        rationale: 'A compatibility break blocks adoption.',
        criticality: 'adoption-critical',
        evidenceObligations: [{
          key: 'legacy-path',
          statement: 'The legacy path retains its behavior.',
          falsification: {
            failureHypothesis: 'The new branch bypasses the legacy path.',
            scenario: 'Exercise the legacy path through the new branch.',
            supportingObservation: 'The legacy behavior is preserved.',
            contradictingObservation: 'The legacy behavior changes.',
          },
          strategies: [{ kind: 'runtime-check', checkKeys: ['suite'] }],
        }],
      }],
    },
    hostPolicyRequirements: [],
    executionBudget: DEFAULT_EXECUTION_BUDGET,
    checks: [{
      key: 'suite',
      rationale: 'Exercise the public behavior.',
      execution: {
        preparation: [],
        assertion: { argv: ['node', '--test', 'test/feature.test.ts'] },
      },
      executionInputs: [],
      baseline: { mode: 'unknown' },
      verifierSelectors: [{
        kind: 'file', path: 'test/feature.test.ts', role: 'acceptance-surface',
      }],
    }],
  };
  const compiled = compileDelegation(input);
  if (compiled.status !== 'delegation-compiled') {
    throw new Error(`Contract fixture did not compile: ${JSON.stringify(compiled)}`);
  }
  return compiled.contract;
}
