import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.ts';

test('CLI owns init, bootstrap, RCCL, and change prepare without installation paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-flow-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"cli-fixture","type":"module"}\n', 'utf8');
    writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');

    const initialized = await runCli([
      'init',
      root,
      '--adapter',
      'codex',
      '--json',
    ]);
    assert.equal((initialized.output as { status: string }).status, 'initialized');
    assert.equal(initialized.json, true);

    const bootstrap = await runCli(['bootstrap', 'prepare', root, '--json']);
    assert.equal((bootstrap.output as { status: string }).status, 'prepared');
    const bootstrapOutput = bootstrap.output as {
      prompt: string;
      signals?: unknown;
    };
    assert.match(bootstrapOutput.prompt, /Inspect the repository with your native tools/);
    assert.equal(Object.hasOwn(bootstrapOutput, 'signals'), false);

    const bootstrapCandidate = join(root, 'bootstrap-candidate.json');
    writeFileSync(bootstrapCandidate, JSON.stringify({
      selectedLayers: ['builtin/languages/typescript'],
      evidence: [{
        layerId: 'builtin/languages/typescript',
        paths: ['missing-config.json'],
      }],
    }), 'utf8');
    await assert.rejects(
      () => runCli([
        'bootstrap',
        'commit',
        root,
        '--input',
        bootstrapCandidate,
        '--json',
      ]),
      /names a missing repository file/,
    );

    writeFileSync(bootstrapCandidate, JSON.stringify({
      selectedLayers: ['builtin/languages/typescript'],
      evidence: [{
        layerId: 'builtin/languages/typescript',
        paths: ['package.json'],
        rationale: 'The package manifest declares the TypeScript project boundary.',
      }],
    }), 'utf8');
    const committedBootstrap = await runCli([
      'bootstrap',
      'commit',
      root,
      '--input',
      bootstrapCandidate,
      '--json',
    ]);
    assert.equal((committedBootstrap.output as { status: string }).status, 'created');
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    assert.equal(gitignore.match(/# resonant-code:begin/g)?.length, 1);
    assert.equal(gitignore.match(/# resonant-code:end/g)?.length, 1);
    assert.doesNotMatch(gitignore, /# resonant-code: generated runtime artifacts/);

    const context = await runCli([
      'context',
      'prepare',
      root,
      '--evidence',
      'src/example.ts:1-1',
      '--json',
    ]);
    assert.equal((context.output as { status: string }).status, 'ready');

    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'cli@example.invalid']);
    git(root, ['config', 'user.name', 'CLI Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const prepared = await runCli([
      'change',
      'prepare',
      root,
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
    const decision = prepared.output as {
      status: string;
      sessionPath: string;
    };
    assert.ok(decision.status === 'compiled' || decision.status === 'needs-attention');
    assert.ok(decision.sessionPath);
    const session = JSON.parse(readFileSync(decision.sessionPath, 'utf8'));
    assert.equal(session.controlPlane.kind, 'cli');
    assert.equal(session.controlPlane.version, '0.0.1');
    assert.equal(session.controlPlane.corePackage, '@sovea/resonant-code-core');
    assert.equal(session.controlPlane.coreVersion, '0.0.1');
    assert.equal(Object.hasOwn(session, 'pluginRoot'), false);

    const status = await runCli(['status', root, '--json']);
    assert.equal((status.output as {
      controlPlane: { kind: string };
      installation: { status: string };
    }).controlPlane.kind, 'cli');
    assert.equal((status.output as {
      installation: { status: string };
    }).installation.status, 'current');
    const doctor = await runCli(['doctor', root, '--strict', '--json']);
    assert.equal((doctor.output as { status: string }).status, 'blocked');
    assert.equal(doctor.exitCode, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects removed change aliases and validates RCCL through Core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-validation-'));
  try {
    await assert.rejects(
      () => runCli(['change', 'auto', root, '--task', 'Do something']),
      /Unknown change command: auto/,
    );

    mkdirSync(join(root, '.resonant-code'), { recursive: true });
    writeFileSync(
      join(root, '.resonant-code', 'rccl.yaml'),
      'version: "1.0"\nobservations:\n  - id: incomplete\n',
      'utf8',
    );
    const status = await runCli(['status', root, '--json']);
    const output = status.output as {
      sources: { rccl: string };
      readiness: { nextActions: Array<{ code: string }> };
    };
    assert.equal(output.sources.rccl, 'invalid');
    assert.ok(output.readiness.nextActions.some((action) => action.code === 'rccl-invalid'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI returns business guidance overflow as a successful machine result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-overflow-'));
  try {
    writeFileSync(join(root, 'example.ts'), 'export const value = 1;\n', 'utf8');
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'cli@example.invalid']);
    git(root, ['config', 'user.name', 'CLI Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const result = await runCli([
      'change',
      'prepare',
      root,
      '--task',
      'Add an exported feature',
      '--change-type',
      'feature',
      '--target',
      'example.ts',
      '--tech',
      'typescript',
      '--guidance-byte-limit',
      '3000',
      '--json',
    ]);
    assert.equal((result.output as { status: string }).status, 'guidance-overflow');
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}
