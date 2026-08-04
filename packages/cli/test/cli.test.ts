import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { formatCliOutput, runCli } from '../src/cli.ts';
import { CliError } from '../src/errors.ts';

test('CLI exposes the complete prepare, collect, finalize, and explain lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-lifecycle-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-cli-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, true);

    const prepareExecution = await runCli([
      'change',
      'prepare',
      root,
      '--input',
      inputPath,
      '--json',
    ]);
    const prepared = prepareExecution.output as {
      status: string;
      runId: string;
      runPath: string;
      contract: { authority: { humanEvents: Array<{ content: string }> } };
    };
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.contract.authority.humanEvents[0].content, TASK);
    assert.equal(existsSync(prepared.runPath), true);
    const humanPrepare = formatCliOutput({ ...prepareExecution, json: false, color: false });
    assert.match(humanPrepare, /Exact Human Events/);
    assert.match(humanPrepare, /Agent interpretations/);
    assert.match(humanPrepare, /Delegation boundary/);
    assert.match(humanPrepare, /Frozen verification/);

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collectExecution = await runCli([
      'change',
      'collect',
      root,
      '--run',
      prepared.runId,
      '--json',
    ]);
    const collected = collectExecution.output as {
      status: string;
      factCollectionId: string;
      changedFiles: Array<{ id: string; path: string; operation: string }>;
      checks: Array<{ id: string; status: string }>;
      handoffPath: string;
    };
    assert.equal(collected.status, 'facts-collected');
    assert.deepEqual(
      collected.changedFiles.map((file) => [file.path, file.operation]),
      [['source.txt', 'modified']],
    );
    assert.equal(collected.checks[0].status, 'passed');
    const humanCollect = formatCliOutput({ ...collectExecution, json: false, color: false });
    assert.match(humanCollect, /Actual change collected/);
    assert.match(humanCollect, /Changed files: 1/);
    assert.match(humanCollect, /Checks: 1/);

    writeHandoff(
      collected.handoffPath,
      collected.changedFiles[0].path,
      'fixture-check',
    );
    const finalizeExecution = await runCli([
      'change',
      'finalize',
      root,
      '--run',
      prepared.runId,
      '--json',
    ]);
    const finalized = finalizeExecution.output as {
      status: string;
      state: string;
      humanAuthorityNotice: string;
      runtimeFacts: {
        factCollectionId: string;
        changedFiles: Array<{ path: string; operation: string }>;
        checks: Array<{ id: string; status: string }>;
      };
    };
    assert.equal(finalized.status, 'handoff-ready');
    assert.equal(finalized.state, 'completed');
    assert.match(finalized.humanAuthorityNotice, /human review only/);
    assert.equal(finalized.runtimeFacts.factCollectionId, collected.factCollectionId);
    assert.deepEqual(
      finalized.runtimeFacts.changedFiles.map((file) => [file.path, file.operation]),
      [['source.txt', 'modified']],
    );
    assert.deepEqual(
      finalized.runtimeFacts.checks.map((check) => [check.id, check.status]),
      [['fixture-check', 'passed']],
    );
    const humanFinalize = formatCliOutput({ ...finalizeExecution, json: false, color: false });
    assert.match(humanFinalize, /System meaning update/);
    assert.match(humanFinalize, /Runtime facts/);
    assert.match(humanFinalize, /source\.txt — modified/);
    assert.match(humanFinalize, /fixture-check — passed/);
    assert.match(humanFinalize, /agent-judgment/);
    assert.match(humanFinalize, /Review Map/);
    assert.match(humanFinalize, /Adoption authority/);
    assert.doesNotMatch(humanFinalize, /ready for adoption/i);

    const explainExecution = await runCli([
      'change',
      'explain',
      root,
      '--run',
      prepared.runId,
      '--json',
    ]);
    const explained = explainExecution.output as {
      state: string;
      contract: unknown;
      factBundle: unknown;
      handoff: unknown;
      evaluation: { status: string };
    };
    assert.equal(explained.state, 'completed');
    assert.ok(explained.contract);
    assert.ok(explained.factBundle);
    assert.ok(explained.handoff);
    assert.equal(explained.evaluation.status, 'handoff-ready');
    const humanExplain = formatCliOutput({ ...explainExecution, json: false, color: false });
    assert.match(humanExplain, /Use --json for exact Human Events/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('human finalize keeps actionable attention distinct from the Review Map', () => {
  const rendered = formatCliOutput({
    command: 'change finalize',
    json: false,
    color: false,
    exitCode: 0,
    output: {
      status: 'needs-attention',
      systemMeaningUpdate: 'The implementation changed the verification boundary.',
      runtimeFacts: {
        factCollectionId: 'sha256:fixture',
        changedFiles: [{ path: 'package.json', operation: 'modified', representation: 'text' }],
        checks: [{ id: 'test', status: 'passed' }],
        verifierMutations: [{
          checkId: 'test',
          path: 'package.json',
          role: 'command-definition',
        }],
        patch: { byteLength: 42, digest: 'sha256:patch' },
      },
      materialClaims: [],
      residualUnknowns: [],
      attention: [{
        code: 'verifier-surface-changed',
        summary: 'Verification definition package.json changed for check test.',
        adoptionImpact: 'The check is not independent of the implementation.',
        references: { changedFiles: ['package.json'], checks: ['test'] },
        resolution: {
          kind: 'direct-review',
          action: 'Review the verifier change and seek independent evidence.',
        },
      }],
      reviewMap: [{
        priority: 'must-read',
        changedFiles: ['package.json'],
        checkIds: ['test'],
        claimIds: [],
        unknownIds: [],
        rationale: 'The acceptance surface changed.',
        prevents: 'Trusting a self-modified verifier.',
      }],
      nextStep: 'Resolve the disclosed attention.',
    },
  });

  assert.match(rendered, /Runtime facts/);
  assert.match(rendered, /Attention/);
  assert.match(rendered, /Impact:.*not independent/);
  assert.match(rendered, /Inspect:.*package\.json.*test/);
  assert.match(rendered, /Action \(direct-review\):/);
  assert.match(rendered, /Review Map/);
  assert.ok(rendered.indexOf('Attention') < rendered.indexOf('Review Map'));
});

test('human prepare presents executable preflight as an actionable preparation issue', () => {
  const rendered = formatCliOutput({
    command: 'change prepare',
    json: false,
    color: false,
    exitCode: 0,
    output: {
      status: 'verification-required',
      issues: [{
        path: 'verification.checks[0].argv[0]',
        message: 'Check test cannot resolve executable "missing".',
        remediation: 'Restore the executable or select a runnable explicit check.',
      }],
      nextStep: 'Prepare again.',
    },
  });

  assert.match(rendered, /Preparation issues/);
  assert.match(rendered, /verification\.checks\[0\]\.argv\[0\]/);
  assert.match(rendered, /Action:.*Restore the executable/);
  assert.doesNotMatch(rendered, /Authority issues/);
});

test('CLI non-runnable outcomes write no run and JSON mode stays prompt- and ANSI-free', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-no-run-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-cli-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, false);
    const execution = await runCli([
      'change',
      'prepare',
      root,
      '--input',
      inputPath,
      '--json',
    ], {
      interactive: true,
      color: true,
    });
    assert.equal((execution.output as { status: string }).status, 'verification-required');
    assert.equal(execution.exitCode, 0);
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);
    const rendered = formatCliOutput(execution);
    assert.deepEqual(JSON.parse(rendered), execution.output);
    assert.doesNotMatch(rendered, /\u001B\[/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('CLI finalize reports facts-stale before parsing the Host handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-stale-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-cli-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, true);
    const prepared = (await runCli([
      'change', 'prepare', root, '--input', inputPath, '--json',
    ])).output as { runId: string };
    writeFileSync(join(root, 'source.txt'), 'first\n', 'utf8');
    const collected = (await runCli([
      'change', 'collect', root, '--run', prepared.runId, '--json',
    ])).output as { handoffPath: string };
    writeFileSync(collected.handoffPath, '{not valid JSON', 'utf8');
    writeFileSync(join(root, 'source.txt'), 'repair\n', 'utf8');
    const finalized = await runCli([
      'change', 'finalize', root, '--run', prepared.runId, '--json',
    ]);
    assert.equal((finalized.output as { status: string }).status, 'facts-stale');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('Commander exposes only the new change lifecycle and classifies usage errors', async () => {
  const help = await runCli(['change', '--help']);
  assert.match(String(help.output), /prepare/);
  assert.match(String(help.output), /collect/);
  assert.match(String(help.output), /finalize/);
  assert.match(String(help.output), /explain/);
  assert.doesNotMatch(String(help.output), /\n\s+complete\s/);

  await assert.rejects(
    () => runCli(['change', 'prepare']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'USAGE_ERROR');
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /required option '--input/);
      return true;
    },
  );
  await assert.rejects(
    () => runCli(['change', 'complete']),
    /unknown command 'complete'/i,
  );
  await assert.rejects(() => runCli(['bootstrap']), /unknown command 'bootstrap'/i);
  await assert.rejects(() => runCli(['context']), /unknown command 'context'/i);
});

test('status and strict doctor report only adapter, legacy, and Git readiness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-status-'));
  try {
    const absent = await runCli(['status', root, '--json']);
    assert.equal((absent.output as {
      readiness: { required: Array<{ code: string }> };
    }).readiness.required[0].code, 'host-adapter-absent');

    await runCli(['init', root, '--adapter', 'codex', '--json']);
    initializeRepository(root);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initialized']);
    const doctor = await runCli(['doctor', root, '--strict', '--json']);
    assert.equal(doctor.exitCode, 0);
    assert.equal((doctor.output as { status: string }).status, 'ok');
    assert.equal((doctor.output as { worktree: string }).worktree, 'supported');
    assert.deepEqual((doctor.output as {
      readiness: { required: unknown[] };
    }).readiness.required, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('change prepare reports legacy artifacts without mutating them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-legacy-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-cli-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    const legacyRoot = join(root, '.resonant-code', 'playbook');
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, 'local-augment.yaml'), 'legacy\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'legacy']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, true);
    await assert.rejects(
      () => runCli(['change', 'prepare', root, '--input', inputPath, '--json']),
      /Archive or remove.*\.resonant-code\/playbook/i,
    );
    assert.equal(readFileSync(join(legacyRoot, 'local-augment.yaml'), 'utf8'), 'legacy\n');
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

const TASK = 'Implement the Semantic Handoff change without legacy compatibility.';

function writePrepareInput(path: string, withCheck: boolean): void {
  writeFileSync(path, `${JSON.stringify({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    humanEvents: [{ id: 'event:task', kind: 'task', content: TASK }],
    interpretations: [
      {
        id: 'meaning:outcome',
        field: 'desired-outcome',
        value: 'Produce an inspectable fact-bound handoff.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      {
        id: 'meaning:consequence',
        field: 'consequence',
        value: 'high',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
    ],
    semantic: {
      desiredOutcomeId: 'meaning:outcome',
      constraintIds: [],
      nonGoalIds: [],
      focusIds: [],
      consequenceId: 'meaning:consequence',
    },
    verification: withCheck
      ? {
          checks: [{
            id: 'fixture-check',
            rationale: 'Run the explicit fixture acceptance command.',
            argv: [process.execPath, '-e', 'process.exit(0)'],
            timeoutMs: 10_000,
            source: 'host-task',
            verifierRefs: [],
          }],
        }
      : {},
  }, null, 2)}\n`, 'utf8');
}

function writeHandoff(
  path: string,
  changedFile: string,
  checkId: string,
): void {
  writeFileSync(path, `${JSON.stringify({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    systemMeaningUpdate: 'The fixture behavior changed from before to after.',
    materialClaims: [{
      id: 'claim:behavior',
      dimension: 'behavior',
      statement: 'The fixture now exposes the requested after behavior.',
      adoptionConsequence: 'Adoption replaces the prior fixture behavior.',
      adoptionCritical: true,
      basis: 'agent-judgment',
      evidence: { changedFiles: [changedFile], checks: [checkId] },
      falsification: {
        failureHypothesis: 'The fixture could still expose the prior behavior.',
        attempt: 'Inspected the complete patch and executed the frozen check.',
        status: 'supported',
        supportingEvidence: { changedFiles: [changedFile], checks: [checkId] },
        counterEvidence: {},
        conclusion: 'No counterevidence was found within the complete collected boundary.',
      },
    }],
    residualUnknowns: [],
    reviewMap: [{
      id: 'review:source',
      priority: 'must-read',
      changedFiles: [changedFile],
      checkIds: [checkId],
      claimIds: ['claim:behavior'],
      unknownIds: [],
      rationale: 'The source file owns the behavior change.',
      prevents: 'Adopting an unintended behavior change.',
    }],
  }, null, 2)}\n`, 'utf8');
}

function initializeRepository(root: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'cli@example.invalid']);
  git(root, ['config', 'user.name', 'CLI Test']);
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}
