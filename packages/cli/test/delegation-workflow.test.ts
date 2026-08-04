import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { runFrozenChecks } from '../src/facts/checks.ts';
import { sha256 } from '../src/protocol.ts';
import type { CognitiveHandoffDocument } from '../src/schemas/delegation.ts';
import {
  collectDelegationFacts,
  explainDelegationRun,
  finalizeDelegationHandoff,
  prepareDelegationTask,
} from '../src/workflow/delegation.ts';

const VERSION = '0.0.1-test';

test('worktree snapshots keep Git objects task-scoped and tolerate read-only metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-readonly-git-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  let restoreGitPermissions: (() => void) | undefined;
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'committed\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    writeFileSync(join(root, 'source.txt'), 'dirty baseline\n', 'utf8');
    writeFileSync(join(root, 'untracked.txt'), 'baseline untracked\n', 'utf8');
    const gitDirectory = gitOutput(root, ['rev-parse', '--absolute-git-dir']);
    const objectDirectory = join(gitDirectory, 'objects');
    const originalObjects = directoryContentFingerprint(objectDirectory);
    restoreGitPermissions = makeTreeReadOnly(gitDirectory);

    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath,
      productVersion: VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    const runDirectory = dirname(prepared.details.runPath);
    assert.equal(existsSync(join(runDirectory, 'worktree-objects')), true);
    assert.equal(directoryContentFingerprint(objectDirectory), originalObjects);

    writeFileSync(join(root, 'source.txt'), 'implemented\n', 'utf8');
    const collected = await collectDelegationFacts({
      projectRoot: root,
      runId: prepared.runId,
      productVersion: VERSION,
    });
    assert.equal(collected.changedFiles[0].path, 'source.txt');
    assert.equal(directoryContentFingerprint(objectDirectory), originalObjects);
    writeValidHandoff(
      collected.handoffPath,
      collected.changedFiles[0].path,
    );
    const finalized = await finalizeDelegationHandoff({
      projectRoot: root,
      runId: prepared.runId,
    });
    assert.equal(finalized.status, 'handoff-ready');
    assert.equal(existsSync(join(runDirectory, 'worktree-objects')), false);
    assert.equal(directoryContentFingerprint(objectDirectory), originalObjects);
  } finally {
    restoreGitPermissions?.();
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('routine assurance completes with system meaning and Runtime facts only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-routine-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      routine: true,
      noCommandRationale: 'The isolated text fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath,
      productVersion: VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    assert.equal(prepared.semanticContract.assurancePlan.profile, 'routine');
    assert.deepEqual(prepared.semanticContract.assurancePlan.requirements, []);

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collectDelegationFacts({
      projectRoot: root,
      runId: prepared.runId,
      productVersion: VERSION,
    });
    assert.equal(collected.assurancePlan.profile, 'routine');
    writeFileSync(collected.handoffPath, `${JSON.stringify({
      protocol: 'semantic-delegation',
      schemaVersion: '1',
      systemMeaningUpdate: 'The bounded text fixture now contains the requested after state.',
      materialClaims: [],
      residualUnknowns: [],
      reviewMap: [],
    }, null, 2)}\n`, 'utf8');

    const finalized = await finalizeDelegationHandoff({
      projectRoot: root,
      runId: prepared.runId,
    });
    assert.equal(finalized.status, 'handoff-ready');
    assert.deepEqual(finalized.attention, []);
    if (typeof finalized.presentationMarkdown !== 'string') {
      assert.fail('routine finalization must include the rendered handoff');
    }
    assert.match(finalized.presentationMarkdown, /Assurance: `routine`/);
    assert.match(finalized.presentationMarkdown, /None required or disclosed/);
    assert.match(finalized.presentationMarkdown, /source\.txt.*modified/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('prepare and collect bind dirty-baseline changes, checks, patch, and verifier mutations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-delegation-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    writeFileSync(join(root, 'src', 'modified.txt'), 'committed\n', 'utf8');
    writeFileSync(join(root, 'src', 'deleted.txt'), 'delete me\n', 'utf8');
    writeFileSync(join(root, 'src', 'renamed.txt'), 'rename me\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    writeFileSync(join(root, 'src', 'modified.txt'), 'dirty baseline\n', 'utf8');
    writeFileSync(join(root, 'src', 'preexisting.txt'), 'preexisting untracked\n', 'utf8');

    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      repositoryEvidence: [{
        id: 'evidence:package',
        path: 'package.json',
        startLine: 1,
        endLine: 1,
      }],
      checks: [{
        id: 'fixture-check',
        rationale: 'Exercise the explicit fixture command.',
        argv: [process.execPath, '-e', 'process.stdout.write("checked")'],
        source: 'host-task',
        commandDefinitionPaths: ['package.json'],
        acceptanceSurfacePaths: [],
      }],
    });
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath,
      productVersion: VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    assert.equal(prepared.semanticContract.humanEvents[0].contentFingerprint, sha256(TASK));
    assert.equal(prepared.semanticContract.assurancePlan.profile, 'critical');
    assert.match(prepared.semanticContract.repositoryEvidence[0].digest, /^sha256:/);
    assert.equal(Object.hasOwn(prepared, 'contract'), false);
    assert.equal(existsSync(join(dirname(prepared.details.runPath), 'handoff.json')), false);
    const preparedRun = JSON.parse(readFileSync(prepared.details.runPath, 'utf8'));
    assert.equal(preparedRun.state, 'prepared');
    assert.equal(preparedRun.contract.repositoryEvidence[0].text, '{"name":"fixture"}\n');
    assert.ok(preparedRun.worktreeBaseline.entries.some(
      (entry: { path: string }) => entry.path === 'src/preexisting.txt',
    ));

    writeFileSync(join(root, 'src', 'modified.txt'), 'implemented\n', 'utf8');
    rmSync(join(root, 'src', 'deleted.txt'));
    renameSync(join(root, 'src', 'renamed.txt'), join(root, 'src', 'moved.txt'));
    writeFileSync(join(root, 'src', 'added.txt'), 'new text\n', 'utf8');
    writeFileSync(join(root, 'src', 'binary.bin'), Buffer.from([0, 1, 2, 3, 255]));
    symlinkSync('added.txt', join(root, 'src', 'link.txt'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture","changed":true}\n', 'utf8');

    const collected = await collectDelegationFacts({
      projectRoot: root,
      runId: prepared.runId,
      productVersion: VERSION,
    });
    assert.equal(collected.status, 'facts-collected');
    assert.equal(collected.assurancePlan.profile, 'critical');
    assert.match(collected.factCollectionId, /^sha256:[a-f0-9]{64}$/);
    assert.equal(collected.checks[0].status, 'passed');
    assert.equal(Object.hasOwn(collected.checks[0], 'definitionFingerprint'), false);
    assert.ok(collected.checks[0].stdout.logPath);
    assert.equal(collected.verifierSurfaces.length, 1);
    assert.equal(collected.verifierSurfaces[0].path, 'package.json');
    assert.equal(collected.verifierSurfaces[0].role, 'command-definition');
    assert.deepEqual(collected.verifierSurfaces[0].checkIds, ['fixture-check']);
    assert.equal(existsSync(collected.handoffPath), true);
    assert.equal(existsSync(join(dirname(prepared.details.runPath), 'change.patch')), true);
    const operations = new Map(collected.changedFiles.map((file) => [file.path, file]));
    assert.equal(operations.get('src/modified.txt')?.operation, 'modified');
    assert.equal(Object.hasOwn(operations.get('src/modified.txt') ?? {}, 'before'), false);
    assert.equal(operations.get('src/deleted.txt')?.operation, 'deleted');
    assert.equal(operations.get('src/moved.txt')?.operation, 'renamed');
    assert.equal(operations.get('src/moved.txt')?.previousPath, 'src/renamed.txt');
    assert.equal(operations.get('src/added.txt')?.operation, 'added');
    assert.equal(operations.get('src/binary.bin')?.representation, 'binary');
    assert.equal(operations.get('src/link.txt')?.representation, 'metadata-only');
    assert.equal(operations.has('src/preexisting.txt'), false);
    const patch = readFileSync(join(dirname(prepared.details.runPath), 'change.patch'));
    assert.equal(sha256(patch), collected.patch?.digest);
    assert.match(patch.toString('utf8'), /dirty baseline/);
    assert.match(patch.toString('utf8'), /implemented/);
    const collectedRun = JSON.parse(readFileSync(prepared.details.runPath, 'utf8'));
    assert.equal(collectedRun.state, 'facts-collected');
    assert.equal(Object.hasOwn(collectedRun, 'worktreeCurrent'), false);
    assert.equal(collectedRun.factBundle.factCollectionId, collected.factCollectionId);
    assert.equal(
      Object.hasOwn(JSON.parse(readFileSync(collected.handoffPath, 'utf8')), 'factCollectionId'),
      false,
    );
    assert.equal(lstatSync(join(root, 'src', 'link.txt')).isSymbolicLink(), true);

    const handoff = validHandoffDocument('package.json');
    handoff.materialClaims[0].evidence = {
      changedFiles: ['package.json'],
      checks: ['fixture-check'],
    };
    handoff.materialClaims[0].falsification!.supportingEvidence = {
      changedFiles: ['package.json'],
      checks: ['fixture-check'],
    };
    handoff.reviewMap[0].checkIds = ['fixture-check'];
    writeFileSync(collected.handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
    const finalized = await finalizeDelegationHandoff({
      projectRoot: root,
      runId: prepared.runId,
    });
    assert.equal(finalized.status, 'needs-attention');
    assert.ok(finalized.attention.some((item) =>
      item.code === 'verifier-surface-changed'
      && item.resolution.kind === 'direct-review'));
    assert.equal(finalized.factCollectionId, collected.factCollectionId);
    assert.equal(Object.hasOwn(finalized, 'runtimeFacts'), false);
    if (typeof finalized.presentationMarkdown !== 'string') {
      assert.fail('fresh terminal finalization must include the rendered handoff');
    }
    assert.match(finalized.presentationMarkdown, /### Runtime facts/);
    assert.match(finalized.presentationMarkdown, /package\.json.*command-definition/);
    assert.match(finalized.nextStep, /Attention action/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('recollection replaces stale fact binding and resets the handoff input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-recollect-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'one\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, { noCommandRationale: 'No executable check applies to this text fixture.' });
    const prepared = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'two\n', 'utf8');
    const first = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    writeFileSync(first.handoffPath, JSON.stringify({ custom: 'stale host content' }), 'utf8');
    writeFileSync(join(root, 'source.txt'), 'three\n', 'utf8');
    const second = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    assert.notEqual(second.factCollectionId, first.factCollectionId);
    const reset = JSON.parse(readFileSync(second.handoffPath, 'utf8'));
    assert.equal(Object.hasOwn(reset, 'factCollectionId'), false);
    assert.deepEqual(reset.materialClaims, []);
    assert.equal(Object.hasOwn(reset, 'custom'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('a timed-out check retries with a larger budget in the same run and preserves attempts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-timeout-retry-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      routine: true,
      checks: [{
        id: 'slow-check',
        rationale: 'Exercise inspectable timeout recovery.',
        argv: [
          process.execPath,
          '-e',
          'process.stdout.write("start");setTimeout(()=>process.stdout.write("done"),150)',
        ],
        source: 'host-task',
        commandDefinitionPaths: [],
        acceptanceSurfacePaths: [],
      }],
    });
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath,
      productVersion: VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    assert.equal(prepared.semanticContract.verification.mode, 'checks');
    if (prepared.semanticContract.verification.mode !== 'checks') return;
    assert.equal(
      Object.hasOwn(prepared.semanticContract.verification.checks[0], 'timeoutMs'),
      false,
    );

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const first = await collectDelegationFacts({
      projectRoot: root,
      runId: prepared.runId,
      productVersion: VERSION,
      timeoutMs: 25,
    });
    assert.equal(first.collectionMode, 'full-collection');
    assert.equal(first.checks[0].status, 'unavailable');
    assert.equal(first.checks[0].timedOut, true);
    assert.equal(first.checks[0].timeoutMs, 25);
    assert.equal(first.checks[0].attemptCount, 1);
    assert.match(first.nextStep, /--retry-check slow-check=/);
    assert.match(first.nextStep, /Do not run them outside Runtime or finalize yet/);

    await assert.rejects(
      collectDelegationFacts({
        projectRoot: root,
        runId: prepared.runId,
        productVersion: VERSION,
        retryChecks: [{ checkId: 'slow-check', timeoutMs: 25 }],
      }),
      /greater than 25 ms/,
    );
    writeFileSync(join(root, 'source.txt'), 'changed after facts\n', 'utf8');
    await assert.rejects(
      collectDelegationFacts({
        projectRoot: root,
        runId: prepared.runId,
        productVersion: VERSION,
        retryChecks: [{ checkId: 'slow-check', timeoutMs: 1_000 }],
      }),
      /changed after collection/,
    );
    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    writeFileSync(first.handoffPath, JSON.stringify({ custom: 'must reset' }), 'utf8');

    const retried = await collectDelegationFacts({
      projectRoot: root,
      runId: prepared.runId,
      productVersion: VERSION,
      retryChecks: [{ checkId: 'slow-check', timeoutMs: 1_000 }],
    });
    assert.equal(retried.collectionMode, 'timeout-retry');
    assert.equal(retried.runId, first.runId);
    assert.notEqual(retried.factCollectionId, first.factCollectionId);
    assert.equal(retried.checks[0].status, 'passed');
    assert.equal(retried.checks[0].timedOut, false);
    assert.equal(retried.checks[0].timeoutMs, 1_000);
    assert.equal(retried.checks[0].attemptCount, 2);
    assert.deepEqual(retried.changedFiles, first.changedFiles);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(retried.handoffPath, 'utf8')), 'custom'), false);

    const run = JSON.parse(readFileSync(prepared.details.runPath, 'utf8'));
    const attempts = run.factBundle.checks[0].attempts;
    assert.deepEqual(
      attempts.map((attempt: { attempt: number; timeoutMs: number; status: string; timedOut: boolean }) => ({
        attempt: attempt.attempt,
        timeoutMs: attempt.timeoutMs,
        status: attempt.status,
        timedOut: attempt.timedOut,
      })),
      [
        { attempt: 1, timeoutMs: 25, status: 'unavailable', timedOut: true },
        { attempt: 2, timeoutMs: 1_000, status: 'passed', timedOut: false },
      ],
    );
    const stdoutLogs = attempts.flatMap((attempt: { stdout: { logPath?: string } }) =>
      attempt.stdout.logPath ? [attempt.stdout.logPath] : []);
    assert.ok(stdoutLogs.length >= 1);
    assert.equal(new Set(stdoutLogs).size, stdoutLogs.length);
    assert.ok(stdoutLogs.every((path: string) => existsSync(join(root, path))));

    await assert.rejects(
      collectDelegationFacts({
        projectRoot: root,
        runId: prepared.runId,
        productVersion: VERSION,
        retryChecks: [{ checkId: 'slow-check', timeoutMs: 2_000 }],
      }),
      /only after its latest attempt timed out/,
    );

    writeFileSync(retried.handoffPath, `${JSON.stringify({
      protocol: 'semantic-delegation',
      schemaVersion: '1',
      systemMeaningUpdate: 'The bounded fixture now contains the requested after state.',
      materialClaims: [],
      residualUnknowns: [],
      reviewMap: [],
    }, null, 2)}\n`, 'utf8');
    const finalized = await finalizeDelegationHandoff({
      projectRoot: root,
      runId: prepared.runId,
    });
    assert.equal(finalized.status, 'handoff-ready');
    if (typeof finalized.presentationMarkdown !== 'string' || !finalized.details) {
      assert.fail('successful timeout retry must produce a completed handoff');
    }
    assert.match(finalized.presentationMarkdown, /slow-check.*passed.*2 attempts/);
    assert.match(finalized.presentationMarkdown, /Attempt 1: unavailable/);
    assert.ok(finalized.details.checkLogs.length >= 1);
    assert.ok(finalized.details.checkLogs.some((entry) => entry.attempt === 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('non-runnable compile outcomes create no run directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-no-run-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'one\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {});
    const result = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(result.status, 'verification-required');
    assert.equal(result.runCreated, false);
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('prepare rejects unavailable top-level executables without claiming nested readiness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-preflight-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'one\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const missingPath = join(inputRoot, 'missing.json');
    writePrepareInput(missingPath, {
      checks: [{
        id: 'missing-check',
        rationale: 'Prove unavailable command preflight.',
        argv: ['resonant-code-certainly-missing-executable', '--version'],
        source: 'host-task',
        commandDefinitionPaths: [],
        acceptanceSurfacePaths: [],
      }],
    });
    const missing = await prepareDelegationTask({
      projectRoot: root,
      inputPath: missingPath,
      productVersion: VERSION,
    });
    assert.equal(missing.status, 'verification-required');
    assert.equal(missing.runCreated, false);
    const missingIssues = 'issues' in missing && Array.isArray(missing.issues)
      ? missing.issues
      : [];
    assert.ok(missingIssues.some((item) =>
      item.code === 'verification-executable-unavailable'
      && item.path === 'verification.checks[0].argv[0]'));
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);

    const nestedPath = join(inputRoot, 'nested.json');
    writePrepareInput(nestedPath, {
      checks: [{
        id: 'nested-check',
        rationale: 'Top-level Node is runnable while nested prerequisites remain an execution fact.',
        argv: [process.execPath, '-e', 'require("resonant-code-certainly-missing-module")'],
        source: 'host-task',
        commandDefinitionPaths: [],
        acceptanceSurfacePaths: [],
      }],
    });
    const nested = await prepareDelegationTask({
      projectRoot: root,
      inputPath: nestedPath,
      productVersion: VERSION,
    });
    assert.equal(nested.status, 'prepared');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('frozen checks distinguish failed and unavailable and cap persisted output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-checks-'));
  try {
    const results = await runFrozenChecks({
      projectRoot: root,
      outputDirectory: join(root, 'logs'),
      executions: [
        {
          timeoutMs: 10_000,
          definition: {
            id: 'large',
            rationale: 'Verify full output integrity.',
            argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(1100000))'],
            source: 'host-task',
            verifierRefs: [],
          },
        },
        {
          timeoutMs: 10_000,
          definition: {
            id: 'failed',
            rationale: 'Exercise completed failure.',
            argv: [process.execPath, '-e', 'process.exit(9)'],
            source: 'host-task',
            verifierRefs: [],
          },
        },
        {
          timeoutMs: 10_000,
          definition: {
            id: 'missing',
            rationale: 'Exercise unavailable execution.',
            argv: ['resonant-code-command-that-does-not-exist'],
            source: 'host-task',
            verifierRefs: [],
          },
        },
      ],
    });
    assert.equal(results[0].attempts[0].status, 'passed');
    assert.equal(results[0].attempts[0].stdout.byteLength, 1_100_000);
    assert.equal(results[0].attempts[0].stdout.persistedBytes, 1024 * 1024);
    assert.equal(results[0].attempts[0].stdout.truncated, true);
    assert.equal(results[1].attempts[0].status, 'failed');
    assert.equal(results[1].attempts[0].exitCode, 9);
    assert.equal(results[2].attempts[0].status, 'unavailable');
    assert.equal(results[2].attempts[0].exitCode, null);
    assert.match(results[2].attempts[0].reason ?? '', /could not start/i);
    await assert.rejects(
      runFrozenChecks({
        projectRoot: root,
        outputDirectory: join(root, 'logs'),
        executions: [{
          definition: {
            id: 'missing',
            rationale: 'Exercise unavailable execution.',
            argv: ['resonant-code-command-that-does-not-exist'],
            source: 'host-task',
            verifierRefs: [],
          },
          timeoutMs: 20_000,
          previousAttempts: results[2].attempts,
        }],
      }),
      /prior timed-out attempt/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize completes a fresh fact-bound handoff and explain preserves all authorities', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-finalize-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    writeValidHandoff(collected.handoffPath, collected.changedFiles[0].path);

    const finalized = await finalizeDelegationHandoff({ projectRoot: root, runId: prepared.runId });
    assert.equal(finalized.status, 'handoff-ready');
    assert.equal(finalized.state, 'completed');
    assert.match(finalized.humanAuthorityNotice, /human review only/);
    const explained = explainDelegationRun({ projectRoot: root, runId: prepared.runId });
    assert.equal(explained.state, 'completed');
    assert.ok(explained.contract);
    assert.equal(explained.contract.authority.humanEvents[0].content, TASK);
    assert.equal(explained.factBundle?.factCollectionId, collected.factCollectionId);
    assert.equal(
      (explained.handoff as { systemMeaningUpdate: string }).systemMeaningUpdate,
      'The fixture now exposes the implemented after state.',
    );
    assert.equal(
      (explained.evaluation as { status: string }).status,
      'handoff-ready',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('finalize detects repository edits before parsing Host claims and requires recollection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-stale-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'first implementation\n', 'utf8');
    const first = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    writeFileSync(first.handoffPath, '{"malformed":"host facts"}\n', 'utf8');
    writeFileSync(join(root, 'source.txt'), 'repair after collection\n', 'utf8');
    const stale = await finalizeDelegationHandoff({ projectRoot: root, runId: prepared.runId });
    assert.equal(stale.status, 'facts-stale');
    assert.equal(stale.state, 'facts-collected');
    assert.equal(explainDelegationRun({ projectRoot: root, runId: prepared.runId }).state, 'facts-collected');

    const recollected = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    writeValidHandoff(
      recollected.handoffPath,
      recollected.changedFiles[0].path,
    );
    const finalized = await finalizeDelegationHandoff({ projectRoot: root, runId: prepared.runId });
    assert.equal(finalized.status, 'handoff-ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('finalize rejects Host-declared machine facts before Core evaluation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-host-facts-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    const handoff = validHandoffDocument(collected.changedFiles[0].path) as Record<string, unknown>;
    handoff.changedFiles = [{ path: 'invented.ts', operation: 'added' }];
    writeFileSync(collected.handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
    await assert.rejects(
      () => finalizeDelegationHandoff({ projectRoot: root, runId: prepared.runId }),
      /unrecognized key|changedFiles/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('finalize reports independent semantic authoring issues together and remains retryable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-handoff-issues-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });
    const prepared = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collectDelegationFacts({ projectRoot: root, runId: prepared.runId, productVersion: VERSION });
    const invalid = validHandoffDocument(collected.changedFiles[0].path);
    invalid.materialClaims[0].evidence = {
      changedFiles: ['missing.ts'],
      checks: ['missing-check'],
    };
    delete invalid.materialClaims[0].falsification;
    invalid.residualUnknowns = [{
      id: 'unknown:missing',
      statement: 'A boundary remains unknown.',
      adoptionImpact: 'Adoption could preserve the wrong behavior.',
      validationPath: 'Inspect the exact missing boundary.',
      references: {
        claims: ['claim:missing'],
        changedFiles: ['missing.ts'],
      },
    }];
    writeFileSync(collected.handoffPath, `${JSON.stringify(invalid, null, 2)}\n`, 'utf8');

    await assert.rejects(
      () => finalizeDelegationHandoff({ projectRoot: root, runId: prepared.runId }),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object');
        const result = error as {
          code?: string;
          issues?: Array<{ code?: string; path: string; remediation?: string }>;
        };
        assert.equal(result.code, 'INVALID_INPUT');
        assert.ok((result.issues?.length ?? 0) >= 5);
        assert.ok(result.issues?.some((issue) => issue.code === 'falsification-required'));
        assert.ok(result.issues?.some((issue) => issue.code === 'changed-path-unknown'));
        assert.ok(result.issues?.some((issue) => issue.code === 'check-id-unknown'));
        assert.ok(result.issues?.every((issue) => Boolean(issue.remediation)));
        return true;
      },
    );
    assert.equal(explainDelegationRun({ projectRoot: root, runId: prepared.runId }).state, 'facts-collected');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

test('retention removes only whole old completed runs and preserves prepared runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-retention-'));
  const inputRoot = mkdtempSync(join(tmpdir(), 'resonant-input-'));
  try {
    initializeRepository(root);
    writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);
    const inputPath = join(inputRoot, 'prepare.json');
    writePrepareInput(inputPath, {
      noCommandRationale: 'The fixture has no executable acceptance command.',
    });

    const first = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(first.status, 'prepared');
    if (first.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'first\n', 'utf8');
    const firstFacts = await collectDelegationFacts({ projectRoot: root, runId: first.runId, productVersion: VERSION });
    writeValidHandoff(firstFacts.handoffPath, firstFacts.changedFiles[0].path);
    await finalizeDelegationHandoff({ projectRoot: root, runId: first.runId });

    const firstRunDirectory = dirname(first.details.runPath);
    const completedFixture = JSON.parse(readFileSync(first.details.runPath, 'utf8'));
    const handoffFixture = readFileSync(join(firstRunDirectory, 'handoff.json'));
    const clonedRunIds: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const runId = randomUUID();
      const runDirectory = join(root, '.resonant-code', 'runs', runId);
      const cloned = structuredClone(completedFixture);
      cloned.runId = runId;
      cloned.createdAt = new Date(Date.UTC(2025, 0, index + 1)).toISOString();
      cloned.completion.completedAt = cloned.createdAt;
      mkdirSync(runDirectory);
      writeFileSync(join(runDirectory, 'run.json'), `${JSON.stringify(cloned, null, 2)}\n`, 'utf8');
      writeFileSync(join(runDirectory, 'handoff.json'), handoffFixture);
      clonedRunIds.push(runId);
    }

    const inProgress = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    const current = await prepareDelegationTask({ projectRoot: root, inputPath, productVersion: VERSION });
    assert.equal(inProgress.status, 'prepared');
    assert.equal(current.status, 'prepared');
    if (inProgress.status !== 'prepared' || current.status !== 'prepared') return;
    writeFileSync(join(root, 'source.txt'), 'second\n', 'utf8');
    const currentFacts = await collectDelegationFacts({ projectRoot: root, runId: current.runId, productVersion: VERSION });
    writeValidHandoff(
      currentFacts.handoffPath,
      currentFacts.changedFiles[0].path,
    );
    const finalized = await finalizeDelegationHandoff({ projectRoot: root, runId: current.runId });

    if (!('retention' in finalized) || !finalized.retention) {
      assert.fail('fresh finalization must apply retention');
    }
    assert.equal(finalized.retention.removedCompletedRunIds.length, 2);
    assert.equal(existsSync(inProgress.details.runPath), true);
    assert.equal(JSON.parse(readFileSync(inProgress.details.runPath, 'utf8')).state, 'prepared');
    assert.equal(existsSync(current.details.runPath), true);
    const remainingCompleted = [first.runId, current.runId, ...clonedRunIds]
      .filter((runId) => {
        const runPath = join(root, '.resonant-code', 'runs', runId, 'run.json');
        return existsSync(runPath)
          && JSON.parse(readFileSync(runPath, 'utf8')).state === 'completed';
      });
    assert.equal(remainingCompleted.length, 50);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(inputRoot, { recursive: true, force: true });
  }
});

const TASK = 'Implement the Semantic Handoff MVP without legacy compatibility.';

function writePrepareInput(
  path: string,
  verification: {
    checks?: Array<{
      id: string;
      rationale: string;
      argv: string[];
      source: 'host-task';
      commandDefinitionPaths: string[];
      acceptanceSurfacePaths: string[];
    }>;
    noCommandRationale?: string;
    routine?: boolean;
    repositoryEvidence?: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
    }>;
  },
): void {
  const value = {
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    humanEvents: [{ id: 'event:task', kind: 'task', content: TASK }],
    semantic: {
      desiredOutcome: {
        value: 'Produce a fact-bound cognitive handoff.',
        basis: {
          humanEventIds: ['event:task'],
          repositoryEvidenceIds: verification.repositoryEvidence
            ? ['evidence:package']
            : [],
        },
      },
      constraints: [],
      nonGoals: [],
      focus: [],
      consequence: {
        value: verification.routine ? 'low' : 'high',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      assuranceDimensions: verification.routine
        ? []
        : [{
            dimension: 'behavior',
            criticality: 'adoption-critical',
            rationale: 'The fixture behavior determines whether the handoff can be adopted.',
            basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
          }],
    },
    ...(verification.repositoryEvidence
      ? { repositoryEvidence: verification.repositoryEvidence }
      : {}),
    verification: {
      ...(verification.checks ? { checks: verification.checks } : {}),
      ...(verification.noCommandRationale
        ? { noCommandRationale: verification.noCommandRationale }
        : {}),
    },
  };
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeValidHandoff(
  path: string,
  changedFile: string,
): void {
  writeFileSync(
    path,
    `${JSON.stringify(validHandoffDocument(changedFile), null, 2)}\n`,
    'utf8',
  );
}

function validHandoffDocument(changedFile: string): CognitiveHandoffDocument {
  return {
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    systemMeaningUpdate: 'The fixture now exposes the implemented after state.',
    materialClaims: [{
      id: 'claim:behavior',
      dimension: 'behavior',
      statement: 'The source fixture now contains the requested after state.',
      adoptionConsequence: 'Adopting the change replaces the prior fixture behavior.',
      adoptionCritical: true,
      basis: 'agent-judgment',
      evidence: { changedFiles: [changedFile] },
      falsification: {
        failureHypothesis: 'A competing edit could preserve the prior fixture state.',
        attempt: 'Inspected the full collected patch for a conflicting state.',
        status: 'supported',
        supportingEvidence: { changedFiles: [changedFile] },
        counterEvidence: {},
        conclusion: 'The complete collected change contains the after state and no competing edit.',
      },
    }],
    residualUnknowns: [],
    reviewMap: [{
      id: 'review:source',
      priority: 'must-read',
      changedFiles: [changedFile],
      checkIds: [],
      claimIds: ['claim:behavior'],
      unknownIds: [],
      rationale: 'This file contains the entire behavioral change.',
      prevents: 'Adopting an unintended fixture state.',
    }],
  };
}

function initializeRepository(root: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'semantic-handoff@example.invalid']);
  git(root, ['config', 'user.name', 'Semantic Handoff Test']);
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

function gitOutput(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function directoryContentFingerprint(root: string): string {
  const entries: string[] = [];
  visit(root, '');
  return sha256(entries.join('\n'));

  function visit(directory: string, prefix: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        entries.push(`${relativePath}:${sha256(readFileSync(absolutePath))}`);
      }
    }
  }
}

function makeTreeReadOnly(root: string): () => void {
  const modes: Array<{ path: string; mode: number }> = [];
  visit(root);
  return () => {
    for (const entry of [...modes].reverse()) chmodSync(entry.path, entry.mode);
  };

  function visit(path: string): void {
    const stat = statSync(path);
    modes.push({ path, mode: stat.mode & 0o777 });
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) visit(join(path, child));
      chmodSync(path, 0o555);
    } else {
      chmodSync(path, 0o444);
    }
  }
}
