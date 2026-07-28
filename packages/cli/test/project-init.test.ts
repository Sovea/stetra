import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CliError } from '../src/errors.ts';
import {
  initializeProject,
  inspectProjectInstallation,
} from '../src/project/init.ts';

test('project init creates and safely upgrades only managed adapter artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-init-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), '# Owner instructions\n', 'utf8');
    const initialized = initializeProject({
      projectRoot: root,
      adapters: ['codex'],
    });
    assert.equal(initialized.status, 'initialized');
    assert.deepEqual(initialized.adapters, ['codex']);
    assert.equal(initialized.counts.create, 6);
    assert.deepEqual(initialized.readiness.required, []);
    assert.ok(initialized.readiness.optional.some((item) =>
      item.code === 'team-checks-absent'));
    assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /# Owner instructions/);
    assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /resonant-code:begin/);
    const skillRoot = join(root, '.agents', 'skills', 'resonant-code');
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    assert.match(skill, /read `references\/change\.md` completely/);
    assert.doesNotMatch(skill, /^metadata:/m);
    assert.match(skill, /Do not surface[\s\S]*routine user updates/);
    assert.match(skill, /semantic decision[\s\S]*verification outcome/);
    const changeReference = readFileSync(
      join(skillRoot, 'references', 'change.md'),
      'utf8',
    );
    assert.match(changeReference, /change complete/);
    assert.match(changeReference, /intended change-scope root/);
    assert.match(changeReference, /attestationPlan\.attentionItems/);
    assert.match(changeReference, /canonical lowercase form/);
    assert.match(
      changeReference,
      /--scope[\s\S]*local\|module\|cross-module\|repository/,
    );
    assert.doesNotMatch(changeReference, /--mode/);
    assert.match(changeReference, /Runtime does not guess them/);
    assert.doesNotMatch(changeReference, /attestedBy/);
    assert.match(changeReference, /verification-required/);
    assert.match(changeReference, /transient check configuration outside the repository/);
    assert.doesNotMatch(changeReference, /not-requested/);
    assert.match(changeReference, /## Align/);
    assert.match(changeReference, /ask one consolidated\s+question/);
    assert.match(changeReference, /not a file write allowlist/);
    assert.match(changeReference, /at most one durable learning/);
    assert.match(changeReference, /perform a contradiction review/);
    assert.match(changeReference, /first try to falsify satisfaction/);
    const setupReference = readFileSync(
      join(skillRoot, 'references', 'setup.md'),
      'utf8',
    );
    assert.match(setupReference, /semantic team policy/);
    assert.match(setupReference, /absent .*checks\.json.*not a readiness failure/s);
    assert.match(setupReference, /"rationale"/);
    const contextReference = readFileSync(
      join(skillRoot, 'references', 'context.md'),
      'utf8',
    );
    assert.match(contextReference, /--fingerprint/);
    assert.match(contextReference, /Host handles[\s\S]*fingerprint binding/);
    assert.equal(inspectProjectInstallation(root).status, 'current');

    const unchanged = initializeProject({ projectRoot: root });
    assert.equal(unchanged.status, 'initialized');
    assert.deepEqual(unchanged.adapters, ['codex']);
    assert.equal(unchanged.counts.unchanged, 6);

    const skillPath = join(root, '.agents', 'skills', 'resonant-code', 'SKILL.md');
    writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}owner edit\n`, 'utf8');
    const blocked = initializeProject({ projectRoot: root });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.counts.blocked, 1);
    assert.match(readFileSync(skillPath, 'utf8'), /owner edit/);
    assert.equal(inspectProjectInstallation(root).status, 'drifted');

    const forced = initializeProject({ projectRoot: root, force: true });
    assert.equal(forced.status, 'initialized');
    assert.equal(forced.counts.force, 1);
    assert.doesNotMatch(readFileSync(skillPath, 'utf8'), /owner edit/);
    assert.equal(inspectProjectInstallation(root).status, 'current');

    writeFileSync(
      join(root, 'AGENTS.md'),
      `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}\nOwner tail\n`,
      'utf8',
    );
    assert.equal(inspectProjectInstallation(root).status, 'current');
    initializeProject({ projectRoot: root });
    assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /Owner tail/);

    writeFileSync(
      join(root, 'AGENTS.md'),
      readFileSync(join(root, 'AGENTS.md'), 'utf8')
        .replace('Use the `resonant-code` CLI', 'Use the owner CLI'),
      'utf8',
    );
    assert.equal(initializeProject({ projectRoot: root }).status, 'blocked');
    initializeProject({ projectRoot: root, force: true });
    const restoredAgentInstructions = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.match(restoredAgentInstructions, /Use the `resonant-code` CLI/);
    assert.match(restoredAgentInstructions, /# Owner instructions/);
    assert.match(restoredAgentInstructions, /Owner tail/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installation inspection reports a missing workflow reference as drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-reference-drift-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    rmSync(
      join(root, '.agents', 'skills', 'resonant-code', 'references', 'context.md'),
    );
    const inspection = inspectProjectInstallation(root);
    assert.equal(inspection.status, 'drifted');
    assert.ok(
      inspection.artifacts.some((artifact) =>
        artifact.path.endsWith('/references/context.md')
        && artifact.status === 'missing'),
    );

    initializeProject({ projectRoot: root });
    assert.equal(inspectProjectInstallation(root).status, 'current');

    const manifestPath = join(root, '.resonant-code', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts = manifest.artifacts.filter(
      (artifact: { path: string }) => !artifact.path.includes('/references/'),
    );
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    assert.equal(inspectProjectInstallation(root).status, 'drifted');
    initializeProject({ projectRoot: root });
    assert.equal(inspectProjectInstallation(root).status, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run writes nothing and managed blocks preserve owner line endings', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-dry-run-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), '# Owner\r\nKeep this\r\n', 'utf8');
    const planned = initializeProject({
      projectRoot: root,
      adapters: ['codex'],
      dryRun: true,
    });
    assert.equal(planned.status, 'planned');
    assert.throws(
      () => readFileSync(join(root, '.resonant-code', 'manifest.json'), 'utf8'),
      /ENOENT/,
    );
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Owner\r\nKeep this\r\n');

    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.ok(content.startsWith('# Owner\r\nKeep this\r\n'));
    assert.equal(content.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(inspectProjectInstallation(root).status, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init surfaces generator drift and rejects manifests from a newer generator', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-version-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });

    const manifestPath = join(root, '.resonant-code', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, generatorVersion: '0.0.0' }, null, 2)}\n`,
      'utf8',
    );
    assert.equal(inspectProjectInstallation(root).status, 'version-drift');
    initializeProject({ projectRoot: root });
    assert.equal(inspectProjectInstallation(root).status, 'current');

    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, generatorVersion: '9.0.0' }, null, 2)}\n`,
      'utf8',
    );
    assert.throws(
      () => initializeProject({ projectRoot: root }),
      /UNSUPPORTED_GENERATOR_VERSION/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init plans all changes before writing when a managed path conflicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-plan-'));
  try {
    mkdirSync(join(root, '.agents', 'skills', 'resonant-code'), { recursive: true });
    writeFileSync(
      join(root, '.agents', 'skills', 'resonant-code', 'SKILL.md'),
      'owner-created skill\n',
      'utf8',
    );
    const blocked = initializeProject({
      projectRoot: root,
      adapters: ['codex'],
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.counts.blocked, 1);
    assert.equal(readFileSync(
      join(root, '.agents', 'skills', 'resonant-code', 'SKILL.md'),
      'utf8',
    ), 'owner-created skill\n');
    assert.throws(
      () => readFileSync(join(root, '.resonant-code', 'manifest.json'), 'utf8'),
      /ENOENT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manifest validation rejects unknown fields with stable issue paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-manifest-schema-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const manifestPath = join(root, '.resonant-code', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, inferredCompatibility: true }, null, 2)}\n`,
      'utf8',
    );
    assert.throws(
      () => inspectProjectInstallation(root),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'INVALID_INPUT');
        assert.match(error.message, /\$/);
        assert.match(error.message, /inferredCompatibility/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
