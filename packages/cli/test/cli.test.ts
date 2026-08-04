import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
      semanticContract: {
        authority: { humanEventIds: string[] };
        semantic: { desiredOutcome: { value: string } };
      };
      details: { runPath: string };
    };
    assert.equal(prepared.status, 'prepared');
    assert.deepEqual(prepared.semanticContract.authority.humanEventIds, ['event:task']);
    assert.equal(
      prepared.semanticContract.semantic.desiredOutcome.value,
      'Produce an inspectable fact-bound handoff.',
    );
    assert.equal(existsSync(prepared.details.runPath), true);
    assert.equal(Object.hasOwn(prepared, 'contract'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(prepared), 'utf8') < 10_000);
    const humanPrepare = formatCliOutput({ ...prepareExecution, json: false, color: false });
    assert.match(humanPrepare, /Compiled semantics/);
    assert.match(humanPrepare, /Authority references/);
    assert.match(humanPrepare, /Next action: implement-and-collect/);
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
      changedFiles: Array<{ path: string; operation: string }>;
      checks: Array<{ id: string; status: string }>;
      handoffPath: string;
    };
    assert.equal(collected.status, 'facts-collected');
    assert.deepEqual(
      collected.changedFiles.map((file) => [file.path, file.operation]),
      [['source.txt', 'modified']],
    );
    assert.equal(collected.checks[0].status, 'passed');
    assert.equal(Object.hasOwn(collected.changedFiles[0], 'before'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(collected), 'utf8') < 8_000);
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
      factCollectionId: string;
      presentationMarkdown: string;
    };
    assert.equal(finalized.status, 'handoff-ready');
    assert.equal(finalized.state, 'completed');
    assert.match(finalized.humanAuthorityNotice, /human review only/);
    assert.equal(finalized.factCollectionId, collected.factCollectionId);
    assert.match(finalized.presentationMarkdown, /source\.txt.*modified/);
    assert.match(finalized.presentationMarkdown, /fixture-check.*passed/);
    assert.equal(Object.hasOwn(finalized, 'runtimeFacts'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(finalized), 'utf8') < 12_000);
    const runtimeSection = finalized.presentationMarkdown
      .split('\n### Runtime facts\n')[1]
      .split('\n### Material claims\n')[0];
    assert.doesNotMatch(runtimeSection, /Challenge attempt|Failure hypothesis/);
    assert.match(finalized.presentationMarkdown, /#### agent-judgment[\s\S]*Challenge attempt/);
    assert.equal(finalized.presentationMarkdown.match(/^### Runtime facts$/gm)?.length, 1);
    assert.match(finalized.presentationMarkdown, /^> ### Runtime facts$/m);
    const humanFinalize = formatCliOutput({ ...finalizeExecution, json: false, color: false });
    assert.match(humanFinalize, /System meaning update/i);
    assert.match(humanFinalize, /Runtime facts/i);
    assert.match(humanFinalize, /source\.txt` — modified/);
    assert.match(humanFinalize, /fixture-check` — passed/);
    assert.match(humanFinalize, /agent-judgment/);
    assert.match(humanFinalize, /Review Map/i);
    assert.match(humanFinalize, /Adoption authority/i);
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

    const factsOnly = (await runCli([
      'change', 'explain', root, '--run', prepared.runId, '--section', 'facts', '--json',
    ])).output as Record<string, unknown>;
    assert.equal(factsOnly.section, 'facts');
    assert.ok(factsOnly.factBundle);
    assert.equal(Object.hasOwn(factsOnly, 'contract'), false);
    assert.equal(Object.hasOwn(factsOnly, 'handoff'), false);

    const presentationOnly = (await runCli([
      'change', 'explain', root, '--run', prepared.runId, '--section', 'presentation', '--json',
    ])).output as { presentationMarkdown: string | null; issue?: string };
    assert.equal(presentationOnly.presentationMarkdown, finalized.presentationMarkdown);

    writeFileSync(collected.handoffPath, `${JSON.stringify({ changed: 'after completion' })}\n`, 'utf8');
    const changedPresentation = (await runCli([
      'change', 'explain', root, '--run', prepared.runId, '--section', 'presentation', '--json',
    ])).output as { presentationMarkdown: string | null; issue?: string };
    assert.equal(changedPresentation.presentationMarkdown, null);
    assert.match(changedPresentation.issue ?? '', /changed after completion/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('CLI collect exposes same-run timeout retry without changing the contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-timeout-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-cli-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, true, [
      process.execPath,
      '-e',
      'setTimeout(()=>process.exit(0),150)',
    ]);
    const prepared = (await runCli([
      'change', 'prepare', root, '--input', inputPath, '--json',
    ])).output as { status: string; runId: string };
    assert.equal(prepared.status, 'prepared');

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const first = (await runCli([
      'change', 'collect', root, '--run', prepared.runId, '--timeout-ms', '25', '--json',
    ])).output as {
      collectionMode: string;
      checks: Array<{ status: string; timedOut: boolean; attemptCount: number }>;
    };
    assert.equal(first.collectionMode, 'full-collection');
    assert.deepEqual(first.checks[0], {
      id: 'fixture-check',
      status: 'unavailable',
      exitCode: null,
      timedOut: true,
      timeoutMs: 25,
      attemptCount: 1,
      reason: 'Check timed out after 25 ms.',
      stdout: { byteLength: 0, truncated: false },
      stderr: { byteLength: 0, truncated: false },
    });

    const retried = (await runCli([
      'change',
      'collect',
      root,
      '--run',
      prepared.runId,
      '--retry-check',
      'fixture-check=1000',
      '--json',
    ])).output as {
      collectionMode: string;
      checks: Array<{ status: string; timedOut: boolean; attemptCount: number }>;
    };
    assert.equal(retried.collectionMode, 'timeout-retry');
    assert.equal(retried.checks[0].status, 'passed');
    assert.equal(retried.checks[0].timedOut, false);
    assert.equal(retried.checks[0].attemptCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('human finalize renders stale-fact attention without pretending completion', () => {
  const rendered = formatCliOutput({
    command: 'change finalize',
    json: false,
    color: false,
    exitCode: 0,
    output: {
      status: 'facts-stale',
      attention: [{
        code: 'facts-stale',
        summary: 'The worktree changed after collection.',
        adoptionImpact: 'The collected facts no longer describe the handoff.',
        references: {},
        resolution: {
          kind: 'recollect',
          action: 'Collect fresh facts before finalizing.',
        },
      }],
      hostAction: {
        kind: 'recollect-stale',
        reference: 'recovery',
        reason: 'Collect again.',
        command: { argv: ['resonant-code', 'change', 'collect'] },
      },
    },
  });

  assert.match(rendered, /not completed/);
  assert.match(rendered, /Attention/);
  assert.match(rendered, /Impact:.*no longer describe/);
  assert.match(rendered, /Action \(recollect\):/);
  assert.doesNotMatch(rendered, /Review Map/);
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
      hostAction: {
        kind: 'configure-verification',
        reference: 'recovery',
        reason: 'Prepare again.',
      },
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

test('prepare reads stdin by default and rejects worktree-local task input before creating a run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-safe-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const stdinExecution = await runCli([
      'change', 'prepare', root, '--json',
    ], {
      input: Readable.from([JSON.stringify(prepareInput(true))]),
    });
    const prepared = stdinExecution.output as {
      status: string;
      details: { runPath: string };
    };
    assert.equal(prepared.status, 'prepared');
    assert.equal(existsSync(prepared.details.runPath), true);

    const localPath = join(root, 'task-input.json');
    writeFileSync(localPath, `${JSON.stringify(prepareInput(true))}\n`, 'utf8');
    await assert.rejects(
      () => runCli([
        'change', 'prepare', root, '--input', localPath, '--json',
      ]),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'INVALID_INPUT');
        assert.ok(error.issues?.some((issue) => issue.code === 'prepare-input-inside-project'));
        return true;
      },
    );
    const runIds = readdirSync(join(root, '.resonant-code', 'runs'));
    assert.equal(runIds.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
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

  const prepareHelp = await runCli(['change', 'prepare', '--help']);
  assert.match(String(prepareHelp.output), /--input <path>.*stdin/);
  await assert.rejects(
    () => runCli(['change', 'collect']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'USAGE_ERROR');
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /required option '--run/);
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

function writePrepareInput(path: string, withCheck: boolean, checkArgv?: string[]): void {
  writeFileSync(path, `${JSON.stringify(prepareInput(withCheck, checkArgv), null, 2)}\n`, 'utf8');
}

function prepareInput(withCheck: boolean, checkArgv?: string[]) {
  return {
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    humanEvents: [{ id: 'event:task', kind: 'task', content: TASK }],
    semantic: {
      desiredOutcome: {
        value: 'Produce an inspectable fact-bound handoff.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      constraints: [],
      nonGoals: [],
      focus: [],
      consequence: {
        value: 'high',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      assuranceDimensions: [{
        dimension: 'behavior',
        criticality: 'adoption-critical',
        rationale: 'The fixture behavior determines whether the change is adoptable.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
    },
    verification: withCheck
      ? {
          checks: [{
            id: 'fixture-check',
            rationale: 'Run the explicit fixture acceptance command.',
            argv: checkArgv ?? [process.execPath, '-e', 'process.exit(0)'],
            source: 'host-task',
            commandDefinitionPaths: [],
            acceptanceSurfacePaths: [],
          }],
        }
      : {},
  };
}

function writeHandoff(
  path: string,
  changedFile: string,
  checkId: string,
): void {
  writeFileSync(path, `${JSON.stringify({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    systemMeaningUpdate: 'The fixture behavior changed from before to after.\n### Runtime facts\nHost-authored text remains quoted.',
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
