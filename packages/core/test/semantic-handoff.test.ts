import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type CompileDelegationInput,
  type FactBundle,
  type SemanticContract,
} from '../src/index.ts';
import { HandoffValidationError } from '../src/handoff/types.ts';
import {
  checkDefinitionFingerprint,
  factBundleFingerprint,
  factCollectionId,
} from '../src/facts/validate.ts';
import { sha256, stableFingerprint } from '../src/shared/protocol.ts';

const PROTOCOL = 'semantic-delegation' as const;
const SCHEMA_VERSION = '1' as const;
const TIMESTAMP = '2026-08-03T12:00:00.000Z';

test('compileDelegation separates exact Human Events from Agent interpretations', () => {
  const input = compileInput();
  const result = compileDelegation(input);

  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  assert.equal(result.contract.authority.humanEvents[0].content, input.humanEvents[0].content);
  assert.equal(result.contract.semantic.desiredOutcome.value, 'Replace the legacy workflow with an inspectable handoff.');
  assert.deepEqual(result.contract.semantic.desiredOutcome.basis.humanEventIds, ['event:task']);
  assert.equal(result.contract.semantic.consequence, 'high');
  assert.equal(result.contract.assurancePlan.profile, 'critical');
  assert.deepEqual(
    result.contract.assurancePlan.requirements.map((item) => ({
      dimension: item.value,
      criticality: item.criticality,
    })),
    [{ dimension: 'behavior', criticality: 'adoption-critical' }],
  );
  assert.ok(result.contract.interpretationTrace.some((item) =>
    item.field === 'assurance-dimension'));
  assert.equal(result.contract.authorization.focusPathsArePermissions, false);
  assert.equal(result.contract.verification.mode, 'checks');
  assert.match(result.contract.contractId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(compileDelegation(input), result);
});

test('compileDelegation derives inspectable routine, standard, and critical assurance plans', () => {
  const routine = compileInput();
  routine.semantic.consequence.value = 'low';
  routine.semantic.assuranceDimensions = [];
  const compiledRoutine = compileDelegation(routine);
  assert.equal(compiledRoutine.status, 'delegation-compiled');
  if (compiledRoutine.status !== 'delegation-compiled') return;
  assert.deepEqual(compiledRoutine.contract.assurancePlan, {
    profile: 'routine',
    requirements: [],
  });

  const standard = compileInput();
  standard.semantic.consequence.value = 'medium';
  standard.semantic.assuranceDimensions = [{
    dimension: 'maintenance',
    criticality: 'material',
    rationale: 'The ownership boundary should remain understandable after adoption.',
    basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
  }];
  const compiledStandard = compileDelegation(standard);
  assert.equal(compiledStandard.status, 'delegation-compiled');
  if (compiledStandard.status !== 'delegation-compiled') return;
  assert.equal(compiledStandard.contract.assurancePlan.profile, 'standard');
  assert.equal(compiledStandard.contract.assurancePlan.requirements[0].value, 'maintenance');

  const escalated = compileInput();
  escalated.semantic.consequence.value = 'medium';
  const compiledEscalated = compileDelegation(escalated);
  assert.equal(compiledEscalated.status, 'delegation-compiled');
  if (compiledEscalated.status !== 'delegation-compiled') return;
  assert.equal(compiledEscalated.contract.assurancePlan.profile, 'critical');
});

test('compileDelegation rejects consequence labels without actionable assurance dimensions', () => {
  const medium = compileInput();
  medium.semantic.consequence.value = 'medium';
  medium.semantic.assuranceDimensions = [];
  const invalidMedium = compileDelegation(medium);
  assert.equal(invalidMedium.status, 'authority-invalid');
  if (invalidMedium.status === 'authority-invalid') {
    assert.ok(invalidMedium.issues.some((item) => item.code === 'assurance-dimension-required'));
  }

  const high = compileInput();
  high.semantic.assuranceDimensions[0].criticality = 'material';
  const invalidHigh = compileDelegation(high);
  assert.equal(invalidHigh.status, 'authority-invalid');
  if (invalidHigh.status === 'authority-invalid') {
    assert.ok(invalidHigh.issues.some((item) =>
      item.code === 'critical-assurance-dimension-required'));
  }

  const duplicate = compileInput();
  duplicate.semantic.assuranceDimensions.push(structuredClone(
    duplicate.semantic.assuranceDimensions[0],
  ));
  const invalidDuplicate = compileDelegation(duplicate);
  assert.equal(invalidDuplicate.status, 'authority-invalid');
  if (invalidDuplicate.status === 'authority-invalid') {
    assert.ok(invalidDuplicate.issues.some((item) => item.code === 'assurance-dimension-duplicate'));
  }
});

test('compileDelegation rejects unknown protocols and schema versions without compatibility', () => {
  assert.throws(
    () => compileDelegation({ ...compileInput(), protocol: 'legacy' as never }),
    /UNSUPPORTED_PROTOCOL/,
  );
  assert.throws(
    () => compileDelegation({ ...compileInput(), schemaVersion: '1.0' as never }),
    /UNSUPPORTED_SCHEMA_VERSION/,
  );

  const legacy = structuredClone(compileInput()) as unknown as {
    verification: { checks: Array<Record<string, unknown>> };
  };
  const check = legacy.verification.checks[0];
  delete check.commandDefinitionPaths;
  check.verifierRefs = [{ path: 'package.json', role: 'command-definition' }];
  const result = compileDelegation(legacy as unknown as CompileDelegationInput);
  assert.equal(result.status, 'authority-invalid');
  if (result.status === 'authority-invalid') {
    assert.ok(result.issues.some((item) => item.path.endsWith('.verifierRefs')));
    assert.ok(result.issues.some((item) => item.path.endsWith('.commandDefinitionPaths')));
  }

  const oldAuthoring = structuredClone(compileInput()) as unknown as Record<string, unknown>;
  oldAuthoring.interpretations = [{
    id: 'meaning:outcome',
    field: 'desired-outcome',
    value: 'Legacy relational input.',
    basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
  }];
  oldAuthoring.semantic = {
    desiredOutcomeId: 'meaning:outcome',
    constraintIds: [],
    nonGoalIds: [],
    focusIds: [],
    consequenceId: 'meaning:consequence',
  };
  const obsolete = compileDelegation(oldAuthoring as unknown as CompileDelegationInput);
  assert.equal(obsolete.status, 'authority-invalid');
  if (obsolete.status === 'authority-invalid') {
    assert.ok(obsolete.issues.some((item) => item.path === 'interpretations'));
    assert.ok(obsolete.issues.some((item) => item.path === 'semantic.desiredOutcomeId'));
  }
});

test('compileDelegation returns authority-invalid for fabricated fingerprints and references', () => {
  const fingerprint = compileInput();
  fingerprint.humanEvents[0].contentFingerprint = sha256('different content');
  const invalidFingerprint = compileDelegation(fingerprint);
  assert.equal(invalidFingerprint.status, 'authority-invalid');
  if (invalidFingerprint.status === 'authority-invalid') {
    assert.ok(invalidFingerprint.issues.some((issue) => issue.code === 'human-event-fingerprint-mismatch'));
  }

  const reference = compileInput();
  reference.semantic.desiredOutcome.basis.humanEventIds = ['event:missing'];
  const invalidReference = compileDelegation(reference);
  assert.equal(invalidReference.status, 'authority-invalid');
  if (invalidReference.status === 'authority-invalid') {
    assert.ok(invalidReference.issues.some((issue) => issue.code === 'human-event-reference-missing'));
  }
});

test('compileDelegation prevents runs for material forks and absent verification', () => {
  const forked = compileInput();
  forked.semantic.unresolvedMaterialFork = {
    question: 'Which public compatibility boundary should remain?',
    alternatives: ['Break it now', 'Retain it for one release'],
    decisionImpact: 'The public API and migration cost differ.',
  };
  assert.equal(compileDelegation(forked).status, 'semantic-decision-required');

  const missing = compileInput();
  missing.verification = {};
  assert.equal(compileDelegation(missing).status, 'verification-required');

  const noCommand = compileInput();
  noCommand.verification = {
    noCommandRationale: 'The task changes prose only and has no executable acceptance command.',
  };
  const result = compileDelegation(noCommand);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status === 'delegation-compiled') {
    assert.deepEqual(result.contract.verification, {
      mode: 'no-command',
      rationale: 'The task changes prose only and has no executable acceptance command.',
    });
  }
});

