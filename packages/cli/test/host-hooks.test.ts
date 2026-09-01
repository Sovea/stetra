import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { formatCliOutput, runCli } from '../src/cli.ts';
import { handleHostHook } from '../src/host/hook-gateway.ts';
import {
  beginHostSession,
  hostSessionKey,
  readHostSession,
} from '../src/host/session-bridge.ts';
import { initializeProject } from '../src/project/init.ts';
import { PRODUCT_VERSION } from '../src/version.ts';
import {
  collectDelegationFacts,
  evaluateDelegationHandoff,
  prepareDelegationTask,
} from '../src/workflow/delegation.ts';
import {
  hostActionAuthoringPacket,
  type HostAction,
} from '../src/workflow/host-action.ts';

test('SessionStart binds only its exact Host session and consumes a one-time begin token', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const started = await handleHostHook({
      adapter: 'codex',
      event: 'session-start',
      payload: hookPayload(root, 'session-1', 'SessionStart'),
    });
    const context = additionalContext(started.wireOutput);
    const bindingToken = context.match(/[a-f0-9]{64}\.[a-f0-9]{32}/)?.[0];
    assert.ok(bindingToken);
    assert.match(context, /Do not use Stetra for unrelated conversation-only work/);
    assert.match(context, /"--adapter","codex"/);
    assert.match(context, new RegExp(`"--binding-token","${bindingToken}"`));
    assert.equal(
      hostSessionKey('codex', 'session-1'),
      bindingToken.slice(0, 64),
    );
    assert.doesNotMatch(
      readFileSync(join(
        root,
        '.stetra',
        'host-sessions',
        'codex',
        bindingToken.slice(0, 64),
        'binding.json',
      ), 'utf8'),
      /session-1/,
    );

    const lockPath = join(
      root, '.stetra', 'host-sessions', 'codex', bindingToken.slice(0, 64), 'begin.lock',
    );
    writeFileSync(lockPath, '', 'utf8');
    assert.throws(() => beginHostSession({
      projectRoot: root,
      adapter: 'codex',
      bindingToken,
    }), /already in progress/);
    rmSync(lockPath);

    const begun = beginHostSession({
      projectRoot: root,
      adapter: 'codex',
      bindingToken,
    });
    assert.equal(begun.session.bindingState, 'task-bound');
    assert.equal(begun.reservation.prefilled, true);
    assert.equal(existsSync(join(root, begun.reservation.path)), true);
    assert.throws(() => beginHostSession({
      projectRoot: root,
      adapter: 'codex',
      bindingToken,
    }), /already consumed/);
    assert.equal(readHostSession({
      projectRoot: root,
      adapter: 'claude',
      sessionId: 'session-1',
    }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Host-bound Prepare survives schema correction without another begin or Task identity', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const started = await handleHostHook({
      adapter: 'codex',
      event: 'session-start',
      payload: hookPayload(root, 'correction-session', 'SessionStart'),
    });
    const bindingToken = additionalContext(started.wireOutput)
      .match(/[a-f0-9]{64}\.[a-f0-9]{32}/)![0];
    const begun = beginHostSession({ projectRoot: root, adapter: 'codex', bindingToken });
    const documentPath = join(root, begun.reservation.path);
    const invalid = JSON.parse(readFileSync(documentPath, 'utf8')) as Record<string, unknown>;
    invalid.schemaVersion = 'unsupported';
    writeFileSync(documentPath, `${JSON.stringify(invalid)}\n`, 'utf8');

    await assert.rejects(
      prepareDelegationTask({
        projectRoot: root,
        inputPath: begun.reservation.path,
        productVersion: PRODUCT_VERSION,
      }),
      (error: unknown) => {
        const correction = (error as {
          inputCorrection?: { retry?: { path: string; inputReissued: boolean } };
        }).inputCorrection;
        assert.equal(correction?.retry?.path, begun.reservation.path);
        assert.equal(correction?.retry?.inputReissued, true);
        return true;
      },
    );
    assert.equal(existsSync(documentPath), true);
    assert.throws(() => beginHostSession({
      projectRoot: root,
      adapter: 'codex',
      bindingToken,
    }), /already consumed/);

    const corrected = JSON.parse(readFileSync(documentPath, 'utf8')) as Record<string, unknown>;
    corrected.schemaVersion = '1';
    corrected.repositoryEvidence = [];
    corrected.assurance = {
      kind: 'routine',
      rationale: 'No material adoption condition is needed for this Hook recovery fixture.',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
    };
    (corrected.developerEvents as Array<{ content: string }>)[0].content = 'Exercise Hook recovery.';
    (corrected.task as { desiredOutcome: string }).desiredOutcome = 'Exercise Hook recovery.';
    delete corrected.checks;
    corrected.noCommandRationale = 'This Hook recovery fixture needs only repository-diff collection.';
    writeFileSync(documentPath, `${JSON.stringify(corrected)}\n`, 'utf8');
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath: begun.reservation.path,
      productVersion: PRODUCT_VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskId, begun.taskId);

    const stopped = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'correction-session', 'Stop'),
    });
    assert.match(String(stopped.wireOutput.reason), /Current action: implement-and-collect/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Stop delivers each exact pending action once without scanning another task', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const started = await handleHostHook({
      adapter: 'codex',
      event: 'session-start',
      payload: hookPayload(root, 'bound-session', 'SessionStart'),
    });
    const token = additionalContext(started.wireOutput)
      .match(/[a-f0-9]{64}\.[a-f0-9]{32}/)![0];
    const begun = beginHostSession({ projectRoot: root, adapter: 'codex', bindingToken: token });
    rmSync(join(root, begun.reservation.path));

    const pendingStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'bound-session', 'Stop'),
    });
    assert.equal(pendingStop.wireOutput.decision, 'block');
    assert.match(String(pendingStop.wireOutput.reason), /has not created task/);
    assert.match(String(pendingStop.wireOutput.reason), new RegExp(begun.reservation.path));
    assert.equal(existsSync(join(root, begun.reservation.path)), true);
    const repeatedPendingStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'bound-session', 'Stop'),
    });
    assert.equal(repeatedPendingStop.wireOutput.decision, undefined);
    assert.match(String(repeatedPendingStop.wireOutput.systemMessage), /already delivered/);

    const documentPath = join(root, begun.reservation.path);
    const document = JSON.parse(readFileSync(documentPath, 'utf8')) as Record<string, unknown>;
    document.repositoryEvidence = [];
    document.assurance = {
      kind: 'routine',
      rationale: 'No material adoption condition is needed for this lifecycle fixture.',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
    };
    (document.developerEvents as Array<{ content: string }>)[0].content = 'Exercise Hook lifecycle continuity.';
    (document.task as { desiredOutcome: string }).desiredOutcome = 'Exercise Hook lifecycle continuity.';
    delete document.checks;
    document.noCommandRationale = 'This lifecycle fixture needs only repository-diff collection.';
    writeFileSync(documentPath, `${JSON.stringify(document)}\n`, 'utf8');
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath: begun.reservation.path,
      productVersion: PRODUCT_VERSION,
    });
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskId, begun.taskId);

    const activeStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'bound-session', 'Stop'),
    });
    assert.equal(activeStop.wireOutput.decision, 'block');
    assert.match(String(activeStop.wireOutput.reason), /Current action: implement-and-collect/);
    const repeatedActiveStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'bound-session', 'Stop'),
    });
    assert.equal(repeatedActiveStop.wireOutput.decision, undefined);
    assert.match(String(repeatedActiveStop.wireOutput.systemMessage), /task remains pending/);

    const unrelatedStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'unbound-session', 'Stop'),
    });
    assert.deepEqual(unrelatedStop.wireOutput, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Stop allows one final decision brief to return control without another Agent turn', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const started = await handleHostHook({
      adapter: 'codex',
      event: 'session-start',
      payload: hookPayload(root, 'handoff-session', 'SessionStart'),
    });
    const bindingToken = additionalContext(started.wireOutput)
      .match(/[a-f0-9]{64}\.[a-f0-9]{32}/)![0];
    const begun = beginHostSession({
      projectRoot: root,
      adapter: 'codex',
      bindingToken,
    });
    const preparePath = join(root, begun.reservation.path);
    const prepareDocument = JSON.parse(readFileSync(preparePath, 'utf8')) as Record<string, any>;
    prepareDocument.repositoryEvidence = [];
    prepareDocument.assurance = {
      kind: 'routine',
      rationale: 'No material adoption condition is needed for this final-response fixture.',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
    };
    prepareDocument.developerEvents[0].content = 'Exercise final decision presentation.';
    prepareDocument.task.desiredOutcome = 'Exercise final decision presentation.';
    delete prepareDocument.checks;
    prepareDocument.noCommandRationale = 'This fixture needs only repository-diff collection.';
    writeFileSync(preparePath, `${JSON.stringify(prepareDocument)}\n`, 'utf8');
    const prepared = await prepareDelegationTask({
      projectRoot: root,
      inputPath: begun.reservation.path,
      productVersion: PRODUCT_VERSION,
    });
    assert.equal(prepared.status, 'prepared');

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collectDelegationFacts({
      projectRoot: root,
      taskId: prepared.taskId!,
      productVersion: PRODUCT_VERSION,
    }) as { hostAction: HostAction };
    const packet = hostActionAuthoringPacket(collected.hostAction);
    assert.equal(packet?.inputKind, 'handoff');
    const handoff = structuredClone(packet!.draft) as Record<string, any>;
    handoff.actualChange.behavior = 'The fixture text now contains the requested value.';
    handoff.actualChange.mechanism = ['The text is replaced directly.'];
    handoff.actualChange.importantEffects = ['The repository fixture changed.'];
    handoff.recommendation = {
      action: 'accept',
      rationale: 'Current Runtime facts show the requested routine change.',
      caveats: [],
    };
    await evaluateDelegationHandoff({
      projectRoot: root,
      taskId: prepared.taskId!,
      inputPath: '-',
      input: Readable.from(JSON.stringify(handoff)),
    });

    const stopped = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'handoff-session', 'Stop'),
    });
    assert.equal(stopped.wireOutput.decision, undefined);
    assert.match(String(stopped.wireOutput.systemMessage), /ready for a Human adoption decision/);
    assert.match(String(stopped.wireOutput.systemMessage), /plain text in the final response/);
    assert.match(String(stopped.wireOutput.systemMessage), /Do not invoke an interactive input tool/);

    const repeatedStop = await handleHostHook({
      adapter: 'codex',
      event: 'stop',
      payload: hookPayload(root, 'handoff-session', 'Stop'),
    });
    assert.deepEqual(repeatedStop.wireOutput, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Claude and Codex Hook outputs use the shared thin lifecycle contract', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['codex', 'claude'] });
    for (const adapter of ['codex', 'claude'] as const) {
      const result = await handleHostHook({
        adapter,
        event: 'session-start',
        payload: hookPayload(root, `${adapter}-session`, 'SessionStart'),
      });
      assert.equal(
        (result.wireOutput.hookSpecificOutput as Record<string, unknown>).hookEventName,
        'SessionStart',
      );
      assert.match(additionalContext(result.wireOutput), new RegExp(`--adapter","${adapter}`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI emits Host-native Hook JSON without a Stetra result envelope', async () => {
  const root = createRepository();
  try {
    initializeProject({ projectRoot: root, adapters: ['claude'] });
    const execution = await runCli([
      'host', 'hook', '--adapter', 'claude', '--event', 'session-start', '--json',
    ], {
      input: Readable.from(JSON.stringify(hookPayload(root, 'cli-session', 'SessionStart'))),
    });
    assert.equal(execution.json, true);
    assert.equal(execution.command, 'host hook');
    assert.equal(Object.hasOwn(execution.output as object, 'status'), false);
    const rendered = JSON.parse(formatCliOutput(execution));
    assert.equal(rendered.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(rendered.hookSpecificOutput.additionalContext, /stetra","host","begin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-host-hook-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  writeFileSync(join(root, '.gitignore'), '.stetra/\n', 'utf8');
  writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'initial']);
  return root;
}

function hookPayload(root: string, sessionId: string, event: 'SessionStart' | 'Stop') {
  return {
    session_id: sessionId,
    transcript_path: null,
    cwd: root,
    hook_event_name: event,
    ...(event === 'SessionStart'
      ? { source: 'startup' }
      : { stop_hook_active: false, last_assistant_message: 'done' }),
  };
}

function additionalContext(output: Record<string, unknown>): string {
  return String((output.hookSpecificOutput as Record<string, unknown>).additionalContext);
}

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}
