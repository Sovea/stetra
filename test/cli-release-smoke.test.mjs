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

const workspace = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'resonant-cli-release-'));

try {
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  const project = join(temporary, 'project');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"name":"packed-cli-smoke","type":"module"}\n', 'utf8');
  writeFileSync(join(project, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');

  const coreTarball = packPackage(join(workspace, 'packages', 'core'), packDirectory);
  const cliTarball = packPackage(join(workspace, 'packages', 'cli'), packDirectory);
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
    private: true,
    dependencies: {
      '@sovea/resonant-code-core': `file:${coreTarball.replace(/\\/g, '/')}`,
      '@sovea/resonant-code': `file:${cliTarball.replace(/\\/g, '/')}`,
    },
  }, null, 2)}\n`, 'utf8');
  run(npmCommand(), ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);

  const installedCore = join(consumer, 'node_modules', '@sovea', 'resonant-code-core');
  const installedCli = join(consumer, 'node_modules', '@sovea', 'resonant-code');
  const coreManifest = JSON.parse(readFileSync(join(installedCore, 'package.json'), 'utf8'));
  const cliManifest = JSON.parse(readFileSync(join(installedCli, 'package.json'), 'utf8'));
  assert.equal(coreManifest.version, '0.0.1');
  assert.equal(cliManifest.version, '0.0.1');
  assert.equal(cliManifest.dependencies['@sovea/resonant-code-core'], '0.0.1');
  assert.equal(cliManifest.bin['resonant-code'], './dist/index.mjs');
  assert.equal(existsSync(join(installedCore, 'assets')), false);
  const cliEntrypoint = resolve(installedCli, cliManifest.bin['resonant-code']);
  const binary = join(
    consumer,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'resonant-code.cmd' : 'resonant-code',
  );
  assert.equal(run(binary, ['--version'], consumer).stdout.trim(), '0.0.1');
  const runInstalledCli = (args) => runJson(
    process.execPath,
    [cliEntrypoint, ...args],
    consumer,
    { shell: false },
  );

  const initialized = runInstalledCli(['init', project, '--adapter', 'codex', '--json']);
  assert.equal(initialized.status, 'initialized');
  assert.equal(initialized.protocol, 'semantic-delegation');
  assert.deepEqual(initialized.adapters, ['codex']);
  const changeReference = join(
    project,
    '.agents',
    'skills',
    'resonant-code',
    'references',
    'change.md',
  );
  assert.match(readFileSync(changeReference, 'utf8'), /change collect/);
  assert.match(readFileSync(changeReference, 'utf8'), /human review, never adopted/);
  assert.equal(existsSync(join(project, '.agents', 'skills', 'resonant-code', 'references', 'bootstrap.md')), false);

  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'release@example.invalid']);
  git(project, ['config', 'user.name', 'CLI Release Smoke']);
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'initial']);
  const task = 'Change the packed fixture behavior and preserve an inspectable handoff.';
  const inputPath = join(temporary, 'semantic-contract.json');
  writeFileSync(inputPath, `${JSON.stringify({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    humanEvents: [{ id: 'event:task', kind: 'task', content: task }],
    semantic: {
      desiredOutcome: {
        value: 'Change the exported fixture value with a fact-bound handoff.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      constraints: [],
      nonGoals: [],
      focus: [],
      consequence: {
        value: 'medium',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      assuranceDimensions: [{
        dimension: 'behavior',
        criticality: 'adoption-critical',
        rationale: 'The packed fixture behavior determines whether the change can be adopted.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
    },
    verification: {
      checks: [{
        id: 'fixture-check',
        rationale: 'Exercise the packed CLI check runner.',
        argv: [process.execPath, '-e', 'process.exit(0)'],
        timeoutMs: 10_000,
        source: 'host-task',
        commandDefinitionPaths: ['package.json'],
        acceptanceSurfacePaths: [],
      }],
    },
  }, null, 2)}\n`, 'utf8');
  const prepared = runInstalledCli([
    'change', 'prepare', project, '--input', inputPath, '--json',
  ]);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.semanticContract.humanEvents[0].content, task);
  assert.equal(Object.hasOwn(prepared, 'contract'), false);
  const preparedRun = JSON.parse(readFileSync(prepared.details.runPath, 'utf8'));
  assert.equal(preparedRun.workflow, 'semantic-handoff');
  assert.equal(preparedRun.state, 'prepared');
  assert.equal(preparedRun.packageIdentity.core.version, '0.0.1');
  assert.equal(Object.hasOwn(preparedRun, 'pluginRoot'), false);

  writeFileSync(join(project, 'src', 'example.ts'), 'export const value = 2;\n', 'utf8');
  const collected = runInstalledCli([
    'change', 'collect', project, '--run', prepared.runId, '--json',
  ]);
  assert.equal(collected.status, 'facts-collected');
  assert.deepEqual(
    collected.changedFiles.map((file) => [file.path, file.operation]),
    [['src/example.ts', 'modified']],
  );
  assert.equal(collected.checks[0].status, 'passed');
  assert.ok(readFileSync(join(resolve(prepared.details.runPath, '..'), 'change.patch'), 'utf8'));
  const changedFile = collected.changedFiles[0].path;
  writeFileSync(collected.handoffPath, `${JSON.stringify({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    systemMeaningUpdate: 'The packed fixture now exports value 2 instead of value 1.',
    materialClaims: [{
      id: 'claim:behavior',
      dimension: 'behavior',
      statement: 'The fixture export changed from 1 to 2.',
      adoptionConsequence: 'Consumers observe the new exported value.',
      adoptionCritical: true,
      basis: 'agent-judgment',
      evidence: { changedFiles: [changedFile], checks: ['fixture-check'] },
      falsification: {
        failureHypothesis: 'The packed fixture could retain the prior exported value.',
        attempt: 'Inspected the complete patch and ran the frozen fixture check.',
        status: 'supported',
        supportingEvidence: { changedFiles: [changedFile], checks: ['fixture-check'] },
        counterEvidence: {},
        conclusion: 'No conflicting export remained in the complete collected change.',
      },
    }],
    residualUnknowns: [],
    reviewMap: [{
      id: 'review:export',
      priority: 'must-read',
      changedFiles: [changedFile],
      checkIds: ['fixture-check'],
      claimIds: ['claim:behavior'],
      unknownIds: [],
      rationale: 'The only changed file owns the public fixture behavior.',
      prevents: 'Adopting an unintended exported value.',
    }],
  }, null, 2)}\n`, 'utf8');
  const finalized = runInstalledCli([
    'change', 'finalize', project, '--run', prepared.runId, '--json',
  ]);
  assert.equal(finalized.status, 'handoff-ready');
  assert.equal(finalized.state, 'completed');
  assert.match(finalized.humanAuthorityNotice, /human review only/);
  assert.match(finalized.presentationMarkdown, /### Runtime facts/);
  assert.equal(Object.hasOwn(finalized, 'runtimeFacts'), false);
  const explained = runInstalledCli([
    'change', 'explain', project, '--run', prepared.runId, '--json',
  ]);
  assert.equal(explained.state, 'completed');
  assert.equal(explained.evaluation.status, 'handoff-ready');

  const status = runInstalledCli(['status', project, '--json']);
  assert.equal(status.controlPlane.kind, 'cli');
  assert.equal(status.installation.status, 'current');
  const doctor = runInstalledCli(['doctor', project, '--strict', '--json']);
  assert.equal(doctor.status, 'ok');
  assert.equal(doctor.worktree, 'supported');

  const legacy = run(process.execPath, [cliEntrypoint, 'change', 'complete'], consumer, {
    shell: false,
    expectStatus: 2,
  });
  assert.match(legacy.stderr, /unknown command 'complete'/i);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function runJson(command, args, cwd, options) {
  return JSON.parse(run(command, args, cwd, options).stdout);
}

function run(
  command,
  args,
  cwd,
  { shell = process.platform === 'win32', expectStatus = 0 } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell,
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
  const created = readdirSync(destination)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}
