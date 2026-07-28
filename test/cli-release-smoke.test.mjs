import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
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

  const coreTarball = packPackage(
    join(workspace, 'packages', 'core'),
    packDirectory,
  );
  const cliTarball = packPackage(
    join(workspace, 'packages', 'cli'),
    packDirectory,
  );
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
  const cliEntrypoint = resolve(
    installedCli,
    cliManifest.bin['resonant-code'],
  );
  assert.ok(readFileSync(join(installedCore, 'assets', 'playbook', 'core.yaml'), 'utf8'));
  assert.ok(readFileSync(cliEntrypoint, 'utf8'));
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

  const initialized = runInstalledCli([
    'init',
    project,
    '--adapter',
    'codex',
    '--json',
  ]);
  assert.equal(initialized.status, 'initialized');
  assert.deepEqual(initialized.adapters, ['codex']);
  writeFileSync(join(project, '.resonant-code', 'checks.json'), JSON.stringify({
    version: '1.0',
    checks: ['typecheck', 'test'].map((id) => ({
      id,
      command: [process.execPath, '-e', 'process.exit(0)'],
      timeoutMs: 10_000,
    })),
  }, null, 2), 'utf8');

  const bootstrap = runInstalledCli([
    'bootstrap',
    'prepare',
    project,
    '--json',
  ]);
  assert.equal(bootstrap.status, 'prepared');
  assert.equal(Object.hasOwn(bootstrap, 'signals'), false);
  assert.match(bootstrap.prompt, /Inspect the repository with your native tools/);
  const bootstrapCandidate = join(project, 'bootstrap-candidate.json');
  writeFileSync(bootstrapCandidate, JSON.stringify({
    selectedLayers: ['builtin/languages/typescript'],
    evidence: [{
      layerId: 'builtin/languages/typescript',
      paths: ['package.json'],
      rationale: 'The inspected package manifest establishes the TypeScript project boundary.',
    }],
  }, null, 2), 'utf8');
  const committedBootstrap = runInstalledCli([
    'bootstrap',
    'commit',
    project,
    '--input',
    bootstrapCandidate,
    '--json',
  ]);
  assert.equal(committedBootstrap.status, 'created');
  const gitignore = readFileSync(join(project, '.gitignore'), 'utf8');
  assert.equal(gitignore.match(/# resonant-code:begin/g)?.length, 1);
  assert.equal(gitignore.match(/# resonant-code:end/g)?.length, 1);
  assert.doesNotMatch(gitignore, /# resonant-code: generated runtime artifacts/);

  const context = runInstalledCli([
    'context',
    'prepare',
    project,
    '--evidence',
    'src/example.ts:1-1',
    '--json',
  ]);
  assert.equal(context.status, 'ready');
  const contextContractPath = join(
    project,
    '.resonant-code',
    'context',
    'rccl-prepare.json',
  );
  mkdirSync(join(project, '.resonant-code', 'context'), { recursive: true });
  writeFileSync(
    contextContractPath,
    `${JSON.stringify(context, null, 2)}\n`,
    'utf8',
  );
  const contextProposalPath = join(
    project,
    '.resonant-code',
    'context',
    'rccl-proposal.json',
  );
  writeFileSync(contextProposalPath, `${JSON.stringify({
    schemaVersion: context.contract.schemaVersion,
    requestId: context.contract.requestId,
    contextFingerprint: context.contract.contextFingerprint,
    replace: false,
    observations: [{
      id: 'obs-packed-example-boundary',
      category: 'architecture',
      scope: 'src/**',
      statement: 'The packed smoke export is defined in src/example.ts.',
      affects: ['api-shape'],
      decisionImpact: 'Defining the export elsewhere would split the tested public shape.',
      semanticConfidence: 'high',
      evidence: [{
        windowId: context.contract.evidenceWindows[0].windowId,
      }],
    }],
  }, null, 2)}\n`, 'utf8');
  const committedContext = runInstalledCli([
    'context',
    'commit',
    project,
    '--contract',
    contextContractPath,
    '--input',
    contextProposalPath,
    '--json',
  ]);
  assert.equal(committedContext.status, 'committed');
  const observationFingerprint =
    committedContext.document.observations[0].lifecycle.contentFingerprint;
  const approvedContext = runInstalledCli([
    'context',
    'approve',
    project,
    '--id',
    'obs-packed-example-boundary',
    '--fingerprint',
    `obs-packed-example-boundary=${observationFingerprint}`,
    '--approved-by',
    'release-smoke-reviewer',
    '--json',
  ]);
  assert.equal(approvedContext.status, 'approved');
  assert.deepEqual(
    approvedContext.approvedObservationIds,
    ['obs-packed-example-boundary'],
  );

  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'release@example.invalid']);
  git(project, ['config', 'user.name', 'CLI Release Smoke']);
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'initial']);

  const prepared = runInstalledCli([
    'change',
    'prepare',
    project,
    '--task',
    'Document the exported example',
    '--change-type',
    'docs',
    '--target',
    'src/example.ts',
    '--risk',
    'low',
    '--scope',
    'local',
    '--guidance-byte-limit',
    '20000',
    '--json',
  ]);
  assert.ok(prepared.status === 'compiled' || prepared.status === 'needs-attention');
  const preparedRun = JSON.parse(readFileSync(prepared.runPath, 'utf8'));
  assert.equal(preparedRun.runId, prepared.runId);
  assert.equal(preparedRun.workflow, 'change');
  assert.equal(preparedRun.state, 'prepared');
  assert.equal(preparedRun.controlPlane.kind, 'cli');
  assert.equal(preparedRun.controlPlane.corePackage, '@sovea/resonant-code-core');
  assert.equal(preparedRun.controlPlane.coreVersion, '0.0.1');
  assert.equal(Object.hasOwn(preparedRun, 'pluginRoot'), false);

  writeFileSync(join(project, 'src', 'example.ts'), 'export const value = 2;\n', 'utf8');
  writeFileSync(prepared.evaluationInputPath, JSON.stringify({
    attestations: attestationsForDecision(prepared),
    exceptions: [],
  }, null, 2), 'utf8');
  const completed = runInstalledCli([
    'change',
    'complete',
    project,
    '--run',
    prepared.runId,
    '--json',
  ]);
  assert.equal(completed.status, 'accepted');
  assert.deepEqual(
    completed.changes.files.map((file) => [file.path, file.status]),
    [['src/example.ts', 'modified']],
  );
  assert.ok(completed.checks.every((check) => check.status === 'passed'));
  const completedRun = JSON.parse(readFileSync(prepared.runPath, 'utf8'));
  assert.equal(completedRun.state, 'completed');
  assert.equal(completedRun.completion.evaluation.evaluationId, completed.evaluationId);
  assert.equal(Object.hasOwn(completedRun, 'completionFacts'), false);

  const status = runInstalledCli(['status', project, '--json']);
  assert.equal(status.controlPlane.kind, 'cli');
  assert.equal(status.installation.status, 'current');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function attestationsForDecision(decision) {
  const items = [
    ...decision.guidance.required.map((item) => ({ ...item, section: 'required' })),
    ...decision.guidance.consider.map((item) => ({ ...item, section: 'consider' })),
    ...decision.guidance.avoid.map((item) => ({ ...item, section: 'avoid' })),
  ];
  const attestations = items.map((item) => {
    const evidenceRefs = [{
      kind: 'diff',
      ref: `diff:${item.id}`,
      file: 'src/example.ts',
    }];
    if (decision.verificationPlan.semanticChecks.some((check) =>
      check.guidanceId === item.id)) {
      evidenceRefs.push({
        kind: 'semantic',
        ref: `semantic:${item.id}`,
        description: `Inspected ${item.id} against the exported module change.`,
      });
    }
    return {
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs,
      explanation: `Inspected ${item.id} against the packed-CLI change.`,
    };
  });
  for (const tension of decision.guidance.tensions) {
    attestations.push({
      guidanceId: tension.id,
      verdict: 'satisfied',
      evidenceRefs: [{
        kind: 'semantic',
        ref: `semantic:${tension.id}`,
        description: tension.resolution,
      }],
      explanation: `Applied the compiled resolution for ${tension.id}.`,
    });
  }
  return attestations;
}

function runJson(command, args, cwd, options) {
  return JSON.parse(run(command, args, cwd, options).stdout);
}

function run(
  command,
  args,
  cwd,
  { shell = process.platform === 'win32' } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell,
  });
  assert.equal(
    result.status,
    0,
    [
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].join('\n'),
  );
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
  run(
    'corepack',
    ['pnpm', 'pack', '--pack-destination', destination],
    packageDirectory,
  );
  const created = readdirSync(destination)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}
