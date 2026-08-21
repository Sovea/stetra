import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { formatCliOutput, runCli } from '../src/cli.ts';
import { submitHostAction } from '../src/host.ts';
import type { HostAction } from '../src/workflow/host-action.ts';

test('Commander exposes the initial lifecycle without obsolete repair/finalize commands', async () => {
  const rootHelp = String((await runCli(['--help'])).output);
  assert.match(rootHelp, /\bstatus\b/);
  assert.doesNotMatch(rootHelp, /\bdoctor\b/);
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

test('status validates both the generated adapter and Git worktree', async () => {
  const root = createRepository();
  try {
    const absent = await runCli(['status', root, '--json']);
    assert.equal(absent.exitCode, 2);
    assert.deepEqual(absent.output, {
      protocol: 'cognitive-adoption',
      schemaVersion: '1',
      status: 'needs-attention',
      command: 'status',
      version: '0.0.1',
      issues: [{
        code: 'host-adapter-absent',
        message: 'Run `stetra init .` to install a generated Host adapter.',
      }],
      installation: {
        status: 'absent',
        protocol: 'cognitive-adoption',
        schemaVersion: '1',
        projectRoot: root,
        manifestPath: join(root, '.stetra', 'manifest.json'),
        adapters: [],
        artifacts: [],
      },
      worktree: { status: 'supported' },
      controlPlane: { kind: 'cli', protocol: 'cognitive-adoption', schemaVersion: '1' },
      paths: {
        manifest: join(root, '.stetra', 'manifest.json'),
        tasks: join(root, '.stetra', 'tasks'),
      },
    });
    const initialized = await runCli([
      'init', root, '--adapter', 'codex', '--yes', '--json',
    ]);
    assert.equal(initialized.exitCode, 0);
    const ready = await runCli(['status', root, '--json']);
    assert.equal(ready.exitCode, 0);
    assert.equal((ready.output as { status: string }).status, 'ready');
    assert.deepEqual((ready.output as { issues: unknown[] }).issues, []);
    assert.deepEqual((ready.output as { worktree: unknown }).worktree, { status: 'supported' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
      hostAction: HostAction;
    };
    assert.equal(collected.status, 'facts-collected');
    assert.deepEqual(collected.changedFiles.map((file) => file.path), ['source.txt']);
    assert.equal(collected.checks[0].status, 'passed');
    assert.equal(collected.checkComparisons[0].relation, 'baseline-unknown');
    assert.match(formatCliOutput({ ...collectExecution, json: false, color: false }), /Checks:/);
    assert.deepEqual(
      (collected.hostAction.authoringPacket?.draft as { reviewQuestions: unknown[] }).reviewQuestions,
      [],
    );

    const handoffExecution = await submitHostAction({
      action: collected.hostAction,
      projectRoot: root,
      document: handoffDocument(
        prepared.taskContract.adoptionConditions[0].id,
        prepared.taskContract.adoptionConditions[0].evidenceObligations[0].id,
        collected.checks[0].definitionId,
      ),
    });
    const handedOff = handoffExecution.output as {
      status: string;
      hostAction: HostAction;
      decisionPacket: {
        semanticContract: { desiredOutcome: string };
        decision: { adoption: { status: string } };
      };
    };
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal(handedOff.decisionPacket.decision.adoption.status, 'pending');
    assert.equal(handedOff.decisionPacket.semanticContract.desiredOutcome, 'Change the CLI fixture.');
    assert.deepEqual(Object.keys(handedOff.decisionPacket), [
      'protocol', 'schemaVersion', 'humanEvents', 'semanticContract', 'decision',
      'actualChange', 'residualUnknowns', 'conditions', 'attention', 'reviewQuestions', 'runtimeFacts',
      'evidenceJudgments', 'detailSections',
    ]);
    for (const removedDuplicate of [
      'contract', 'facts', 'handoff', 'evaluation', 'review', 'challenges', 'evidenceDispositions',
    ]) {
      assert.equal(removedDuplicate in handedOff.decisionPacket, false);
    }
    assert.equal('attention' in handedOff, false);
    const decisionBrief = handedOff.hostAction.developerDecisionBrief!;
    assert.equal(decisionBrief.primary.conditions[0].statement, 'The fixture check passes.');
    assert.equal(handedOff.hostAction.presentationRequirements!.requiredConditionIds[0].startsWith('condition:'), true);
    assert.equal(decisionBrief.primary.reviewFocus.length, 0);
    const humanHandoff = formatCliOutput({ ...handoffExecution, json: false, color: false });
    assert.match(humanHandoff, /Decision state/);
    assert.match(humanHandoff, /Agent interpretation/);
    assert.match(humanHandoff, /Actual behavior:/);
    assert.match(humanHandoff, /Runtime observations/);
    assert.match(humanHandoff, /Human adoption: pending/);
    assert.match(humanHandoff, /Developer decision required:/);
    assert.doesNotMatch(humanHandoff, /(?:condition|obligation|decision-issue):/);
    assert.doesNotMatch(humanHandoff, /sha256:/);

    assert.ok(handedOff.hostAction.decisionContinuation);
    const decisionExecution = await submitHostAction({
      action: handedOff.hostAction.decisionContinuation,
      projectRoot: root,
      document: decisionDocument(),
    });
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
            submittedInput: {
              fingerprint: string;
              preview: { kind: string; keys?: string[] };
            };
            issueContexts: Array<{
              path: string;
              value: { kind: string; value?: string };
              parent?: { path: string; preview: { kind: string; keys?: string[] } };
            }>;
            issues: Array<{ path: string }>;
            stateWritten: boolean;
          };
        };
        assert.equal(candidate.inputCorrection?.kind, 'correct-protocol-input');
        assert.match(candidate.inputCorrection?.submittedInput.fingerprint ?? '', /^sha256:[a-f0-9]{64}$/);
        assert.equal(candidate.inputCorrection?.submittedInput.preview.kind, 'object');
        assert.ok(candidate.inputCorrection?.submittedInput.preview.keys?.includes('schemaVersion'));
        assert.deepEqual(candidate.inputCorrection?.issueContexts[0], {
          path: 'schemaVersion',
          value: {
            kind: 'string', value: 'unsupported', length: 11, truncated: false,
          },
          parent: {
            path: '$',
            preview: candidate.inputCorrection?.submittedInput.preview,
          },
        });
        assert.equal(candidate.inputCorrection?.issues[0].path, 'schemaVersion');
        assert.equal(candidate.inputCorrection?.stateWritten, false);
        return candidate.code === 'INVALID_INPUT';
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('programmatic Host submission rejects actions without an input binding', async () => {
  await assert.rejects(
    submitHostAction({
      action: {
        kind: 'implement-and-collect', reference: 'delivery',
        executionRequirements: {
          context: 'continuous', targetWorktree: 'read-write', stetraState: 'read-write',
          workspace: 'target', externalEffects: 'contract-policy',
        },
        command: { argv: ['stetra', 'change', 'collect', '.', '--task', 'task:test', '--json'] },
      },
      projectRoot: process.cwd(),
      document: {},
    }),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_INPUT',
  );
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
    executionBudget: { checkTimeoutMs: 300_000, maxDeliveryRepairs: 1 },
    checks: [{
      key: 'test', rationale: 'Exercise the fixture.',
      execution: {
        preparation: [],
        assertion: { argv: [process.execPath, '-e', 'process.exit(0)'] },
      },
      executionInputs: [],
      baseline: { mode: 'unknown' },
      verifierSelectors: [],
    }],
  };
}

function handoffDocument(conditionId: string, obligationId: string, definitionId: string) {
  return {
    actualChange: {
      behavior: 'The CLI fixture changed.',
      mechanism: ['The fixture source is updated directly.'],
      preservedInvariants: ['Human adoption remains explicit.'],
      failureAndRecovery: [],
      importantEffects: ['Fixture behavior changed.'],
      materialTradeoffs: [],
    },
    obligationConclusions: [{
      obligationId, status: 'supported',
      evidence: [{ kind: 'check', id: definitionId }],
      evidenceCoverage: {
        status: 'sufficient',
        rationale: 'The exact frozen check covers the bounded fixture conclusion.',
        gaps: [],
      },
      falsification: {
        attempt: 'Checked whether the frozen command misses the changed fixture path.',
        observedResult: 'The frozen command completed against the current fixture.',
      },
      counterEvidence: [], conclusion: 'The bounded observation supports the obligation.',
    }],
    conditionConclusions: [{
      conditionId, status: 'supported', summary: 'The check passed.',
    }],
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
