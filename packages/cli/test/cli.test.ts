import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { formatCliOutput, runCli } from '../src/cli.ts';

test('Commander exposes the initial lifecycle without obsolete repair/finalize commands', async () => {
  const help = await runCli(['change', '--help']);
  const text = String(help.output);
  for (const command of [
    'prepare', 'collect', 'diagnose', 'revise-verification', 'challenge',
    'handoff', 'decide', 'resolve', 'explain',
  ]) {
    assert.match(text, new RegExp(command));
  }
  assert.doesNotMatch(text, /\brepair \[options\]/);
  assert.doesNotMatch(text, /finalize/);
  await assert.rejects(runCli(['change', 'repair']), /unknown command/);
});

test('CLI JSON mode executes compact prepare, baseline-aware collect, layered handoff, decide, and events', async () => {
  const root = createRepository();
  try {
    const prepareExecution = await runCli([
      'change', 'prepare', root, '--input', '-', '--json',
    ], { input: jsonStream(prepareDocument()) });
    const prepared = prepareExecution.output as {
      status: string;
      taskId: string;
      taskContract: {
        understanding: { desiredOutcome: { value: string } };
        adoptionConditions: Array<{ id: string; evidenceObligations: Array<{ id: string }> }>;
      };
      baselineVerification: { checks: Array<{ mode: string }> };
    };
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskContract.understanding.desiredOutcome.value, 'Change the CLI fixture.');
    assert.equal(prepared.baselineVerification.checks[0].mode, 'unknown');
    assert.equal(prepareExecution.json, true);
    const preparedJson = formatCliOutput(prepareExecution);
    assert.doesNotMatch(preparedJson, /\u001b\[/);
    assert.ok(preparedJson.indexOf('"hostAction"') < preparedJson.indexOf('"status"'));
    assert.match(formatCliOutput({ ...prepareExecution, json: false, color: false }), /Desired outcome/);

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collectExecution = await runCli([
      'change', 'collect', root, '--task', prepared.taskId, '--json',
    ]);
    const collected = collectExecution.output as {
      status: string;
      changedFiles: Array<{ path: string }>;
      checks: Array<{ definitionId: string; status: string }>;
      checkComparisons: Array<{ relation: string }>;
    };
    assert.equal(collected.status, 'facts-collected');
    assert.deepEqual(collected.changedFiles.map((file) => file.path), ['source.txt']);
    assert.equal(collected.checks[0].status, 'passed');
    assert.equal(collected.checkComparisons[0].relation, 'baseline-unknown');
    assert.match(formatCliOutput({ ...collectExecution, json: false, color: false }), /Checks:/);

    const handoffExecution = await runCli([
      'change', 'handoff', root, '--task', prepared.taskId, '--input', '-', '--json',
    ], { input: jsonStream(handoffDocument(
      prepared.taskContract.adoptionConditions[0].id,
      prepared.taskContract.adoptionConditions[0].evidenceObligations[0].id,
      collected.checks[0].definitionId,
    )) });
    const handedOff = handoffExecution.output as {
      status: string;
      decisionPacket: {
        semanticContract: { desiredOutcome: string };
        decision: { adoption: { status: string } };
      };
    };
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal(handedOff.decisionPacket.decision.adoption.status, 'pending');
    assert.equal(handedOff.decisionPacket.semanticContract.desiredOutcome, 'Change the CLI fixture.');
    assert.deepEqual(Object.keys(handedOff.decisionPacket), [
      'protocol', 'schemaVersion', 'authority', 'semanticContract', 'decision',
      'systemMeaning', 'conditions', 'attention', 'reviewQuestions', 'runtimeFacts',
      'evidenceJudgments', 'detailSections',
    ]);
    for (const removedDuplicate of [
      'contract', 'facts', 'handoff', 'evaluation', 'review', 'challenges', 'evidenceDispositions',
    ]) {
      assert.equal(removedDuplicate in handedOff.decisionPacket, false);
    }
    assert.equal('attention' in handedOff, false);
    const humanHandoff = formatCliOutput({ ...handoffExecution, json: false, color: false });
    assert.match(humanHandoff, /Decision state/);
    assert.match(humanHandoff, /Actual system meaning:/);
    assert.match(humanHandoff, /Human adoption: pending/);
    assert.match(humanHandoff, /Developer decision required:/);

    const decisionExecution = await runCli([
      'change', 'decide', root, '--task', prepared.taskId, '--input', '-', '--json',
    ], { input: jsonStream(decisionDocument()) });
    const decided = decisionExecution.output as {
      status: string; decisionStatus: string; externalEffects: Record<string, boolean>;
    };
    assert.equal(decided.status, 'decision-recorded');
    assert.equal(decided.decisionStatus, 'accepted');
    assert.ok(Object.values(decided.externalEffects).every((value) => value === false));

    const explained = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'events', '--json',
    ])).output as { events: Array<{ type: string }> };
    assert.deepEqual(explained.events.map((event) => event.type), [
      'task-prepared', 'facts-collected', 'handoff-evaluated', 'decision-recorded',
    ]);
    const explainExecution = await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'events',
    ]);
    assert.match(formatCliOutput(explainExecution), /Events:/);

    const index = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--json',
    ])).output as Record<string, unknown> & {
      section: string;
      availableSections: Array<{ name: string; available: boolean; count?: number }>;
      artifactIndex: { attempts: Array<{ attemptId: string; factCollectionId: string | null }> };
    };
    assert.equal(index.section, 'index');
    assert.equal(index.availableSections.find((item) => item.name === 'events')?.count, 4);
    assert.equal(index.artifactIndex.attempts.length, 1);
    for (const expanded of ['contract', 'plan', 'attempts', 'challenges', 'events']) {
      assert.equal(Object.hasOwn(index, expanded), false);
    }
    await assert.rejects(
      runCli(['change', 'explain', root, '--task', prepared.taskId, '--section', 'all', '--json']),
      /Invalid explain section/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unsupported input is rejected without migration or compatibility state', async () => {
  const root = createRepository();
  try {
    await assert.rejects(
      runCli(['change', 'prepare', root, '--input', '-', '--json'], {
        input: jsonStream({ ...prepareDocument(), schemaVersion: 'unsupported' }),
      }),
      (error: unknown) => {
        if (!error || typeof error !== 'object') return false;
        const candidate = error as {
          code?: string;
          inputCorrection?: {
            kind: string;
            submittedDocument: { schemaVersion?: string };
            issues: Array<{ path: string }>;
            stateWritten: boolean;
          };
        };
        assert.equal(candidate.inputCorrection?.kind, 'correct-protocol-input');
        assert.equal(candidate.inputCorrection?.submittedDocument.schemaVersion, 'unsupported');
        assert.equal(candidate.inputCorrection?.issues[0].path, 'schemaVersion');
        assert.equal(candidate.inputCorrection?.stateWritten, false);
        return candidate.code === 'INVALID_INPUT';
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-cli-initial-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'initial']);
  return root;
}

function prepareDocument() {
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1',
    prepareRequestId: 'prepare:cli-test',
    developerEvents: [{ key: 'request', content: 'Change the CLI fixture.' }],
    repositoryEvidence: [],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change the CLI fixture.',
      constraints: ['Keep Human adoption explicit.'], nonGoals: [], focus: ['source.txt'],
    },
    materialDecisionForks: [],
    conditions: [{
      key: 'test', statement: 'The fixture check passes.',
      rationale: 'Failure changes adoption.', criticality: 'material',
      evidenceObligations: [{
        key: 'check-result',
        statement: 'The fixture behavior is exercised by the frozen check.',
        falsification: {
          failureHypothesis: 'The frozen check could miss the changed fixture behavior.',
          scenario: 'Change the fixture and run the frozen command.',
          supportingObservation: 'The command observes the changed fixture behavior.',
          contradictingObservation: 'The command passes without observing the changed fixture behavior.',
        },
        strategies: [{
          kind: 'runtime-check', checkKeys: ['test'],
        }],
      }],
    }],
    hostPolicyRequirements: [],
    delivery: { maxRepairAttempts: 1 },
    checks: [{
      key: 'test', rationale: 'Exercise the fixture.',
      argv: [process.execPath, '-e', 'process.exit(0)'], baseline: { mode: 'unknown' },
      verifierSelectors: [],
    }],
  };
}

function handoffDocument(conditionId: string, obligationId: string, definitionId: string) {
  return {
    summary: 'The CLI fixture changed.',
    obligationConclusions: [{
      obligationId, status: 'supported',
      evidence: [{ kind: 'check', id: definitionId }],
      falsification: {
        attempt: 'Checked whether the frozen command misses the changed fixture path.',
        observedResult: 'The frozen command completed against the current fixture.',
      },
      counterEvidence: [], conclusion: 'The bounded observation supports the obligation.',
    }],
    conditionConclusions: [{
      conditionId, status: 'supported', summary: 'The check passed.',
    }],
    importantSystemEffects: ['Fixture behavior changed.'],
    residualUnknowns: [], reviewQuestions: [],
    recommendation: { action: 'accept', rationale: 'Evidence is current.', caveats: [] },
  };
}

function decisionDocument() {
  return {
    humanEvent: { content: 'Accept this CLI fixture.' },
    action: 'accepted', reason: 'The reviewed packet is acceptable.', exceptions: [],
  };
}

function jsonStream(value: unknown): Readable {
  return Readable.from([JSON.stringify(value)]);
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}