test('evaluateHandoff accepts a fact-bound, falsified handoff for human review', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const handoff = validHandoff(facts);
  const evaluation = evaluateHandoff({
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  });

  assert.equal(evaluation.status, 'handoff-ready');
  assert.equal(evaluation.factCollectionId, facts.factCollectionId);
  assert.equal(evaluation.claimConclusions?.[0].basis, 'agent-judgment');
  assert.equal(evaluation.claimConclusions?.[0].falsification, 'supported');
  assert.match(evaluation.humanAuthorityNotice, /human review only/);
});

test('evaluateHandoff allows a clean routine handoff without claims or review boilerplate', () => {
  const input = compileInput();
  input.semantic.consequence.value = 'low';
  input.semantic.assuranceDimensions = [];
  const compiled = compileDelegation(input);
  assert.equal(compiled.status, 'delegation-compiled');
  if (compiled.status !== 'delegation-compiled') return;
  const facts = factBundle(compiled.contract, 'passed');
  const handoff = validHandoff(facts);
  handoff.materialClaims = [];
  handoff.reviewMap = [];

  const evaluation = evaluateHandoff(evaluationInput(compiled.contract, facts, handoff));
  assert.equal(evaluation.status, 'handoff-ready');
  assert.deepEqual(evaluation.claimConclusions, []);
  assert.deepEqual(evaluation.reviewMap, []);
});

