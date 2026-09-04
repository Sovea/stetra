import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeProject } from '../src/project/init.ts';
import type { TaskBeginDocument, TaskDecisionDocument, TaskHandoffDocument } from '../src/schemas/task.ts';
import {
  beginTask,
  collectTask,
  decideTask,
  handoffTask,
  inspectTask,
} from '../src/workflow/task.ts';

test('routine task follows Begin, collection reuse, Handoff, and exact Human adoption', async () => {
  const root = repository('stetra-task-routine-');
  try {
    const began = await beginTask({ projectRoot: root, source: beginInput(), productVersion: '0.0.1' });
    assert.equal(began.status, 'task-begun');
    assert.equal(began.phase, 'working');
    writeFileSync(join(root, 'app.txt'), 'new\n', 'utf8');

    const collected = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(collected.status, 'facts-collected');
    assert.equal(collected.phase, 'awaiting-handoff');
    assert.deepEqual(collected.summary.changedFiles.map((file) => file.path), ['app.txt']);
    assert.deepEqual(collected.summary.checks.map((check) => [check.key, check.status]), [['content', 'passed']]);
    const reused = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(reused.status, 'facts-current');
    assert.equal(reused.reused, true);

    const handedOff = await handoffTask({
      projectRoot: root,
      taskId: began.taskId,
      source: handoffInput('accept'),
    });
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal(handedOff.phase, 'awaiting-decision');
    if (!('decisionBrief' in handedOff) || !handedOff.decisionBrief) assert.fail('missing Decision Brief');
    assert.deepEqual(handedOff.decisionBrief.attention, []);
    assert.equal(handedOff.decisionBrief.decisionState.adoption.status, 'pending');
    assert.equal(handedOff.decisionBrief.changeMeaning.humanRequest.content, 'Change app.txt from old to new.');
    assert.equal(handedOff.decisionBrief.changeMeaning.humanRequest.capture, 'unattested-input');

    const decided = await decideTask({
      projectRoot: root,
      taskId: began.taskId,
      source: decisionInput('accepted', 'I accept this implementation.'),
    });
    assert.equal(decided.phase, 'complete');
    assert.equal(decided.decision.status, 'accepted');

    const summary = await inspectTask({ projectRoot: root, taskId: began.taskId, section: 'summary' });
    if (!('summary' in summary)) assert.fail('missing summary');
    assert.equal(summary.summary.humanDecision, 'accepted');
    assert.equal(summary.summary.collectionCount, 1);
    const events = await inspectTask({ projectRoot: root, taskId: began.taskId, section: 'events' });
    if (!('events' in events)) assert.fail('missing events');
    assert.deepEqual(events.events.map((event) => event.type), [
      'task-began',
      'facts-collected',
      'handoff-authored',
      'human-decision-recorded',
    ]);
    assert.deepEqual(events.events.map((event) => event.sequence), [1, 2, 3, 4]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed Check stays in ordinary Work and a correction starts a new attempt', async () => {
  const root = repository('stetra-task-repair-');
  try {
    const began = await beginTask({ projectRoot: root, source: beginInput(), productVersion: '0.0.1' });
    writeFileSync(join(root, 'app.txt'), 'wrong\n', 'utf8');
    const failed = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(failed.phase, 'working');
    assert.equal(failed.summary.checks[0].status, 'failed');
    assert.equal(failed.directive.kind, 'continue-work');
    const check = await inspectTask({
      projectRoot: root,
      taskId: began.taskId,
      section: 'check',
      checkKey: 'content',
    });
    if (!('selectedAttempt' in check)) assert.fail('missing Check detail');
    assert.equal(check.selectedAttempt.status, 'failed');
    const log = await inspectTask({
      projectRoot: root,
      taskId: began.taskId,
      section: 'log',
      checkKey: 'content',
      stream: 'stderr',
      tailBytes: 64,
    });
    if (!('log' in log)) assert.fail('missing log detail');
    assert.match(log.log.content, /expected new/);

    writeFileSync(join(root, 'app.txt'), 'new\n', 'utf8');
    const repaired = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(repaired.phase, 'awaiting-handoff');
    assert.equal(repaired.summary.checks[0].status, 'passed');
    assert.equal(repaired.summary.changedFiles.length, 1);

    await handoffTask({ projectRoot: root, taskId: began.taskId, source: handoffInput('accept') });
    const correction = await decideTask({
      projectRoot: root,
      taskId: began.taskId,
      source: decisionInput('correction-requested', 'Also preserve a trailing marker.'),
    });
    assert.equal(correction.phase, 'working');
    assert.equal(correction.directive.kind, 'work');
    const afterCorrection = await inspectTask({ projectRoot: root, taskId: began.taskId, section: 'summary' });
    if (!('summary' in afterCorrection)) assert.fail('missing summary');
    assert.equal(afterCorrection.summary.attemptNumber, 2);
    assert.equal(afterCorrection.summary.collectionCount, 2);

    writeFileSync(join(root, 'app.txt'), 'new marker\n', 'utf8');
    const secondAttempt = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(secondAttempt.phase, 'working');
    assert.equal(secondAttempt.summary.checks[0].status, 'failed');
    assert.equal(secondAttempt.summary.changedFiles[0].path, 'app.txt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('editing after collection makes facts stale without writing a Handoff', async () => {
  const root = repository('stetra-task-stale-');
  try {
    const began = await beginTask({ projectRoot: root, source: beginInput(), productVersion: '0.0.1' });
    writeFileSync(join(root, 'app.txt'), 'new\n', 'utf8');
    await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    writeFileSync(join(root, 'extra.txt'), 'late edit\n', 'utf8');
    const stale = await handoffTask({ projectRoot: root, taskId: began.taskId, source: handoffInput('accept') });
    assert.equal(stale.status, 'facts-stale');
    assert.equal(stale.stateWritten, false);
    const events = await inspectTask({ projectRoot: root, taskId: began.taskId, section: 'events' });
    if (!('events' in events)) assert.fail('missing events');
    assert.deepEqual(events.events.map((event) => event.type), ['task-began', 'facts-collected']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('routine no-command task has no synthetic verification obligation', async () => {
  const root = repository('stetra-task-no-command-');
  try {
    const source: TaskBeginDocument = {
      ...beginInput(),
      verification: { mode: 'no-command', rationale: 'This fixture checks a prose-only edit.' },
    };
    const began = await beginTask({ projectRoot: root, source, productVersion: '0.0.1' });
    writeFileSync(join(root, 'notes.md'), 'A clearer note.\n', 'utf8');
    const collected = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(collected.phase, 'awaiting-handoff');
    assert.deepEqual(collected.summary.checks, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an actual timeout can be retried once with a larger bounded budget without losing its first Attempt', async () => {
  const root = repository('stetra-task-timeout-');
  try {
    const configPath = join(root, '.stetra', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.executionPolicy = {
      checkTimeoutMs: 30,
      maxTimeoutMs: 500,
      maxTimeoutRetriesPerCheck: 1,
    };
    config.verificationProfiles.timeout = {
      checks: [{
        key: 'slow',
        argv: [process.execPath, '-e', 'setTimeout(() => process.exit(0), 120)'],
      }],
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const source: TaskBeginDocument = {
      ...beginInput(),
      verification: { mode: 'profile', name: 'timeout' },
    };
    const began = await beginTask({ projectRoot: root, source, productVersion: '0.0.1' });
    const timedOut = await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    assert.equal(timedOut.phase, 'working');
    assert.equal(timedOut.summary.checks[0].termination.kind, 'timeout');
    assert.equal(timedOut.retryableTimeouts?.[0].checkKey, 'slow');
    await assert.rejects(() => collectTask({
      projectRoot: root,
      taskId: began.taskId,
      productVersion: '0.0.1',
      retryTimeout: { checkKey: 'slow', timeoutMs: 30 },
    }), /must exceed 30 ms/);
    const retried = await collectTask({
      projectRoot: root,
      taskId: began.taskId,
      productVersion: '0.0.1',
      retryTimeout: { checkKey: 'slow', timeoutMs: 300 },
    });
    assert.equal(retried.phase, 'awaiting-handoff');
    assert.equal(retried.summary.checks[0].status, 'passed');
    assert.equal(retried.summary.checks[0].attemptCount, 2);
    const collections = await inspectTask({ projectRoot: root, taskId: began.taskId, section: 'collections' });
    if (!('collections' in collections)) assert.fail('missing collections');
    assert.equal(collections.collections.length, 2);
    const detail = await inspectTask({
      projectRoot: root,
      taskId: began.taskId,
      section: 'collection',
      collectionId: collections.collections[1].factCollectionId,
    });
    if (!('collection' in detail)) assert.fail('missing collection detail');
    assert.deepEqual(
      detail.collection.checks[0].attempts.map((attempt) => attempt.termination.kind),
      ['timeout', 'exit'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function repository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Stetra Test']);
  git(root, ['config', 'user.email', 'stetra@example.test']);
  writeFileSync(join(root, 'app.txt'), 'old\n', 'utf8');
  writeFileSync(join(root, 'notes.md'), 'An old note.\n', 'utf8');
  initializeProject({ projectRoot: root, adapters: ['codex'] });
  const configPath = join(root, '.stetra', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.defaultVerificationProfile = 'default';
  config.verificationProfiles.default = {
    checks: [{
      key: 'content',
      argv: [
        process.execPath,
        '-e',
        "const fs=require('node:fs');if(fs.readFileSync('app.txt','utf8')!=='new\\n'){process.stderr.write('expected new\\n');process.exit(1)}",
      ],
      executionInputs: [{ kind: 'file', path: 'app.txt' }],
    }],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

function beginInput(): TaskBeginDocument {
  return {
    humanEvent: { content: 'Change app.txt from old to new.' },
    interpretation: {
      desiredOutcome: 'app.txt contains the new value.',
      constraints: ['Keep the file name.'],
      nonGoals: [],
    },
    assurance: { mode: 'routine' },
    verification: { mode: 'profile', name: 'default' },
  };
}

function handoffInput(action: 'accept' | 'defer'): TaskHandoffDocument {
  return {
    actualChange: {
      behavior: 'app.txt now contains the requested value.',
      mechanism: ['The single text value was replaced.'],
      preservedInvariants: ['The path remains app.txt.'],
    },
    reviewFocus: [{
      question: 'Does app.txt contain exactly the intended value?',
      adoptionImpact: 'This is the requested behavior.',
      nextAction: 'Inspect app.txt.',
      evidence: [{ kind: 'changed-file', path: 'app.txt' }, { kind: 'check', checkKey: 'content' }],
    }],
    recommendation: {
      action,
      rationale: action === 'accept' ? 'The frozen content Check passes.' : 'More review is needed.',
    },
  };
}

function decisionInput(
  action: TaskDecisionDocument['action'],
  content: string,
): TaskDecisionDocument {
  return {
    humanEvent: { content },
    action,
    reason: content,
  };
}
