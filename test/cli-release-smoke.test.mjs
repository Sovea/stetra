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
  const entrypoint = resolve(installedCli, cliManifest.bin.stetra);
  const binary = join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'stetra.cmd' : 'stetra');
  assert.equal(run(binary, ['--version'], consumer).stdout.trim(), expectedVersion);
  for (const stage of ['begin', 'handoff', 'decide']) {
    const schema = runJson(entrypoint, ['--json', 'task', stage, '--input-schema'], consumer);
    assert.equal(schema.status, 'input-schema');
    assert.equal(schema.inputSchema.additionalProperties, false);
    assert.ok(schema.example);
  }

  const initialized = runJson(entrypoint, ['--json', 'init', project, '--adapter', 'codex'], consumer);
  assert.equal(initialized.status, 'initialized');
  assert.equal(initialized.schemaVersion, '2');
  assert.deepEqual(initialized.adapters, ['codex']);
  assert.equal(existsSync(join(project, '.agents/skills/stetra/references')), false);
  assert.match(readFileSync(join(project, '.agents/skills/stetra/SKILL.md'), 'utf8'), /stetra task begin/);
  assert.equal(JSON.parse(readFileSync(join(project, '.stetra/config.json'), 'utf8')).admission, 'ask');

  git(project, ['init', '--quiet']);
  git(project, ['config', 'user.email', 'release@example.invalid']);
  git(project, ['config', 'user.name', 'CLI Release Smoke']);
  git(project, ['add', '-A']);
  git(project, ['commit', '--quiet', '-m', 'initial']);

  const hookPayload = JSON.stringify({
    session_id: 'packed-session', cwd: project, hook_event_name: 'SessionStart',
  });
  const hook = runJson(entrypoint, [
    '--json', 'host', 'hook', '--adapter', 'codex', '--event', 'session-start',
  ], consumer, hookPayload);
  const context = hook.hookSpecificOutput.additionalContext;
  const bindingToken = context.match(/--binding-token ([a-z]+\.[a-f0-9]{64}\.[a-f0-9]{32})/)?.[1];
  assert.ok(bindingToken);

  const beginInput = {
    humanEvent: { content: 'Change the packed fixture value to 2.' },
    interpretation: {
      desiredOutcome: 'The exported fixture value is 2.',
      constraints: ['Human adoption remains explicit.'],
      nonGoals: [],
    },
    assurance: { mode: 'routine' },
    verification: {
      mode: 'checks',
      checks: [{
        key: 'fixture-check',
        argv: [
          process.execPath,
          '-e',
          "const ok=require('node:fs').readFileSync('src/example.ts','utf8').includes('value = 2');process.stdout.write('fixture-out\\n');process.stderr.write('fixture-err\\n');process.exit(ok ? 0 : 1)",
        ],
        executionInputs: [{ kind: 'file', path: 'src/example.ts' }],
        verifierSelectors: [{ kind: 'file', path: 'src/example.ts', role: 'acceptance-surface' }],
      }],
    },
  };
  const began = runJson(entrypoint, [
    '--json', 'task', 'begin', project, '--input', '-', '--binding-token', bindingToken,
  ], consumer, JSON.stringify(beginInput));
  assert.equal(began.status, 'task-begun');
  assert.equal(began.phase, 'working');

  writeFileSync(join(project, 'src/example.ts'), 'export const value = 2;\n', 'utf8');
  const collected = runJson(entrypoint, [
    '--json', 'task', 'collect', project, '--task', began.taskId,
  ], consumer);
  assert.equal(collected.status, 'facts-collected');
  assert.equal(collected.phase, 'awaiting-handoff');
  assert.deepEqual(collected.summary.changedFiles.map((file) => file.path), ['src/example.ts']);
  assert.deepEqual(
    collected.summary.checks.map((check) => [check.key, check.status]),
    [['fixture-check', 'passed']],
  );
  const collectionIndex = runJson(entrypoint, [
    '--json', 'task', 'inspect', project, '--task', began.taskId, '--section', 'collections',
  ], consumer).collections;
  const latest = runJson(entrypoint, [
    '--json', 'task', 'inspect', project, '--task', began.taskId,
    '--section', 'collection', '--collection', collectionIndex.at(-1).factCollectionId,
  ], consumer).collection;
  assert.equal(latest.checks[0].attempts[0].stdout.byteLength, 12);
  assert.equal(latest.checks[0].attempts[0].stderr.byteLength, 12);
  assert.equal(existsSync(join(project, latest.checks[0].attempts[0].stdout.logPath)), true);
  assert.equal(existsSync(join(project, latest.patch.path)), true);

  const handedOff = runJson(entrypoint, [
    '--json', 'task', 'handoff', project, '--task', began.taskId, '--input', '-',
  ], consumer, JSON.stringify({
    actualChange: {
      behavior: 'The packed fixture now exports value 2.',
      mechanism: ['The source export literal changed from 1 to 2.'],
      preservedInvariants: ['The export name remains value.'],
    },
    reviewFocus: [{
      question: 'Does the changed export retain its public name?',
      adoptionImpact: 'Renaming it would break consumers.',
      nextAction: 'Inspect src/example.ts.',
      evidence: [
        { kind: 'changed-file', path: 'src/example.ts' },
        { kind: 'check', checkKey: 'fixture-check' },
      ],
    }],
    recommendation: { action: 'accept', rationale: 'The frozen Check passes.' },
  }));
  assert.equal(handedOff.status, 'needs-attention');
  assert.equal(handedOff.decisionBrief.decisionState.adoption.status, 'pending');
  assert.deepEqual(handedOff.decisionBrief.attention.map((item) => item.code), ['verifier-surface-changed']);
  const restored = runJson(entrypoint, [
    '--json', 'task', 'inspect', project, '--task', began.taskId, '--section', 'handoff',
  ], consumer);
  assert.deepEqual(restored.decisionBrief, handedOff.decisionBrief);
  const humanBrief = run(process.execPath, [
    entrypoint, 'task', 'inspect', project, '--task', began.taskId, '--section', 'handoff',
  ], consumer).stdout;
  assert.match(humanBrief, /Renaming it would break consumers/);
  assert.match(humanBrief, /Evidence: src\/example.ts/);

  const decided = runJson(entrypoint, [
    '--json', 'task', 'decide', project, '--task', began.taskId, '--input', '-',
  ], consumer, JSON.stringify({
    humanEvent: { content: 'Accept the packed fixture after reviewing the changed verifier.' },
    action: 'accepted',
    reason: 'The verifier mutation is expected and was directly reviewed.',
    acknowledgeAttention: true,
  }));
  assert.equal(decided.phase, 'complete');
  assert.equal(decided.decision.status, 'accepted');
  const events = runJson(entrypoint, [
    '--json', 'task', 'inspect', project, '--task', began.taskId, '--section', 'events',
  ], consumer).events;
  assert.deepEqual(events.map((event) => event.type), [
    'task-began', 'facts-collected', 'handoff-authored', 'human-decision-recorded',
  ]);
  const stop = runJson(entrypoint, [
    '--json', 'host', 'hook', '--adapter', 'codex', '--event', 'stop',
  ], consumer, JSON.stringify({
    session_id: 'packed-session', cwd: project, hook_event_name: 'Stop',
  }));
  assert.deepEqual(stop, {});
  const nextBegin = { ...beginInput, humanEvent: { content: 'Admit the next packed fixture task.' } };
  const next = runJson(entrypoint, [
    '--json', 'task', 'begin', project, '--binding-token', bindingToken,
  ], consumer, JSON.stringify(nextBegin));
  assert.notEqual(next.taskId, began.taskId);
  const resumed = runJson(entrypoint, [
    '--json', 'task', 'begin', project, '--binding-token', bindingToken,
  ], consumer, JSON.stringify(nextBegin));
  assert.equal(resumed.status, 'task-resumed');
  assert.equal(resumed.taskId, next.taskId);

  const status = runJson(entrypoint, ['--json', 'status', project], consumer);
  assert.equal(status.status, 'ready');
  assert.equal(status.controlPlane.kind, 'cli');
  assert.equal(status.installation.status, 'current');
  const legacy = run(process.execPath, [entrypoint, 'change'], consumer, { expectStatus: 2 });
  assert.match(legacy.stderr, /unknown command 'change'/i);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function runJson(entrypoint, args, cwd, input) {
  return JSON.parse(run(process.execPath, [entrypoint, ...args], cwd, {
    shell: false,
    ...(input === undefined ? {} : { input }),
  }).stdout);
}

function run(command, args, cwd, {
  shell = process.platform === 'win32',
  expectStatus = 0,
  input,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell,
    input,
  });
  assert.equal(result.status, expectStatus, [
    `Command returned unexpected status: ${command} ${args.join(' ')}`,
    result.stdout,
    result.stderr,
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