test('evaluateHandoff lets collected fact failures escalate a routine plan', () => {
  const input = compileInput();
  input.semantic.consequence.value = 'low';
  input.semantic.assuranceDimensions = [];
  const compiled = compileDelegation(input);
  assert.equal(compiled.status, 'delegation-compiled');
  if (compiled.status !== 'delegation-compiled') return;
  const facts = factBundle(compiled.contract, 'unavailable');
  const handoff = validHandoff(facts);
  handoff.materialClaims = [];
  handoff.reviewMap = [];
  assert.throws(
    () => evaluateHandoff(evaluationInput(compiled.contract, facts, handoff)),
    /requires must-read or unresolved Review Map coverage/,
  );

  handoff.reviewMap = [{
    id: 'review:unavailable-check',
    priority: 'unresolved',
    changedFiles: [],
    checkIds: ['test'],
    claimIds: [],
    unknownIds: [],
    rationale: 'The frozen verification boundary produced no result.',
    prevents: 'Adopting without inspecting the missing verification evidence.',
  }];
  const evaluation = evaluateHandoff(evaluationInput(compiled.contract, facts, handoff));
  assert.equal(evaluation.status, 'needs-attention');
  assert.ok(evaluation.attention.some((item) => item.code === 'check-unavailable'));
});

test('evaluateHandoff enforces compiled assurance dimensions and critical review escalation', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');

  const missing = validHandoff(facts);
  missing.materialClaims[0].dimension = 'compatibility';
  assert.throws(
    () => evaluateHandoff(evaluationInput(contract, facts, missing)),
    /requires a behavior claim/,
  );

  const downgraded = validHandoff(facts);
  downgraded.materialClaims[0].adoptionCritical = false;
  delete downgraded.materialClaims[0].falsification;
  assert.throws(
    () => evaluateHandoff(evaluationInput(contract, facts, downgraded)),
    /requires an adoption-critical behavior claim/,
  );

  const unreviewed = validHandoff(facts);
  unreviewed.reviewMap[0].priority = 'useful-to-sample';
  assert.throws(
    () => evaluateHandoff(evaluationInput(contract, facts, unreviewed)),
    /requires must-read or unresolved review coverage/,
  );
});

test('evaluateHandoff detects stale facts before accepting Host conclusions', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const result = evaluateHandoff({
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: sha256('later worktree'),
    handoff: validHandoff(facts),
  });
  assert.equal(result.status, 'facts-stale');
  assert.equal(result.handoffFingerprint, undefined);
});

