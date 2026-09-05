import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { runCli, formatCliOutput } from '../src/cli.ts';
import { handleHostHook } from '../src/host/hook.ts';
import { ensureHostSession } from '../src/host/session.ts';
import { initializeProject } from '../src/project/init.ts';
import type { TaskBeginDocument, TaskHandoffDocument } from '../src/schemas/task.ts';
import { describeTaskInput, taskInputExamples } from '../src/schemas/task-input.ts';
import { beginTask, collectTask, decideTask, handoffTask, inspectTask, taskContext } from '../src/workflow/task.ts';

const productVersion = '0.0.1';
const beginInput = (): TaskBeginDocument => ({
  humanEvent: { content: 'Clarify the fixture.' },
  interpretation: { desiredOutcome: 'Clarify the fixture.', constraints: [], nonGoals: [] },
  assurance: { mode: 'routine' },
  verification: { mode: 'no-command', rationale: 'This fixture changes prose.' },
});
const handoffInput = (): TaskHandoffDocument => ({
  actualChange: { behavior: 'The fixture is clearer.', mechanism: ['The wording was clarified.'] },
  recommendation: { action: 'accept', rationale: 'The requested wording is present.' },
});

test('CLI preserves Human text and exact assertion and preparation argv, including empty arguments', async () => {
  const root = repository();
  try {
    const source = beginInput();
    source.humanEvent.content = '  保留请求原文。\n';
    const argv: [string, ...string[]] = [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '  padded  ', ''];
    source.verification = { mode: 'checks', checks: [{ key: 'args', argv, preparation: [{ key: 'prepare', argv }] }] };
    const result = await runCli(['--json', 'task', 'begin', root], { input: Readable.from([JSON.stringify(source)]) });
    const taskId = (result.output as { taskId: string }).taskId;
    const contract = await inspectTask({ projectRoot: root, taskId, section: 'contract' });
    assert.ok('contract' in contract);
    assert.equal(contract.contract.humanEvents[0].content, source.humanEvent.content);
    const collected = await collectTask({ projectRoot: root, taskId, productVersion });
    assert.equal(collected.summary.checks[0].status, 'passed');
    const check = await inspectTask({ projectRoot: root, taskId, section: 'check', checkKey: 'args' });
    assert.ok('selectedAttempt' in check);
    assert.deepEqual(check.selectedAttempt.steps.map((step) => step.argv), [argv, argv]);
    const log = await inspectTask({ projectRoot: root, taskId, section: 'log', checkKey: 'args', stream: 'stdout' });
    assert.ok('log' in log);
    assert.equal(log.log.content, '["  padded  ",""]');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('input discovery needs no task or repository and errors identify the matching schema', async () => {
  const absent = join(tmpdir(), 'stetra-schema-absent');
  for (const stage of ['begin', 'handoff', 'decide'] as const) {
    const result = await runCli(['--json', 'task', stage, absent, '--input-schema']);
    assert.deepEqual(result.output, describeTaskInput(stage));
    assert.deepEqual((result.output as { example: unknown }).example, taskInputExamples[stage]);
    assert.match(formatCliOutput(result), /additionalProperties/);
  }
  await assert.rejects(() => runCli(['--json', 'task', 'handoff', '--task', 'fixture'], {
    input: Readable.from(['{"actualChange":{}}']),
  }), /stetra task handoff --input-schema --json/);
  await assert.rejects(() => runCli(['task', 'decide']), /requires --task/);
  await assert.rejects(() => runCli(['task', 'begin'], { input: Readable.from([]) }),
    /Task input is empty.*same command[\s\S]*stetra task begin --input-schema --json/);
});

test('one session completes consecutive tasks and repeated Begin resumes its existing task', async () => {
  const root = repository();
  try {
    await assert.rejects(() => beginTask({ projectRoot: root, productVersion, source: beginInput(), bindingToken: 'invalid' }), /token is invalid/);
    assert.equal(taskCount(root), 0);
    const { bindingToken } = ensureHostSession({ projectRoot: root, adapter: 'codex', sessionId: 'continuity' });
    const input = { projectRoot: root, productVersion, source: beginInput(), bindingToken };
    const first = await beginTask(input);
    assert.equal((await beginTask(input)).taskId, first.taskId);
    assert.equal(taskCount(root), 1);
    await collectTask({ ...input, taskId: first.taskId });
    await handoffTask({ ...input, taskId: first.taskId, source: handoffInput() });
    await decideTask({ ...input, taskId: first.taskId, source: {
      humanEvent: { content: 'Accept the first fixture.' }, action: 'accepted', reason: 'Reviewed.',
    } });
    const start = await hook(root, 'SessionStart');
    assert.match(JSON.stringify(start), /admission is ask/);
    const secondSource = beginInput();
    secondSource.humanEvent.content = 'Clarify another sentence.';
    const second = await beginTask({ ...input, source: secondSource });
    assert.notEqual(second.taskId, first.taskId);
    assert.equal(taskCount(root), 2);
    await assert.rejects(() => beginTask(input), /unfinished task/);
    assert.equal(taskCount(root), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const phase of ['before', 'after']) {
  test(`Begin recovers the same operation after process death ${phase} task publication`, async () => {
    const root = repository();
    try {
      const { bindingToken } = ensureHostSession({ projectRoot: root, adapter: 'codex', sessionId: 'continuity' });
      const interrupted = spawnSync(process.execPath, [
        '--import', 'tsx', join(import.meta.dirname, 'fixtures/interrupted-begin.mjs'), phase, root, bindingToken,
      ], { encoding: 'utf8', input: JSON.stringify(beginInput()) });
      assert.equal(interrupted.status, phase === 'before' ? 71 : 72, interrupted.stderr);
      const session = ensureHostSession({ projectRoot: root, adapter: 'codex', sessionId: 'continuity' });
      assert.ok(session.pendingBegin);
      assert.equal(taskCount(root), phase === 'before' ? 0 : 1);
      if (phase === 'after') assert.match(JSON.stringify(await hook(root, 'SessionStart')), /is working/);
      const resumed = await beginTask({ projectRoot: root, productVersion, source: beginInput(), bindingToken });
      assert.equal(resumed.taskId, session.pendingBegin.taskId);
      assert.equal(taskCount(root), 1);
      assert.equal(ensureHostSession({ projectRoot: root, adapter: 'codex', sessionId: 'continuity' }).pendingBegin, undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('failure refresh reobserves external recovery, preserves failures, and cannot loop on unchanged inputs', async () => {
  const root = repository();
  const external = mkdtempSync(join(tmpdir(), 'stetra-external-'));
  try {
    const flag = join(external, 'available');
    const source = beginInput();
    source.verification = { mode: 'checks', checks: [{ key: 'service', argv: [
      process.execPath, '-e', `process.exit(require('node:fs').existsSync(${JSON.stringify(flag)})?0:1)`,
    ] }] };
    const began = await beginTask({ projectRoot: root, productVersion, source });
    const input = { projectRoot: root, productVersion, taskId: began.taskId };
    const first = await collectTask(input);
    assert.equal(first.summary.checks[0].status, 'failed');
    assert.equal((await collectTask(input)).reused, true);
    await assert.rejects(() => collectTask({ ...input, refreshReason: ' ' }), /concrete/);
    writeFileSync(flag, 'available');
    const refreshed = await collectTask({ ...input, refreshReason: 'The fixture service was restored.' });
    assert.equal(refreshed.summary.checks[0].status, 'passed');
    assert.equal(refreshed.summary.refresh?.authority, 'agent-judgment');
    assert.equal(refreshed.summary.refresh?.priorFactCollectionId, first.summary.factCollectionId);
    const prior = await inspectTask({ ...input, section: 'check', collectionId: first.summary.factCollectionId, checkKey: 'service' });
    assert.ok('selectedAttempt' in prior);
    assert.equal(prior.selectedAttempt.status, 'failed');
    await assert.rejects(() => collectTask({ ...input, refreshReason: 'Try again.' }), /one refresh/);
    rmSync(flag);
    writeFileSync(join(root, 'README.md'), 'A distinct worktree state.\n');
    await collectTask(input);
    await collectTask({ ...input, refreshReason: 'An explicit service recheck.' });
    await assert.rejects(() => collectTask({ ...input, refreshReason: 'Repeat unchanged.' }), /one refresh/);
    await handoffTask({ ...input, source: { ...handoffInput(), recommendation: { action: 'defer', rationale: 'The service is still unavailable.' } } });
    await assert.rejects(() => collectTask({ ...input, retryTimeout: { checkKey: 'service', timeoutMs: 400_000 } }), /did not time out/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test('brief, inspection, and Hooks share currency and preserve Human corrections and review meaning', async () => {
  const root = repository();
  try {
    const { bindingToken } = ensureHostSession({ projectRoot: root, adapter: 'codex', sessionId: 'continuity' });
    const began = await beginTask({ projectRoot: root, productVersion, source: beginInput(), bindingToken });
    const input = { projectRoot: root, productVersion, taskId: began.taskId };
    writeFileSync(join(root, 'README.md'), 'Clarified.\n');
    await collectTask(input);
    const source = handoffInput();
    source.actualChange.failureAndRecovery = ['A missing section is visible during direct review.'];
    source.reviewFocus = [{ question: 'Is the fallback explained?', adoptionImpact: 'Operators need a recovery entry point.', nextAction: 'Read README.md.', evidence: [{ kind: 'changed-file', path: 'README.md' }] }];
    const authored = await handoffTask({ ...input, source });
    assert.ok('decisionBrief' in authored);
    const restored = await inspectTask({ ...input, section: 'handoff' });
    assert.ok('decisionBrief' in restored);
    assert.deepEqual(restored.decisionBrief, authored.decisionBrief);
    const cli = await runCli(['task', 'inspect', root, '--task', began.taskId, '--section', 'handoff']);
    assert.match(formatCliOutput(cli), /Operators need a recovery entry point/);
    assert.match(formatCliOutput(cli), /Evidence: README.md/);
    assert.match(JSON.stringify(await hook(root, 'Stop')), /Operators need a recovery entry point/);
    writeFileSync(join(root, 'README.md'), 'Edited after Handoff.\n');
    assert.equal((await taskContext(root, began.taskId)).factsCurrency, 'stale');
    const stale = await inspectTask({ ...input, section: 'handoff' });
    assert.equal(stale.phase, 'working');
    assert.equal('decisionBrief' in stale, false);
    assert.match(JSON.stringify(await hook(root, 'Stop')), /collect/);
    assert.doesNotMatch(JSON.stringify(await hook(root, 'Stop')), /awaits the developer/);
    await collectTask(input);
    await handoffTask({ ...input, source });
    const correction = '  Also explain the retry path.\n';
    await decideTask({ ...input, source: { humanEvent: { content: correction }, action: 'correction-requested', reason: 'Clarify recovery.' } });
    assert.equal((await taskContext(root, began.taskId)).corrections[0].content, correction);
    assert.match(JSON.stringify(await hook(root, 'SessionStart')), /Also explain the retry path/);
    await collectTask(input);
    const next = await handoffTask({ ...input, source });
    assert.ok('decisionBrief' in next && next.decisionBrief);
    assert.equal(next.decisionBrief.changeMeaning.humanCorrections[0].content, correction);
    await decideTask({ ...input, source: { humanEvent: { content: 'Accept the corrected fixture.' }, action: 'accepted', reason: 'Reviewed.' } });
    const complete = await runCli(['task', 'inspect', root, '--task', began.taskId, '--section', 'handoff']);
    assert.match(formatCliOutput(complete), /Human adoption: accepted/);
    assert.doesNotMatch(formatCliOutput(complete), /Human adoption is pending/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function taskCount(root: string): number {
  const directory = join(root, '.stetra', 'tasks');
  return existsSync(directory) ? readdirSync(directory).length : 0;
}

function hook(root: string, event: 'SessionStart' | 'Stop') {
  return handleHostHook({ adapter: 'codex', event: event === 'SessionStart' ? 'session-start' : 'stop',
    payload: { session_id: 'continuity', cwd: root, hook_event_name: event } });
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-continuity-'));
  for (const args of [['init', '--quiet'], ['config', 'user.name', 'Stetra Test'], ['config', 'user.email', 'stetra@example.test']]) {
    execFileSync('git', ['-C', root, ...args]);
  }
  writeFileSync(join(root, 'README.md'), 'Original.\n');
  initializeProject({ projectRoot: root, adapters: ['codex'] });
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'fixture']);
  return root;
}
