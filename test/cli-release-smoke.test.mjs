import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { join, resolve } from 'node:path';

import { verifyReleaseInstallation } from '../scripts/verify-release-install.mjs';

const workspace = resolve(import.meta.dirname, '..');
const sourceCoreManifest = JSON.parse(readFileSync(resolve(workspace, 'packages/core/package.json'), 'utf8'));
const sourceCliManifest = JSON.parse(readFileSync(resolve(workspace, 'packages/cli/package.json'), 'utf8'));
assert.equal(sourceCoreManifest.version, sourceCliManifest.version);
const expectedVersion = sourceCoreManifest.version;
const temporary = mkdtempSync(join(tmpdir(), 'stetra-cli-release-'));

try {
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  const project = join(temporary, 'project');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"name":"packed-cli-smoke","type":"module"}\n', 'utf8');
  writeFileSync(join(project, 'src/example.ts'), 'export const value = 1;\n', 'utf8');

  const coreTarball = packPackage(join(workspace, 'packages/core'), packDirectory);
  const cliTarball = packPackage(join(workspace, 'packages/cli'), packDirectory);
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
    private: true,
    dependencies: {
      '@sovea/stetra-core': `file:${coreTarball.replace(/\\/g, '/')}`,
      '@sovea/stetra': `file:${cliTarball.replace(/\\/g, '/')}`,
    },
  }, null, 2)}\n`, 'utf8');
  run(npmCommand(), ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  await verifyReleaseInstallation(consumer, expectedVersion);
  const hostSurfacePath = join(consumer, 'host-surface.mjs');
  writeFileSync(hostSurfacePath, [
    "import { guardFinalResponse, HostChallengeLifecycle, runCli } from '@sovea/stetra/host';",
    "const execution = await runCli(['--version'], { interactive: false, color: false });",
    "const lifecycle = new HostChallengeLifecycle('release-smoke');",
    'process.stdout.write(JSON.stringify({',
    '  guardType: typeof guardFinalResponse,',
    '  lifecycleType: typeof lifecycle.observeStart,',
    '  runType: typeof runCli,',
    '  version: execution.output,',
    '}));',
    '',
  ].join('\n'), 'utf8');
  assert.deepEqual(runJson(process.execPath, [hostSurfacePath], consumer, { shell: false }), {
    guardType: 'function',
    lifecycleType: 'function',
    runType: 'function',
    version: expectedVersion,
  });

  const installedCli = join(consumer, 'node_modules/@sovea/stetra');
  const cliManifest = JSON.parse(readFileSync(join(installedCli, 'package.json'), 'utf8'));
  assert.equal(cliManifest.version, expectedVersion);
  assert.equal(cliManifest.dependencies['@sovea/stetra-core'], expectedVersion);
  const cliEntrypoint = resolve(installedCli, cliManifest.bin.stetra);
  const binary = join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'stetra.cmd' : 'stetra');
  assert.equal(run(binary, ['--version'], consumer).stdout.trim(), expectedVersion);
  const runInstalledCli = (args) => runJson(process.execPath, [cliEntrypoint, ...args], consumer, { shell: false });

  const initialized = runInstalledCli(['init', project, '--adapter', 'codex', '--json']);
  assert.equal(initialized.status, 'initialized');
  assert.equal(initialized.protocol, 'cognitive-adoption');
  assert.equal(initialized.schemaVersion, '1');
  assert.deepEqual(initialized.adapters, ['codex']);
  const references = join(project, '.agents/skills/stetra/references');
  for (const name of ['change', 'delivery', 'challenge', 'handoff', 'recovery']) {
    assert.equal(existsSync(join(references, `${name}.md`)), true);
  }
  assert.equal(existsSync(join(references, 'routine.md')), false);
  assert.match(readFileSync(join(references, 'handoff.md'), 'utf8'), /developerDecisionBrief/);

  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'release@example.invalid']);
  git(project, ['config', 'user.name', 'CLI Release Smoke']);
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'initial']);
  const task = 'Change the packed fixture behavior and preserve the Human adoption decision.';
  const preparePath = join(temporary, 'task-contract.json');
  writeFileSync(preparePath, `${JSON.stringify({
    protocol: 'cognitive-adoption', schemaVersion: '1',
    prepareRequestId: 'prepare:cli-release-smoke',
    developerEvents: [{ key: 'request', content: task }],
    repositoryEvidence: [],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change the exported fixture value with current facts.',
      constraints: ['Human adoption remains explicit.'],
      nonGoals: [], focus: ['src/example.ts'],
    },
    materialDecisionForks: [],
    conditions: [{
      key: 'export', statement: 'The packed fixture exports value 2 and its check passes.',
      rationale: 'Consumers observe this exported value.', criticality: 'adoption-critical',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      evidenceObligations: [{
        key: 'fixture-value',
        statement: 'The packed fixture check observes the intended exported value.',
        falsification: {
          failureHypothesis: 'The command may pass without exercising the changed export.',
          scenario: 'Run the packed check against the changed export boundary.',
          supportingObservation: 'The command result depends on the exported value being 2.',
          contradictingObservation: 'The command passes without observing the exported value.',
        },
        strategies: [
          { kind: 'runtime-check', checkKeys: ['fixture-check'] },
          { kind: 'independent-challenge', policy: 'required' },
        ],
      }],
    }],
    hostPolicyRequirements: [],
    delivery: { maxRepairAttempts: 1 },
    checks: [{
      key: 'fixture-check', rationale: 'Exercise the packed CLI check runner.',
      argv: [
        process.execPath,
        '-e',
        "const ok=require('node:fs').readFileSync('src/example.ts','utf8').includes('value = 2');process.stdout.write('fixture-check-stdout\\n');process.stderr.write('fixture-check-stderr\\n');process.exit(ok ? 0 : 1)",
      ],
      baseline: { mode: 'unknown' },
      verifierSelectors: [
        { kind: 'file', path: 'package.json', role: 'command-definition' },
        { kind: 'file', path: 'src/example.ts', role: 'acceptance-surface' },
      ],
    }],
  }, null, 2)}\n`, 'utf8');
  const prepared = runInstalledCli(['change', 'prepare', project, '--input', preparePath, '--json']);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.taskContract.understanding.desiredOutcome.value, 'Change the exported fixture value with current facts.');
  const taskProjection = JSON.parse(readFileSync(prepared.details.taskPath, 'utf8'));
  assert.equal(taskProjection.workflow, 'cognitive-adoption');
  assert.equal(taskProjection.packageIdentity.core.version, expectedVersion);
  const guardPath = join(consumer, 'host-guard.mjs');
  writeFileSync(guardPath, [
    "import { guardFinalResponse } from '@sovea/stetra/host';",
    'const result = await guardFinalResponse({ projectRoot: process.argv[2], taskId: process.argv[3] });',
    'process.stdout.write(JSON.stringify(result));',
    '',
  ].join('\n'), 'utf8');
  const preparedGuard = runJson(
    process.execPath,
    [guardPath, project, prepared.taskId],
    consumer,
    { shell: false },
  );
  assert.equal(preparedGuard.disposition, 'continue-workflow');
  assert.equal(preparedGuard.hostAction.kind, 'implement-and-collect');
  assert.equal(preparedGuard.stateWritten, false);

  writeFileSync(join(project, 'src/example.ts'), 'export const value = 2;\n', 'utf8');
  const collected = runInstalledCli(['change', 'collect', project, '--task', prepared.taskId, '--json']);
  assert.equal(collected.status, 'facts-collected');
  assert.deepEqual(collected.changedFiles.map((file) => [file.path, file.operation]), [['src/example.ts', 'modified']]);
  assert.equal(collected.checks[0].status, 'passed');
  assert.equal(collected.checks[0].stdout.byteLength, 21);
  assert.equal(collected.checks[0].stderr.byteLength, 21);
  assert.match(readFileSync(join(project, collected.checks[0].stdout.logPath), 'utf8'), /fixture-check-stdout/);
  assert.match(readFileSync(join(project, collected.checks[0].stderr.logPath), 'utf8'), /fixture-check-stderr/);
  assert.equal(existsSync(join(project, collected.patch.path)), true);
  assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
  assert.equal(collected.hostAction.challengeExecutionRequest.agentProfile, 'stetra-challenger');

  const challengePath = join(temporary, 'challenge.json');
  assert.equal(collected.hostAction.authoringPacket, undefined);
  assert.match(
    collected.hostAction.challengeExecutionRequest.bindsTo.challengeExecutionPacketFingerprint,
    /^sha256:[0-9a-f]{64}$/,
  );
  const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
  challengeDraft.falsificationAttempt = 'Inspected whether the passing command depends on the changed export.';
  challengeDraft.observedResult = 'The packed command observes value 2 in a Host-observed separate context.';
  challengeDraft.supportingEvidence = [{
    statement: 'The current Runtime check supports the bounded export observation.',
    references: challengeDraft.evidence.checks.map((id) => ({ kind: 'check', id })),
  }];
  challengeDraft.outcome = 'supported';
  challengeDraft.conclusion = 'The bounded observation is supported by the Host-observed Challenge.';
  writeFileSync(challengePath, `${JSON.stringify({
    project,
    taskId: prepared.taskId,
    request: collected.hostAction.challengeExecutionRequest,
    challenge: challengeDraft,
  }, null, 2)}\n`, 'utf8');
  const trustedChallengePath = join(consumer, 'trusted-challenge.mjs');
  writeFileSync(trustedChallengePath, [
    "import { readFileSync } from 'node:fs';",
    "import { Readable } from 'node:stream';",
    "import { HostChallengeLifecycle, runCli } from '@sovea/stetra/host';",
    "const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
    "const lifecycle = new HostChallengeLifecycle('evaluation-runner');",
    'lifecycle.observeStart({',
    '  request: input.request,',
    "  agentType: 'stetra-challenger',",
    "  parentContextId: 'context:packed-implementer',",
    "  challengerContextId: 'context:packed-challenger',",
    "  mutationPolicy: 'host-read-only',",
    '});',
    'const stopped = lifecycle.observeStop({',
    '  requestId: input.request.requestId,',
    "  agentType: 'stetra-challenger',",
    "  challengerContextId: 'context:packed-challenger',",
    '  output: input.challenge,',
    '});',
    "if (stopped.status !== 'completed') throw new Error('Packed Challenge output is invalid.');",
    'const execution = await runCli([',
    "  'change', 'challenge', input.project, '--task', input.taskId, '--input', '-', '--json',",
    '], {',
    '  interactive: false, color: false,',
    '  input: Readable.from([JSON.stringify(stopped.submission)]),',
    '  hostAttestations: {',
    "    provenance: 'evaluation-runner',",
    '    async evaluatePolicies() { return []; },',
    '    verifyChallengeRun: lifecycle.verifyChallengeRun,',
    '  },',
    '});',
    "process.stdout.write(typeof execution.output === 'string' ? execution.output : JSON.stringify(execution.output));",
    '',
  ].join('\n'), 'utf8');
  const challenged = runJson(process.execPath, [trustedChallengePath, challengePath], consumer, {
    shell: false,
  });
  assert.equal(challenged.challenge.independence, 'host-attested');
  assert.equal(challenged.hostAction.kind, 'author-handoff');
  assert.ok(!challenged.hostAction.authoringPacket.outstandingObligations.some(
    (item) => item.code === 'direct-human-review-required',
  ));

  const handoffPath = join(temporary, 'handoff.json');
  const handoffDraft = structuredClone(challenged.hostAction.authoringPacket.draft);
  const changedFileIds = challenged.hostAction.authoringPacket.referenceCatalog.changedFiles
    .map((file) => file.id);
  const checkIds = challenged.hostAction.authoringPacket.referenceCatalog.checks
    .map((check) => check.definitionId);
  handoffDraft.summary = 'The packed fixture now exports value 2 instead of value 1.';
  for (const conclusion of handoffDraft.obligationConclusions) {
    conclusion.status = 'supported';
    conclusion.falsification = {
      attempt: 'Inspected whether the passing command observes the changed export boundary.',
      observedResult: 'The command result depended on the exported value being 2.',
    };
    conclusion.conclusion = 'The current check and Host-attested Challenge support the bounded obligation.';
  }
  for (const conclusion of handoffDraft.conditionConclusions) {
    conclusion.status = 'supported';
    conclusion.summary = 'The current evidence supports the bounded condition.';
  }
  handoffDraft.importantSystemEffects = ['The export is now 2.'];
  for (const question of handoffDraft.reviewQuestions) {
    question.question = 'Does the changed verifier still distinguish the intended exported value?';
    question.evidence = [
      ...changedFileIds.map((id) => ({ kind: 'changed-file', id })),
      ...checkIds.map((id) => ({ kind: 'check', id })),
    ];
  }
  handoffDraft.recommendation = {
    action: 'accept',
    rationale: 'Current facts and the Host-attested Challenge support adoption review.',
    caveats: [],
  };
  writeFileSync(handoffPath, `${JSON.stringify(handoffDraft, null, 2)}\n`, 'utf8');
  const handedOff = runInstalledCli(['change', 'handoff', project, '--task', prepared.taskId, '--input', handoffPath, '--json']);
  assert.equal(handedOff.status, 'needs-attention');
  assert.equal(handedOff.decisionPacket.runtimeFacts.checks[0].latestAttempt.status, 'passed');
  assert.equal(handedOff.decisionPacket.systemMeaning.summary, 'The packed fixture now exports value 2 instead of value 1.');
  assert.deepEqual(handedOff.decisionPacket.decision.adoption, { authority: 'human', status: 'pending' });
  assert.equal(handedOff.hostAction.kind, 'present-handoff-and-await-human-decision');
  assert.equal(handedOff.hostAction.command, undefined);
  assert.equal(handedOff.hostAction.developerDecisionBrief.decisionState.adoption, 'pending');
  assert.equal(handedOff.hostAction.developerDecisionBrief.decisionIssues.length > 0, true);
  assert.equal(handedOff.hostAction.decisionContinuation.requiresNewHumanEvent, true);

  const decisionPath = join(temporary, 'decision.json');
  writeFileSync(decisionPath, `${JSON.stringify({
    humanEvent: { content: 'Accept the packed fixture.' },
    action: 'accepted', reason: 'The current packet is acceptable.',
    exceptions: handedOff.decisionPacket.attention.map((item) => ({
      attentionId: item.id,
      rationale: 'The exact Attention item was inspected and is accepted for this bounded fixture.',
    })),
  })}\n`, 'utf8');
  const decided = runInstalledCli(['change', 'decide', project, '--task', prepared.taskId, '--input', decisionPath, '--json']);
  assert.equal(decided.decisionStatus, 'accepted');
  assert.equal(decided.externalEffects.committed, false);
  const explained = runInstalledCli(['change', 'explain', project, '--task', prepared.taskId, '--section', 'events', '--json']);
  assert.deepEqual(explained.events.map((event) => event.type), [
    'task-prepared', 'facts-collected', 'challenge-recorded', 'handoff-evaluated', 'decision-recorded',
  ]);

  const status = runInstalledCli(['status', project, '--json']);
  assert.equal(status.controlPlane.kind, 'cli');
  assert.equal(status.installation.status, 'current');
  const doctor = runInstalledCli(['doctor', project, '--strict', '--json']);
  assert.equal(doctor.status, 'ok');
  assert.equal(doctor.worktree, 'supported');

  const legacy = run(process.execPath, [cliEntrypoint, 'change', 'finalize'], consumer, {
    shell: false, expectStatus: 2,
  });
  assert.match(legacy.stderr, /unknown command 'finalize'/i);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function runJson(command, args, cwd, options) {
  return JSON.parse(run(command, args, cwd, options).stdout);
}

function run(command, args, cwd, { shell = process.platform === 'win32', expectStatus = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell });
  assert.equal(result.status, expectStatus, [
    `Command returned unexpected status: ${command} ${args.join(' ')}`, result.stdout, result.stderr,
  ].join('\n'));
  return result;
}

function git(projectRoot, args) {
  execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'ignore' });
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function packPackage(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  run('corepack', ['pnpm', 'pack', '--pack-destination', destination], packageDirectory);
  const created = readdirSync(destination).filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}