test('evaluateHandoff rejects failed checks and surfaces unavailable checks', () => {
  const contract = compiledContract();
  const failed = factBundle(contract, 'failed');
  const failedHandoff = validHandoff(failed);
  failedHandoff.reviewMap[0].priority = 'must-read';
  const failedResult = evaluateHandoff({
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contract,
    factBundle: failed,
    currentWorktreeFingerprint: failed.current.fingerprint,
    handoff: failedHandoff,
  });
  assert.equal(failedResult.status, 'rejected');
  const failedAttention = failedResult.attention.find((item) => item.code === 'check-failed');
  assert.ok(failedAttention);
  assert.deepEqual(failedAttention.references, { checks: ['test'] });
  assert.equal(failedAttention.resolution.kind, 'repair-or-revise');
  assert.match(failedAttention.adoptionImpact, /contradicts readiness/);

  const unavailable = factBundle(contract, 'unavailable');
  const unavailableHandoff = validHandoff(unavailable);
  unavailableHandoff.reviewMap[0].priority = 'must-read';
  const unavailableResult = evaluateHandoff({
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contract,
    factBundle: unavailable,
    currentWorktreeFingerprint: unavailable.current.fingerprint,
    handoff: unavailableHandoff,
  });
  assert.equal(unavailableResult.status, 'needs-attention');
  const unavailableAttention = unavailableResult.attention.find((item) => item.code === 'check-unavailable');
  assert.ok(unavailableAttention);
  assert.deepEqual(unavailableAttention.references, { checks: ['test'] });
  assert.equal(unavailableAttention.resolution.kind, 'supply-evidence');
  assert.match(unavailableAttention.summary, /Executable was not available/);
});

test('evaluateHandoff requires falsification and urgent Review Map coverage', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const missing = validHandoff(facts);
  delete missing.materialClaims[0].falsification;
  assert.throws(
    () => evaluateHandoff(evaluationInput(contract, facts, missing)),
    /requires falsification/,
  );

  const uncovered = validHandoff(facts);
  uncovered.materialClaims[0].falsification!.status = 'partial';
  uncovered.materialClaims[0].falsification!.counterEvidence = {
    changedFiles: [facts.changedFiles[0].path],
  };
  uncovered.reviewMap[0].priority = 'useful-to-sample';
  assert.throws(
    () => evaluateHandoff(evaluationInput(contract, facts, uncovered)),
    /requires must-read or unresolved review coverage/,
  );

  uncovered.reviewMap[0].priority = 'must-read';
  const partial = evaluateHandoff(evaluationInput(contract, facts, uncovered));
  assert.equal(partial.status, 'needs-attention');
});

test('evaluateHandoff rejects contradicted critical claims and preserves counterevidence', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const handoff = validHandoff(facts);
  handoff.materialClaims[0].falsification!.status = 'contradicted';
  handoff.materialClaims[0].falsification!.supportingEvidence = {};
  handoff.materialClaims[0].falsification!.counterEvidence = {
    changedFiles: [facts.changedFiles[0].path],
  };
  handoff.reviewMap[0].priority = 'must-read';
  const result = evaluateHandoff(evaluationInput(contract, facts, handoff));
  assert.equal(result.status, 'rejected');
  assert.ok(result.attention.some((item) => item.code === 'critical-claim-contradicted'));
});

test('evaluateHandoff rejects obsolete Host machine facts and aggregates independent issues', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const obsolete = structuredClone(validHandoff(facts)) as unknown as Record<string, unknown>;
  obsolete.factCollectionId = sha256('another collection');
  const claims = obsolete.materialClaims as Array<Record<string, unknown>>;
  claims[0].basis = 'runtime-fact';
  claims[0].runtimeStatement = 'Check test was passed.';
  assert.throws(
    () => evaluateHandoff(evaluationInput(
      contract,
      facts,
      obsolete as unknown as CognitiveHandoff,
    )),
    (error: unknown) => {
      assert.ok(error instanceof HandoffValidationError);
      assert.ok(error.issues.some((issue) => issue.path === 'factCollectionId'));
      assert.ok(error.issues.some((issue) => issue.path === 'materialClaims[0].basis'));
      assert.ok(error.issues.some((issue) => issue.path === 'materialClaims[0].runtimeStatement'));
      return true;
    },
  );
});

