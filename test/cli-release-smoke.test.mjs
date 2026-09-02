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
  assert.equal(existsSync(join(references, 'recovery.md')), true);
  for (const name of ['change', 'delivery', 'challenge', 'handoff']) {
    assert.equal(existsSync(join(references, `${name}.md`)), false);
  }
  assert.equal(existsSync(join(references, 'routine.md')), false);
  assert.match(readFileSync(join(project, '.agents/skills/stetra/SKILL.md'), 'utf8'), /developerDecisionBrief/);

  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'release@example.invalid']);
  git(project, ['config', 'user.name', 'CLI Release Smoke']);
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'initial']);
  const task = 'Change the packed fixture behavior and preserve the Human adoption decision.';
  const prepareDocument = {
    developerEvents: [{ key: 'request', content: task }],
    task: {
      desiredOutcome: 'Change the exported fixture value with current facts.',
      constraints: ['Human adoption remains explicit.', `Preserve the large Host input: ${'x'.repeat(40_000)}`],
      nonGoals: [], focus: ['src/example.ts'], repositoryEvidenceKeys: [],
    },
    assurance: { kind: 'conditioned', conditions: [{
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
    }] },
    executionBudgetOverride: {
      checkTimeoutMs: 300_000,
      maxDeliveryRepairs: 1,
      timeoutRetry: { mode: 'disabled' },
    },
    verification: {
      mode: 'checks',
      checks: [{
        key: 'fixture-check', rationale: 'Exercise the packed CLI check runner.',
        execution: {
          preparation: [],
          assertion: { argv: [
            process.execPath,
            '-e',
            "const ok=require('node:fs').readFileSync('src/example.ts','utf8').includes('value = 2');process.stdout.write('fixture-check-stdout\\n');process.stderr.write('fixture-check-stderr\\n');process.exit(ok ? 0 : 1)",
          ] },
        },
        executionInputs: [],
        baseline: { mode: 'unknown' },
        verifierSelectors: [
          { kind: 'file', path: 'package.json', role: 'command-definition' },
          { kind: 'file', path: 'src/example.ts', role: 'acceptance-surface' },
        ],
      }],
    },
  };
  const prepareReservation = runInstalledCli([
    'input', 'reserve', project, '--kind', 'prepare', '--json',
  ]);
  assert.equal(prepareReservation.transport, 'owned-file');
  const preparePath = join(project, prepareReservation.path);
  writeFileSync(preparePath, `${JSON.stringify(prepareDocument, null, 2)}\n`, 'utf8');
  const prepared = runInstalledCli([
    'change', 'prepare', project, '--prepare-request', prepareReservation.prepareRequestId,
    '--input', prepareReservation.path, '--json',
  ]);
  assert.equal(prepared.status, 'prepared');
  assert.equal(existsSync(preparePath), false);
  assert.equal('taskContract' in prepared, false);
  const contractDetail = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId, '--section', 'contract', '--json',
  ]);
  assert.equal(
    contractDetail.contract.understanding.desiredOutcome,
    'Change the exported fixture value with current facts.',
  );
  const guard = (knownActionFingerprint) => runInstalledCli([
    'change', 'guard-final', project, '--task', prepared.taskId,
    ...(knownActionFingerprint ? ['--known-action-fingerprint', knownActionFingerprint] : []),
    '--json',
  ]);
  const reserveActionInput = (action) => {
    const argv = [...action.inputBinding.reserve.argv.slice(1)];
    argv[2] = project;
    const reservation = runInstalledCli(argv);
    return {
      draft: JSON.parse(readFileSync(join(project, reservation.path), 'utf8')),
      guide: JSON.parse(readFileSync(join(project, reservation.guide.path), 'utf8')),
      path: reservation.path,
    };
  };
  const preparedGuard = guard();
  assert.equal(preparedGuard.disposition, 'continue-workflow');
  assert.equal(preparedGuard.hostAction.kind, 'implement-and-collect');
  assert.equal(preparedGuard.actionUnchanged, false);
  assert.equal(preparedGuard.stateWritten, false);
  const repeatedGuard = guard(preparedGuard.actionFingerprint);
  assert.equal(repeatedGuard.actionUnchanged, true);
  assert.equal(repeatedGuard.hostAction, null);
  assert.equal(repeatedGuard.actionFingerprint, preparedGuard.actionFingerprint);

  writeFileSync(join(project, 'src/example.ts'), 'export const value = 2;\n', 'utf8');
  const collected = runInstalledCli(['change', 'collect', project, '--task', prepared.taskId, '--json']);
  assert.equal(collected.status, 'facts-collected');
  assert.equal(collected.summary.changedFiles.total, 1);
  assert.equal(collected.summary.changedFiles.operations.modified, 1);
  assert.equal(collected.summary.checks.latestStatuses.passed, 1);
  const attemptDetail = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId, '--section', 'attempts', '--json',
  ]).attempts.find((attempt) => attempt.attemptId === collected.attemptId).facts;
  assert.equal(attemptDetail.changedFiles.total, 1);
  assert.equal(attemptDetail.changedFiles.operations.modified, 1);
  const changedFile = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId,
    '--section', 'changed-file', '--attempt', collected.attemptId,
    '--path', 'src/example.ts', '--json',
  ]).changedFile;
  assert.deepEqual([changedFile.path, changedFile.operation], ['src/example.ts', 'modified']);
  const definitionId = contractDetail.contract.verificationPlan.definitions[0].definitionId;
  const checkAttempt = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId,
    '--section', 'check-attempt', '--attempt', collected.attemptId,
    '--definition', definitionId, '--json',
  ]).checkAttempt;
  assert.equal(checkAttempt.status, 'passed');
  assert.equal(checkAttempt.stdout.byteLength, 21);
  assert.equal(checkAttempt.stderr.byteLength, 21);
  const stdout = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId,
    '--section', 'log', '--attempt', collected.attemptId,
    '--definition', definitionId, '--stream', 'stdout', '--json',
  ]).log.content;
  const stderr = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId,
    '--section', 'log', '--attempt', collected.attemptId,
    '--definition', definitionId, '--stream', 'stderr', '--json',
  ]).log.content;
  assert.match(stdout, /fixture-check-stdout/);
  assert.match(stderr, /fixture-check-stderr/);
  assert.equal(existsSync(join(project, attemptDetail.patch.path)), true);
  assert.equal(collected.hostAction.kind, 'author-handoff');
  assert.equal('authoringPacket' in collected.hostAction, false);
  const collectedInput = reserveActionInput(collected.hostAction);
  assert.ok(collectedInput.draft.conditions.export);
  assert.ok(collectedInput.draft.conditions.export.obligations['fixture-value']);
  assert.ok(collectedInput.draft.reviewDecisions[0].targets.some(
    (target) => target.kind === 'condition'));
  assert.ok(collectedInput.draft.reviewDecisions[0].targets.some(
    (target) => target.kind === 'obligation'));
  assert.equal(collectedInput.draft.reviewDecisions.length, 1);
  assert.equal(collectedInput.guide.schema.included, false);
  assert.equal('inputSchema' in collectedInput.guide, false);
  assert.match(collectedInput.guide.schema.command.argv.join(' '), /--part schema/);
  const handoffInputSchema = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId,
    '--section', 'action-input', '--stage', 'handoff', '--part', 'schema', '--json',
  ]).inputSchema;
  assert.ok(Object.keys(handoffInputSchema).length > 0);

  const handoffPath = join(project, collectedInput.path);
  const handoffDraft = structuredClone(collectedInput.draft);
  handoffDraft.actualChange = {
    behavior: 'The packed fixture now exports value 2 instead of value 1.',
    mechanism: ['The public export is changed at its source definition.'],
    preservedInvariants: ['Human adoption remains explicit.'],
    failureAndRecovery: [],
    importantEffects: ['Consumers now observe the value 2.'],
    materialTradeoffs: [],
  };
  for (const condition of Object.values(handoffDraft.conditions)) {
    condition.status = 'unknown';
    condition.summary = 'The Runtime check passed, but required independent evidence is unavailable.';
    for (const obligation of Object.values(condition.obligations)) {
      obligation.status = 'unknown';
      obligation.falsification = {
        attempt: 'Inspected whether the passing command observes the changed export boundary.',
        observedResult: 'The command result depended on the exported value being 2.',
      };
      obligation.evidenceCoverage = {
        status: 'insufficient',
        rationale: 'The Runtime check does not replace the required independent observation.',
        gaps: ['No trustworthy fresh-context Challenge result is available.'],
      };
      obligation.conclusion =
        'The bounded obligation remains unknown pending direct review.';
    }
  }
  handoffDraft.reviewDecisions[0].question =
    'Does the changed verifier still distinguish the intended exported value?';
  handoffDraft.reviewDecisions[0].adoptionImpact =
    'A verifier that misses the export boundary could support an unsafe adoption.';
  handoffDraft.reviewDecisions[0].nextAction =
    'Inspect the exported value and changed verifier before deciding.';
  handoffDraft.recommendation = {
    action: 'defer',
    rationale: 'The required independent evidence path remains unavailable.',
    caveats: ['The developer must inspect the frozen failure hypothesis directly.'],
  };
  writeFileSync(handoffPath, `${JSON.stringify(handoffDraft, null, 2)}\n`, 'utf8');
  const handoffArgv = [...collected.hostAction.command.argv.slice(1)];
  handoffArgv[2] = project;
  const handedOff = runInstalledCli(handoffArgv);
  assert.equal(handedOff.status, 'needs-attention');
  assert.equal('decisionPacket' in handedOff, false);
  const decisionPacket = runInstalledCli([
    'change', 'explain', project, '--task', prepared.taskId, '--section', 'decision-packet', '--json',
  ]).decisionPacket;
  assert.equal(decisionPacket.runtimeFacts.checks[0].latestAttempt.status, 'passed');
  assert.equal(decisionPacket.actualChange.behavior, 'The packed fixture now exports value 2 instead of value 1.');
  assert.deepEqual(decisionPacket.decision.adoption, { authority: 'human', status: 'pending' });
  assert.equal(handedOff.hostAction.kind, 'present-handoff-and-await-human-decision');
  assert.equal(handedOff.hostAction.command, undefined);
  assert.equal(handedOff.hostAction.developerDecisionBrief.primary.decisionState.adoption, 'pending');
  assert.equal(handedOff.hostAction.developerDecisionBrief.primary.changeMeaning.authority, 'agent-judgment');
  assert.equal(handedOff.hostAction.developerDecisionBrief.primary.runtimeEvidence.authority, 'runtime-fact');
  assert.equal(handedOff.hostAction.developerDecisionBrief.primary.requestedDecision.authority, 'human-decision');
  assert.equal(handedOff.hostAction.developerDecisionBrief.primary.blockers.length > 0, true);
  assert.equal(handedOff.hostAction.presentationRequirements.requiredAttentionIds.length > 0, true);
  assert.equal(handedOff.hostAction.decisionContinuation.requiresNewHumanEvent, true);

  const decisionPath = join(temporary, 'decision.json');
  writeFileSync(decisionPath, `${JSON.stringify({
    humanEvent: { content: 'Accept the packed fixture.' },
    action: 'accepted', reason: 'The current packet is acceptable.',
    exceptions: decisionPacket.attention.map((item) => ({
      attentionId: item.id,
      rationale: 'The exact Attention item was inspected and is accepted for this bounded fixture.',
    })),
  })}\n`, 'utf8');
  const decided = runInstalledCli(['change', 'decide', project, '--task', prepared.taskId, '--input', decisionPath, '--json']);
  assert.equal(decided.decisionStatus, 'accepted');
  assert.equal(decided.externalEffects.committed, false);
  const explained = runInstalledCli(['change', 'explain', project, '--task', prepared.taskId, '--section', 'events', '--json']);
  assert.deepEqual(explained.events.map((event) => event.type), [
    'task-prepared', 'facts-collected', 'handoff-evaluated', 'decision-recorded',
  ]);
  const artifactIndex = runInstalledCli(['change', 'explain', project, '--task', prepared.taskId, '--json']);
  assert.equal(artifactIndex.section, 'index');
  assert.equal(artifactIndex.availableSections.find((section) => section.name === 'events').count, explained.events.length);
  assert.equal('events' in artifactIndex, false);
  assert.equal('contract' in artifactIndex, false);

  const status = runInstalledCli(['status', project, '--json']);
  assert.equal(status.status, 'ready');
  assert.equal(status.controlPlane.kind, 'cli');
  assert.equal(status.installation.status, 'current');
  assert.deepEqual(status.worktree, { status: 'supported' });

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
