import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { formatCliOutput, runCli } from '../src/cli.ts';
import { stableFingerprint, taskIdForPrepareRequest } from '../src/protocol.ts';
import { hostEnvironmentDisclosure } from '../src/runtime-context.ts';
import type { HostAction } from '../src/workflow/host-action.ts';

test('Commander exposes the initial lifecycle without obsolete repair/finalize commands', async () => {
  const rootHelp = String((await runCli(['--help'])).output);
  assert.match(rootHelp, /\bstatus\b/);
  assert.match(rootHelp, /\binput\b/);
  assert.doesNotMatch(rootHelp, /\bdoctor\b/);
  const help = await runCli(['change', '--help']);
  const text = String(help.output);
  for (const command of [
    'prepare', 'collect', 'diagnose', 'revise-verification',
    'handoff', 'decide', 'resolve', 'resume', 'explain',
  ]) {
    assert.match(text, new RegExp(command));
  }
  assert.doesNotMatch(text, /\brepair \[options\]/);
  assert.doesNotMatch(text, /finalize/);
  await assert.rejects(runCli(['host', 'challenge']), /unknown command/);
  await assert.rejects(runCli(['change', 'repair']), /unknown command/);
});

test('owned input carries a large prepare document once without stdin or task state', async () => {
  const root = createRepository();
  const token = 'a'.repeat(64);
  try {
    const reserved = await runCli(['input', 'reserve', root, '--token', token, '--json']);
    assert.deepEqual(reserved.output, {
      transport: 'owned-file',
      path: `.stetra/inbox/${token}.json`,
      token,
      serialization: 'json',
      execution: 'one-shot',
      consume: 'read-and-delete',
      maxBytes: 8 * 1024 * 1024,
      prefilled: false,
      hostEnvironment: hostEnvironmentDisclosure(),
    });
    const inputPath = join(root, `.stetra/inbox/${token}.json`);
    const document = prepareDocument();
    document.task.constraints.push(`Preserve this exact long constraint: ${'x'.repeat(40_000)}`);
    writeFileSync(inputPath, JSON.stringify(document), 'utf8');

    const execution = await runCli([
      'change', 'prepare', root, '--input', `.stetra/inbox/${token}.json`, '--json',
    ]);
    assert.equal((execution.output as { status: string }).status, 'prepared');
    assert.equal(existsSync(inputPath), false);

    await assert.rejects(
      runCli(['change', 'prepare', root, '--input', `.stetra/inbox/${token}.json`, '--json']),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_INPUT',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare reservation materializes an explicit incomplete Draft and exact Guide', async () => {
  const root = createRepository();
  try {
    const reserved = await runCli(['input', 'reserve', root, '--kind', 'prepare', '--json']);
    const output = reserved.output as {
      path: string;
      prefilled: boolean;
      prepareRequestId: string;
      submit: { argv: string[] };
      resume: { argv: string[] };
      guide: { path: string };
      hostEnvironment: ReturnType<typeof hostEnvironmentDisclosure>;
    };
    assert.equal(output.prefilled, true);
    assert.equal(output.hostEnvironment.surface, 'thin-skill');
    assert.equal(output.hostEnvironment.independentChallenge.availability, 'unavailable');
    assert.equal(output.hostEnvironment.verificationExecution.trigger, 'change-collect');
    const draft = JSON.parse(readFileSync(join(root, output.path), 'utf8')) as ReturnType<typeof prepareDocument>;
    assert.equal(draft.protocol, 'cognitive-adoption');
    assert.equal(draft.prepareRequestId, output.prepareRequestId);
    assert.deepEqual(output.submit.argv.slice(0, 4), ['stetra', 'change', 'prepare', '.']);
    assert.deepEqual(output.resume.argv.slice(0, 4), ['stetra', 'change', 'resume', '.']);
    const notCreated = await runCli([
      'change', 'resume', root, '--prepare-request', output.prepareRequestId, '--json',
    ]);
    assert.equal((notCreated.output as { status: string }).status, 'prepare-not-created');
    assert.deepEqual(draft.checks, []);
    assert.equal(draft.assurance.kind, 'routine');
    const guide = JSON.parse(readFileSync(join(root, output.guide.path), 'utf8')) as {
      inputKind: string;
      schema: { included: boolean; command: { argv: string[] } };
    };
    assert.equal(guide.inputKind, 'prepare');
    assert.equal(guide.schema.included, false);
    assert.deepEqual(guide.schema.command.argv.slice(0, 3), ['stetra', 'input', 'schema']);
    const schema = (await runCli([
      'input', 'schema', root, '--kind', 'prepare', '--json',
    ])).output as { inputSchema: Record<string, unknown>; stateWritten: boolean };
    assert.ok(schema.inputSchema.$schema);
    assert.equal(schema.stateWritten, false);
    assert.equal(Object.hasOwn(draft, 'verifierSelectors'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owned input reissues invalid JSON at the same one-shot path and rejects unsafe tokens', async () => {
  const root = createRepository();
  const token = 'b'.repeat(64);
  try {
    await assert.rejects(
      runCli(['input', 'reserve', root, '--token', '../outside', '--json']),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_INPUT',
    );
    await runCli(['input', 'reserve', root, '--token', token, '--json']);
    const inputPath = join(root, `.stetra/inbox/${token}.json`);
    writeFileSync(inputPath, '{invalid', 'utf8');
    await assert.rejects(
      runCli(['change', 'prepare', root, '--input', `.stetra/inbox/${token}.json`, '--json']),
      (error: unknown) => {
        const candidate = error as {
          code?: string;
          inputCorrection?: {
            submittedInput: { preview: { kind: string; byteLength?: number } };
            retry?: { path: string; inputReissued: boolean; command: { argv: string[] } };
          };
        };
        assert.equal(candidate.inputCorrection?.submittedInput.preview.kind, 'invalid-json');
        assert.equal(candidate.inputCorrection?.submittedInput.preview.byteLength, 8);
        assert.equal(candidate.inputCorrection?.retry?.path, `.stetra/inbox/${token}.json`);
        assert.equal(candidate.inputCorrection?.retry?.inputReissued, true);
        assert.deepEqual(candidate.inputCorrection?.retry?.command.argv.slice(0, 4), [
          'stetra', 'change', 'prepare', '.',
        ]);
        return candidate.code === 'INVALID_INPUT';
      },
    );
    assert.equal(existsSync(inputPath), true);
    writeFileSync(inputPath, JSON.stringify(prepareDocument()), 'utf8');
    const prepared = await runCli([
      'change', 'prepare', root, '--input', `.stetra/inbox/${token}.json`, '--json',
    ]);
    assert.equal((prepared.output as { status: string }).status, 'prepared');
    assert.equal(existsSync(inputPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owned Prepare schema correction keeps its request identity and writes no task state', async () => {
  const root = createRepository();
  try {
    const reserved = (await runCli([
      'input', 'reserve', root, '--kind', 'prepare', '--json',
    ])).output as { path: string; prepareRequestId: string };
    const inputPath = join(root, reserved.path);
    const document = JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, unknown>;
    document.schemaVersion = 'unsupported';
    writeFileSync(inputPath, `${JSON.stringify(document)}\n`, 'utf8');

    await assert.rejects(
      runCli(['change', 'prepare', root, '--input', reserved.path, '--json']),
      (error: unknown) => {
        const candidate = error as {
          inputCorrection?: {
            retry?: { path: string; inputReissued: boolean };
            stateWritten: boolean;
          };
        };
        assert.equal(candidate.inputCorrection?.retry?.path, reserved.path);
        assert.equal(candidate.inputCorrection?.retry?.inputReissued, true);
        assert.equal(candidate.inputCorrection?.stateWritten, false);
        return true;
      },
    );
    assert.equal(existsSync(join(root, '.stetra', 'tasks')), false);

    const retried = JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, unknown>;
    assert.equal(retried.prepareRequestId, reserved.prepareRequestId);
    retried.schemaVersion = '1';
    retried.repositoryEvidence = [];
    retried.assurance = {
      kind: 'routine',
      rationale: 'No material adoption condition is needed for this transport fixture.',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
    };
    (retried.developerEvents as Array<{ content: string }>)[0].content = 'Exercise owned Prepare recovery.';
    (retried.task as { desiredOutcome: string }).desiredOutcome = 'Exercise owned Prepare recovery.';
    delete retried.checks;
    retried.noCommandRationale = 'This transport fixture needs only repository-diff collection.';
    writeFileSync(inputPath, `${JSON.stringify(retried)}\n`, 'utf8');
    const prepared = (await runCli([
      'change', 'prepare', root, '--input', reserved.path, '--json',
    ])).output as { status: string; taskId: string };
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskId, taskIdForPrepareRequest(reserved.prepareRequestId));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owned Prepare preflight rejection reissues the exact continuation before Task publication', async () => {
  const root = createRepository();
  try {
    const reserved = (await runCli([
      'input', 'reserve', root, '--kind', 'prepare', '--json',
    ])).output as { path: string; prepareRequestId: string };
    const inputPath = join(root, reserved.path);
    const document = prepareDocument() as {
      prepareRequestId: string;
      checks: Array<{ execution: { assertion: { argv: string[] } } }>;
    };
    document.prepareRequestId = reserved.prepareRequestId;
    document.checks[0].execution.assertion.argv[0] = 'stetra-deliberately-unavailable';
    writeFileSync(inputPath, `${JSON.stringify(document)}\n`, 'utf8');

    const rejected = (await runCli([
      'change', 'prepare', root, '--input', reserved.path, '--json',
    ])).output as {
      status: string;
      taskCreated: boolean;
      hostAction: {
        kind: string;
        prepareContinuation?: {
          prepareRequestId: string;
          taskId: string;
          input: { path: string };
          command: { argv: string[] };
        };
      };
    };
    assert.equal(rejected.status, 'verification-required');
    assert.equal(rejected.taskCreated, false);
    assert.equal(rejected.hostAction.kind, 'configure-verification');
    assert.equal(rejected.hostAction.prepareContinuation?.prepareRequestId, reserved.prepareRequestId);
    assert.equal(rejected.hostAction.prepareContinuation?.input.path, reserved.path);
    assert.deepEqual(rejected.hostAction.prepareContinuation?.command.argv.slice(0, 4), [
      'stetra', 'change', 'prepare', '.',
    ]);
    assert.equal(existsSync(inputPath), true);
    assert.equal(existsSync(join(root, '.stetra', 'tasks')), false);

    const retried = JSON.parse(readFileSync(inputPath, 'utf8')) as {
      checks: Array<{ execution: { assertion: { argv: string[] } } }>;
    };
    retried.checks[0].execution.assertion.argv = [process.execPath, '-e', 'process.exit(0)'];
    writeFileSync(inputPath, `${JSON.stringify(retried)}\n`, 'utf8');
    const prepared = (await runCli([
      'change', 'prepare', root, '--input', reserved.path, '--json',
    ])).output as { status: string; taskId: string };
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskId, rejected.hostAction.prepareContinuation?.taskId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owned Prepare clarification preserves the exact Draft until a new Human event is supplied', async () => {
  const root = createRepository();
  try {
    const reserved = (await runCli([
      'input', 'reserve', root, '--kind', 'prepare', '--json',
    ])).output as { path: string; prepareRequestId: string };
    const document: any = prepareDocument();
    document.prepareRequestId = reserved.prepareRequestId;
    document.materialDecisionForks = [{
      key: 'compatibility-policy',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      question: 'Which compatibility policy should govern this fixture?',
      alternatives: [
        { key: 'strict', statement: 'Preserve compatibility.', impact: 'Callers remain compatible.' },
        { key: 'break', statement: 'Allow a break.', impact: 'Callers must adapt.' },
      ],
      recommendation: {
        alternativeKey: 'strict',
        rationale: 'The current event does not authorize a break.',
      },
    }];
    const inputPath = join(root, reserved.path);
    writeFileSync(inputPath, `${JSON.stringify(document)}\n`, 'utf8');

    const blocked = (await runCli([
      'change', 'prepare', root, '--input', reserved.path, '--json',
    ])).output as {
      status: string;
      hostAction: {
        clarificationContinuation?: { requiresNewHumanEvent: boolean };
        prepareContinuation?: {
          prepareRequestId: string;
          requiresNewHumanEvent: boolean;
          input: { path: string };
        };
      };
    };
    assert.equal(blocked.status, 'semantic-decision-required');
    assert.equal(blocked.hostAction.clarificationContinuation?.requiresNewHumanEvent, true);
    assert.equal(blocked.hostAction.prepareContinuation?.requiresNewHumanEvent, true);
    assert.equal(blocked.hostAction.prepareContinuation?.prepareRequestId, reserved.prepareRequestId);
    assert.equal(blocked.hostAction.prepareContinuation?.input.path, reserved.path);
    assert.deepEqual(JSON.parse(readFileSync(inputPath, 'utf8')), document);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('default Prepare output does not expand the repository baseline', async () => {
  const root = createRepository();
  try {
    for (let index = 0; index < 300; index += 1) {
      writeFileSync(join(root, `tracked-${index}.txt`), `${index}\n`, 'utf8');
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'large baseline fixture'], { cwd: root });
    const execution = await runCli([
      'change', 'prepare', root, '--input', '-', '--json',
    ], { input: jsonStream({ ...prepareDocument(), prepareRequestId: 'prepare:large-baseline' }) });
    const output = execution.output as {
      taskId: string;
      summary: { baseline: { entryCount: number } };
      details: { recommended: Array<{ section: string }> };
    };
    const serialized = formatCliOutput(execution);
    assert.equal(output.summary.baseline.entryCount > 300, true);
    assert.ok(Buffer.byteLength(serialized) < 16 * 1024);
    assert.doesNotMatch(serialized, /tracked-299\.txt/);
    assert.deepEqual(output.details.recommended.map((item) => item.section), ['contract']);

    const detail = await runCli([
      'change', 'explain', root, '--task', output.taskId, '--section', 'baseline', '--json',
    ]);
    const baselineJson = formatCliOutput(detail);
    assert.ok(Buffer.byteLength(baselineJson) < 16 * 1024);
    assert.doesNotMatch(baselineJson, /tracked-299\.txt/);
    const entry = (await runCli([
      'change', 'explain', root, '--task', output.taskId,
      '--section', 'baseline-entry', '--path', 'tracked-299.txt', '--json',
    ])).output as { entry: { path: string } };
    assert.equal(entry.entry.path, 'tracked-299.txt');
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
      hostAction: HostAction;
      actionFingerprint: string;
      hostEnvironment: ReturnType<typeof hostEnvironmentDisclosure>;
      summary: {
        contract: { conditionCount: number; obligationCount: number; checkCount: number };
        baseline: { baselineCheckStatusCounts: Record<string, number> };
      };
    };
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.summary.contract.conditionCount, 1);
    assert.equal(prepared.summary.contract.obligationCount, 1);
    assert.equal(prepared.summary.contract.checkCount, 1);
    assert.deepEqual(prepared.summary.baseline.baselineCheckStatusCounts, {});
    assert.equal(prepared.actionFingerprint, stableFingerprint(prepared.hostAction));
    assert.equal(prepared.hostEnvironment.verificationExecution.directHostExecution, 'agent-evidence-only');
    assert.equal(prepareExecution.json, true);
    const preparedJson = formatCliOutput(prepareExecution);
    assert.ok(Buffer.byteLength(preparedJson) < 16 * 1024);
    assert.equal('taskContract' in prepared, false);
    assert.equal('baselineVerification' in prepared, false);
    assert.doesNotMatch(preparedJson, /\u001b\[/);
    assert.ok(preparedJson.indexOf('"hostAction"') < preparedJson.indexOf('"status"'));
    assert.match(formatCliOutput({ ...prepareExecution, json: false, color: false }), /Cognitive Adoption task prepared/);

    const contractDetail = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'contract', '--json',
    ])).output as {
      contract: {
        humanEvents: Array<{ id: string }>;
        adoptionConditions: Array<{
          key: string;
          obligationCount: number;
        }>;
        verificationPlan: {
          mode: 'checks';
          definitions: Array<{ definitionId: string }>;
        };
      };
    };
    assert.equal(contractDetail.contract.adoptionConditions[0].obligationCount, 1);
    const humanEvent = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'human-event', '--human-event', contractDetail.contract.humanEvents[0].id,
      '--json',
    ])).output as { humanEvent: { content: string } };
    assert.equal(humanEvent.humanEvent.content, 'Change the CLI fixture.');
    const conditionDetail = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'condition', '--condition', 'test', '--json',
    ])).output as { condition: { evidenceObligations: Array<{ key: string }> } };
    assert.equal(conditionDetail.condition.evidenceObligations[0].key, 'check-result');
    await assert.rejects(
      runCli([
        'change', 'explain', root, '--task', prepared.taskId,
        '--section', 'check-attempt', '--json',
      ]),
      /requires --attempt <attempt-id-or-baseline> and --definition <id>/,
    );
    const resumed = await runCli([
      'change', 'resume', root, '--prepare-request', prepareDocument().prepareRequestId, '--json',
    ]);
    assert.equal((resumed.output as { taskId: string }).taskId, prepared.taskId);

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collectExecution = await runCli([
      'change', 'collect', root, '--task', prepared.taskId, '--json',
    ]);
    const collected = collectExecution.output as {
      status: string;
      attemptId: string;
      summary: {
        changedFiles: { total: number };
        checks: { total: number; latestStatuses: Record<string, number> };
        checkComparisons: Record<string, number>;
      };
      hostAction: HostAction;
    };
    assert.equal(collected.status, 'facts-collected');
    assert.equal(collected.summary.changedFiles.total, 1);
    assert.equal(collected.summary.checks.latestStatuses.passed, 1);
    assert.equal(collected.summary.checkComparisons['baseline-unknown'], 1);
    assert.match(formatCliOutput({ ...collectExecution, json: false, color: false }), /Checks:/);
    const collectedJson = formatCliOutput(collectExecution);
    assert.ok(Buffer.byteLength(collectedJson) < 16 * 1024);
    assert.doesNotMatch(collectedJson, /"inputSchema"|"authoringPacket"/);
    const detachedAction = JSON.parse(JSON.stringify(collected.hostAction)) as HostAction;
    assert.equal('authoringPacket' in collected.hostAction, false);
    const guide = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'action-input', '--stage', 'handoff', '--part', 'guide', '--json',
    ])).output as {
      guide: {
        schema: { included: boolean; command: { argv: string[] } };
        details: { commands: unknown[] };
      };
    };
    assert.equal(guide.guide.schema.included, false);
    assert.match(guide.guide.schema.command.argv.join(' '), /--part schema/);
    assert.equal('fieldRules' in guide.guide, false);
    assert.deepEqual(guide.guide.details.commands, []);
    const schema = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'action-input', '--stage', 'handoff', '--part', 'schema', '--json',
    ])).output as { inputSchema: Record<string, unknown> };
    assert.ok(Object.keys(schema.inputSchema).length > 0);

    const attemptsExecution = await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'attempts', '--json',
    ]);
    const attemptFacts = (attemptsExecution.output as any).attempts
      .find((attempt: any) => attempt.attemptId === collected.attemptId).facts;
    assert.equal(attemptFacts.changedFiles.total, 1);
    assert.ok(Buffer.byteLength(formatCliOutput(attemptsExecution)) < 16 * 1024);
    const definitionId = contractDetail.contract.verificationPlan.definitions[0].definitionId;
    const exactCheck = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'check-attempt', '--attempt', collected.attemptId,
      '--definition', definitionId, '--json',
    ])).output as { checkAttempt: { status: string; stdout: { persistedBytes: number } } };
    assert.equal(exactCheck.checkAttempt.status, 'passed');
    assert.equal(exactCheck.checkAttempt.stdout.persistedBytes > 0, true);
    const exactLog = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'log', '--attempt', collected.attemptId,
      '--definition', definitionId, '--stream', 'stdout', '--tail-bytes', '8', '--json',
    ])).output as { log: { content: string; returnedBytes: number; omittedPersistedBytes: number } };
    assert.equal(exactLog.log.content, 'heck-ok\n');
    assert.equal(exactLog.log.returnedBytes, 8);
    assert.equal(exactLog.log.omittedPersistedBytes > 0, true);
    const reserveArgv = [...detachedAction.inputBinding!.reserve.argv.slice(1)];
    reserveArgv[2] = root;
    const handoffReservation = (await runCli(reserveArgv)).output as {
      path: string;
      guide: { path: string };
    };
    const handoffPath = join(root, handoffReservation.path);
    const guidePath = join(root, handoffReservation.guide.path);
    const originalGuide = readFileSync(guidePath, 'utf8');
    const invalidHandoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as Record<string, unknown>;
    delete invalidHandoff.actualChange;
    writeFileSync(handoffPath, `${JSON.stringify(invalidHandoff)}\n`, 'utf8');
    const handoffArgv = [...detachedAction.command!.argv.slice(1)];
    handoffArgv[2] = root;
    await assert.rejects(runCli(handoffArgv), (error: unknown) => {
      const correction = (error as {
        inputCorrection?: {
          retry?: { path: string; guidePath?: string; command: { argv: string[] } };
        };
      }).inputCorrection;
      assert.equal(correction?.retry?.path, handoffReservation.path);
      assert.equal(correction?.retry?.guidePath, handoffReservation.guide.path);
      assert.deepEqual(correction?.retry?.command.argv.slice(0, 4), [
        'stetra', 'change', 'handoff', '.',
      ]);
      return true;
    });
    assert.equal(readFileSync(guidePath, 'utf8'), originalGuide);
    writeFileSync(handoffPath, `${JSON.stringify(handoffDocument(
      contractDetail.contract.adoptionConditions[0].key,
      conditionDetail.condition.evidenceObligations[0].key,
      'test',
    ))}\n`, 'utf8');
    const handoffExecution = await runCli(handoffArgv);
    const handedOff = handoffExecution.output as {
      status: string;
      hostAction: HostAction;
      summary: { attentionCount: number };
    };
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal('decisionPacket' in handedOff, false);
    const handedOffJson = formatCliOutput(handoffExecution);
    assert.ok(Buffer.byteLength(handedOffJson) < 16 * 1024);
    assert.doesNotMatch(handedOffJson, /"decisionPacket"|"inputSchema"|"authoringPacket"/);
    const decisionPacket = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'decision-packet', '--json',
    ])).output as { decisionPacket: any };
    assert.equal(decisionPacket.decisionPacket.decision.adoption.status, 'pending');
    assert.equal(decisionPacket.decisionPacket.semanticContract.desiredOutcome, 'Change the CLI fixture.');
    assert.deepEqual(Object.keys(decisionPacket.decisionPacket), [
      'protocol', 'schemaVersion', 'humanEvents', 'semanticContract', 'decision',
      'actualChange', 'residualUnknowns', 'conditions', 'attention', 'reviewDecisions', 'runtimeFacts',
      'evidenceJudgments', 'detailSections',
    ]);
    for (const removedDuplicate of [
      'contract', 'facts', 'handoff', 'evaluation', 'review', 'challenges', 'evidenceDispositions',
    ]) {
      assert.equal(removedDuplicate in decisionPacket.decisionPacket, false);
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

    const handoffDetail = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'handoff', '--json',
    ])).output as { handoff: { actualChange: { behavior: string } } };
    assert.equal(handoffDetail.handoff.actualChange.behavior, 'The CLI fixture changed.');

    assert.ok(handedOff.hostAction.decisionContinuation);
    const decisionContinuation = handedOff.hostAction.decisionContinuation!;
    const decisionReserveArgv = [...decisionContinuation.inputBinding.reserve.argv.slice(1)];
    decisionReserveArgv[2] = root;
    const decisionReservation = (await runCli(decisionReserveArgv)).output as { path: string };
    writeFileSync(join(root, decisionReservation.path), `${JSON.stringify(decisionDocument())}\n`, 'utf8');
    const decisionArgv = [...decisionContinuation.command.argv.slice(1)];
    decisionArgv[2] = root;
    const decisionExecution = await runCli(decisionArgv);
    const decided = decisionExecution.output as {
      status: string; decisionStatus: string; externalEffects: Record<string, boolean>;
    };
    assert.equal(decided.status, 'decision-recorded');
    assert.equal(decided.decisionStatus, 'accepted');
    assert.ok(Object.values(decided.externalEffects).every((value) => value === false));

    const explained = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId, '--section', 'events', '--json',
    ])).output as { events: Array<{ eventId: string; type: string; projection?: unknown }> };
    assert.deepEqual(explained.events.map((event) => event.type), [
      'task-prepared', 'facts-collected', 'handoff-evaluated', 'decision-recorded',
    ]);
    assert.equal(explained.events.every((event) => !('projection' in event)), true);
    const exactEvent = (await runCli([
      'change', 'explain', root, '--task', prepared.taskId,
      '--section', 'event-entry', '--event', explained.events[0].eventId, '--json',
    ])).output as { event: { eventId: string; projection: unknown } };
    assert.equal(exactEvent.event.eventId, explained.events[0].eventId);
    assert.equal('projection' in exactEvent.event, true);
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
    for (const expanded of ['contract', 'attempts', 'challenges', 'events']) {
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
            retry?: unknown;
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
        assert.equal(candidate.inputCorrection?.retry, undefined);
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
    assurance: { kind: 'conditioned', conditions: [{
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
    }] },
    hostPolicyRequirements: [],
    executionBudget: {
      checkTimeoutMs: 300_000,
      maxDeliveryRepairs: 1,
      timeoutRetry: { mode: 'bounded', maxRetriesPerVerifier: 1, maxTimeoutMs: 900_000 },
    },
    checks: [{
      key: 'test', rationale: 'Exercise the fixture.',
      execution: {
        preparation: [],
        assertion: { argv: [process.execPath, '-e', 'console.log("check-ok")'] },
      },
      executionInputs: [],
      baseline: { mode: 'unknown' },
      verifierSelectors: [],
    }],
  };
}

function handoffDocument(conditionKey: string, obligationKey: string, checkKey: string) {
  return {
    actualChange: {
      behavior: 'The CLI fixture changed.',
      mechanism: ['The fixture source is updated directly.'],
      preservedInvariants: ['Human adoption remains explicit.'],
      failureAndRecovery: [],
      importantEffects: ['Fixture behavior changed.'],
      materialTradeoffs: [],
    },
    conditions: [{
      conditionKey,
      status: 'supported',
      summary: 'The check passed.',
      reviewDecisionKeys: [],
      obligations: [{
        obligationKey,
        status: 'supported',
        reviewDecisionKeys: [],
        evidence: [{ kind: 'check', key: checkKey }],
        evidenceCoverage: {
          status: 'sufficient',
          rationale: 'The exact frozen check covers the bounded fixture conclusion.',
          gaps: [],
        },
        falsification: {
          attempt: 'Checked whether the frozen command misses the changed fixture path.',
          observedResult: 'The frozen command completed against the current fixture.',
        },
        counterEvidence: [],
        conclusion: 'The bounded observation supports the obligation.',
      }],
    }],
    residualUnknowns: [],
    reviewDecisions: [],
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