test('evaluateHandoff makes residual unknowns first-class attention', () => {
  const contract = compiledContract();
  const facts = factBundle(contract, 'passed');
  const handoff = validHandoff(facts);
  handoff.residualUnknowns = [{
    id: 'unknown:operation',
    statement: 'Production latency was not measured.',
    adoptionImpact: 'The rollout could regress response time.',
    validationPath: 'Run the production-shaped benchmark before rollout.',
    references: {
      claims: ['claim:critical'],
      changedFiles: [facts.changedFiles[0].path],
    },
  }];
  handoff.reviewMap.push({
    id: 'review:unknown',
    priority: 'unresolved',
    changedFiles: [facts.changedFiles[0].path],
    checkIds: [],
    claimIds: ['claim:critical'],
    unknownIds: ['unknown:operation'],
    rationale: 'Operational behavior lacks production evidence.',
    prevents: 'Adopting a latency regression without a known validation path.',
  });
  const result = evaluateHandoff(evaluationInput(contract, facts, handoff));
  assert.equal(result.status, 'needs-attention');
  const attention = result.attention.find((item) => item.code === 'residual-unknown');
  assert.ok(attention);
  assert.deepEqual(attention.references.unknowns, ['unknown:operation']);
  assert.equal(attention.resolution.kind, 'execute-validation');
  assert.equal(attention.resolution.action, 'Run the production-shaped benchmark before rollout.');
});

test('evaluateHandoff groups one changed verifier surface across checks', () => {
  const input = compileInput();
  const first = input.verification.checks![0];
  first.commandDefinitionPaths = [];
  first.acceptanceSurfacePaths = ['src/index.ts'];
  input.verification.checks!.push({
    ...structuredClone(first),
    id: 'test:secondary',
    rationale: 'Exercise a second boundary using the same acceptance surface.',
  });
  const compiled = compileDelegation(input);
  assert.equal(compiled.status, 'delegation-compiled');
  if (compiled.status !== 'delegation-compiled') return;
  const facts = factBundle(compiled.contract, 'passed');
  const handoff = validHandoff(facts);
  handoff.reviewMap[0].priority = 'must-read';
  handoff.reviewMap[0].checkIds = ['test', 'test:secondary'];
  const result = evaluateHandoff(evaluationInput(compiled.contract, facts, handoff));

  assert.equal(result.status, 'needs-attention');
  const verifierAttention = result.attention.filter((item) =>
    item.code === 'verifier-surface-changed');
  assert.equal(verifierAttention.length, 1);
  assert.deepEqual(verifierAttention[0].references, {
    changedFiles: ['src/index.ts'],
    checks: ['test', 'test:secondary'],
  });
  assert.match(verifierAttention[0].summary, /checks test, test:secondary/);
});

