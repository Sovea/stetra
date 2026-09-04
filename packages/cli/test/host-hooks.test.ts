import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { handleHostHook } from '../src/host/hook.ts';
import { bindHostSession } from '../src/host/session.ts';
import { initializeProject } from '../src/project/init.ts';
import { beginTask, collectTask, decideTask, handoffTask } from '../src/workflow/task.ts';

test('Host Hooks admit, bind, recover, stop once, and release a completed task', async () => {
  const root = repository();
  const payload = (event: 'SessionStart' | 'Stop') => ({
    session_id: 'native-session-1',
    cwd: root,
    hook_event_name: event,
  });
  try {
    const started = await handleHostHook({
      adapter: 'codex',
      event: 'session-start',
      payload: payload('SessionStart'),
    });
    const context = hookContext(started);
    assert.match(context, /admission is ask/);
    assert.match(context, /ask once/);
    const token = context.match(/--binding-token ([a-z]+\.[a-f0-9]{64}\.[a-f0-9]{32})/)?.[1];
    assert.ok(token);

    const began = await beginTask({
      projectRoot: root,
      productVersion: '0.0.1',
      source: {
        humanEvent: { content: 'Clarify the readme.' },
        interpretation: { desiredOutcome: 'Clarify the readme.', constraints: [], nonGoals: [] },
        assurance: { mode: 'routine' },
        verification: { mode: 'no-command', rationale: 'No executable behavior changes.' },
      },
    });
    bindHostSession({ projectRoot: root, bindingToken: token, taskId: began.taskId });

    const resumed = await handleHostHook({
      adapter: 'codex', event: 'session-start', payload: payload('SessionStart'),
    });
    assert.match(hookContext(resumed), new RegExp(`task ${began.taskId} is working`));
    assert.doesNotMatch(hookContext(resumed), /binding-token/);

    const firstStop = await handleHostHook({ adapter: 'codex', event: 'stop', payload: payload('Stop') });
    assert.equal(firstStop.decision, 'block');
    assert.match(String(firstStop.reason), /task collect/);
    const repeatedStop = await handleHostHook({ adapter: 'codex', event: 'stop', payload: payload('Stop') });
    assert.equal('decision' in repeatedStop, false);
    assert.match(String(repeatedStop.systemMessage), /stopping is allowed/);

    writeFileSync(join(root, 'README.md'), 'Clearer.\n', 'utf8');
    await collectTask({ projectRoot: root, taskId: began.taskId, productVersion: '0.0.1' });
    await handoffTask({
      projectRoot: root,
      taskId: began.taskId,
      source: {
        actualChange: { behavior: 'The readme is clearer.', mechanism: ['README.md was rewritten.'] },
        recommendation: { action: 'accept', rationale: 'The requested wording changed.' },
      },
    });
    const awaitingDecision = await handleHostHook({
      adapter: 'codex', event: 'stop', payload: payload('Stop'),
    });
    assert.equal('decision' in awaitingDecision, false);
    assert.match(String(awaitingDecision.systemMessage), /awaits the developer's adoption decision/);

    await decideTask({
      projectRoot: root,
      taskId: began.taskId,
      source: {
        humanEvent: { content: 'Accept the readme update.' },
        action: 'accepted',
        reason: 'The wording is correct.',
      },
    });
    assert.deepEqual(await handleHostHook({
      adapter: 'codex', event: 'stop', payload: payload('Stop'),
    }), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Host Hooks stay inert outside an installed project and reject mismatched events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-hook-absent-'));
  try {
    assert.deepEqual(await handleHostHook({
      adapter: 'claude',
      event: 'session-start',
      payload: { session_id: 'session', cwd: root, hook_event_name: 'SessionStart' },
    }), {});
    await assert.rejects(() => handleHostHook({
      adapter: 'claude',
      event: 'stop',
      payload: { session_id: 'session', cwd: root, hook_event_name: 'SessionStart' },
    }), /must be Stop/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-hook-project-'));
  execFileSync('git', ['-C', root, 'init', '--quiet']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Stetra Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'stetra@example.test']);
  writeFileSync(join(root, 'README.md'), 'Original.\n', 'utf8');
  initializeProject({ projectRoot: root, adapters: ['codex'] });
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'initial']);
  return root;
}

function hookContext(output: Record<string, unknown>): string {
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  return String(specific?.additionalContext ?? '');
}