function compileInput(): CompileDelegationInput {
  const eventContent = 'Replace the current implementation with the approved Semantic Handoff MVP.';
  return {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    humanEvents: [{
      id: 'event:task',
      kind: 'task',
      content: eventContent,
      contentFingerprint: sha256(eventContent),
      provider: 'test-host',
      nativeId: 'message-1',
    }],
    semantic: {
      desiredOutcome: {
        value: 'Replace the legacy workflow with an inspectable handoff.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      constraints: [{
        value: 'Do not add a compatibility layer.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
      nonGoals: [{
        value: 'Do not implement cross-task Decision Continuity.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
      focus: [{
        value: 'packages/core',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
      consequence: {
        value: 'high',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      assuranceDimensions: [{
        dimension: 'behavior',
        criticality: 'adoption-critical',
        rationale: 'The public workflow behavior determines whether the new handoff can be adopted.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
    },
    verification: {
      checks: [{
        id: 'test',
        rationale: 'Exercise the public contract and handoff behavior.',
        argv: ['corepack', 'pnpm', 'test'],
        timeoutMs: 120_000,
        source: 'host-task',
        commandDefinitionPaths: ['package.json'],
        acceptanceSurfacePaths: [],
      }],
    },
  };
}

function compiledContract(): SemanticContract {
  const result = compileDelegation(compileInput());
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') throw new Error('fixture did not compile');
  return result.contract;
}

function factBundle(
  contract: SemanticContract,
  status: 'passed' | 'failed' | 'unavailable',
): FactBundle {
  assert.equal(contract.verification.mode, 'checks');
  if (contract.verification.mode !== 'checks') throw new Error('fixture requires checks');
  const changedFile = {
    id: 'file:source',
    path: 'src/index.ts',
    operation: 'modified' as const,
    before: { kind: 'file' as const, contentDigest: sha256('before'), mode: '100644' },
    after: { kind: 'file' as const, contentDigest: sha256('after'), mode: '100644' },
    representation: 'text' as const,
    patchDigest: sha256('patch section'),
  };
  const base = {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contractId: contract.contractId,
    collectedAt: TIMESTAMP,
    baseline: {
      head: 'abc123',
      fingerprint: sha256('baseline'),
      entryCount: 2,
      capturedAt: TIMESTAMP,
    },
    current: {
      head: 'abc123',
      fingerprint: sha256('current'),
      entryCount: 2,
      capturedAt: TIMESTAMP,
    },
    changeFingerprint: stableFingerprint([changedFile]),
    changedFiles: [changedFile],
    checks: contract.verification.checks.map((checkDefinition) => ({
      id: checkDefinition.id,
      status,
      argv: checkDefinition.argv,
      exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
      definitionFingerprint: checkDefinitionFingerprint(checkDefinition),
      outputDigest: sha256(`output:${checkDefinition.id}:${status}`),
      stdout: {
        digest: sha256(''),
        byteLength: 0,
        persistedBytes: 0,
        truncated: false,
      },
      stderr: {
        digest: sha256(''),
        byteLength: 0,
        persistedBytes: 0,
        truncated: false,
      },
      ...(status === 'unavailable' ? { reason: 'Executable was not available.' } : {}),
    })),
    verifierMutations: contract.verification.checks.flatMap((checkDefinition) =>
      checkDefinition.verifierRefs.flatMap((reference) => reference.path === changedFile.path
        ? [{
            checkId: checkDefinition.id,
            path: reference.path,
            role: reference.role,
            changedFileId: changedFile.id,
          }]
        : [])),
    patch: {
      path: 'change.patch',
      digest: sha256('complete patch'),
      byteLength: Buffer.byteLength('complete patch'),
    },
    provenance: {
      collector: 'resonant-code-cli' as const,
      cliVersion: '0.0.1',
      coreVersion: '0.0.1',
    },
  };
  const factCollection = factCollectionId(base);
  const withCollection = { ...base, factCollectionId: factCollection };
  return {
    ...withCollection,
    bundleFingerprint: factBundleFingerprint(withCollection),
  };
}

function validHandoff(facts: FactBundle): CognitiveHandoff {
  return {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    systemMeaningUpdate: 'The public workflow now binds implementation claims to collected repository facts.',
    materialClaims: [{
      id: 'claim:critical',
      dimension: 'behavior',
      statement: 'The implementation exposes the new semantic handoff behavior.',
      adoptionConsequence: 'Reviewers can use the new workflow for production changes.',
      adoptionCritical: true,
      basis: 'agent-judgment',
      evidence: {
        changedFiles: [facts.changedFiles[0].path],
        checks: ['test'],
      },
      falsification: {
        failureHypothesis: 'The public behavior could diverge from the requested semantic handoff.',
        attempt: 'Inspected the complete change and ran the frozen public-contract test.',
        status: 'supported',
        supportingEvidence: {
          changedFiles: [facts.changedFiles[0].path],
          checks: ['test'],
        },
        counterEvidence: {},
        conclusion: 'No conflicting behavior was found within the collected diff and check boundary.',
      },
    }],
    residualUnknowns: [],
    reviewMap: [{
      id: 'review:core',
      priority: 'must-read',
      changedFiles: [facts.changedFiles[0].path],
      checkIds: ['test'],
      claimIds: ['claim:critical'],
      unknownIds: [],
      rationale: 'This file owns the public behavior change.',
      prevents: 'Missing an unintended change to the public contract.',
    }],
  };
}

function evaluationInput(
  contract: SemanticContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
) {
  return {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  };
}
