import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  initializeProject,
  inspectProjectInstallation,
} from '../src/project/init.ts';

test('project init generates only the Semantic Handoff adapter and manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-init-'));
  try {
    const initialized = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(initialized.status, 'initialized');
    assert.equal(initialized.protocol, 'semantic-delegation');
    assert.equal(initialized.schemaVersion, '1');
    assert.equal(initialized.adapterProtocolVersion, '1');
    assert.deepEqual(initialized.readiness, { required: [], recommended: [], optional: [] });

    const skillPath = join(root, '.agents', 'skills', 'resonant-code', 'SKILL.md');
    const changePath = join(root, '.agents', 'skills', 'resonant-code', 'references', 'change.md');
    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(changePath), true);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'resonant-code', 'references', 'bootstrap.md')), false);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'resonant-code', 'references', 'context.md')), false);
    const skill = readFileSync(skillPath, 'utf8');
    const change = readFileSync(changePath, 'utf8');
    assert.match(skill, /Humans own goals, long-lived tradeoffs, exceptions/);
    assert.match(change, /change prepare/);
    assert.match(change, /change collect/);
    assert.match(change, /change finalize/);
    assert.match(change, /handoff-ready.*human review/s);
    assert.match(change, /commandDefinitionPaths.*acceptanceSurfacePaths/s);
    assert.match(change, /resolves only the top-level executable/);
    assert.match(change, /Attention explains adoption impact/);
    assert.match(change, /Review Map.*never substitutes/s);
    assert.match(change, /failed\/unavailable checks, changed verifier surfaces/);
    assert.match(change, /state ownership.*every writer.*later participant/s);
    assert.match(change, /control flow.*cleanup.*async\s+timing boundary/s);
    assert.match(change, /compatibility.*generic implementation owner.*environments/s);
    assert.match(change, /failure\/recovery.*partial execution.*idempotency/s);
    assert.match(change, /passing happy path alone is not a falsification attempt/i);
    assert.match(change, /presentationMarkdown.*unchanged/s);
    assert.doesNotMatch(change, /Playbook|RCCL|ready-for-adoption/);
    const manifest = JSON.parse(readFileSync(join(root, '.resonant-code', 'manifest.json'), 'utf8'));
    assert.equal(manifest.protocol, 'semantic-delegation');
    assert.equal(manifest.schemaVersion, '1');
    assert.equal(manifest.adapterProtocolVersion, '1');
    assert.deepEqual(
      manifest.artifacts.map((artifact: { path: string }) => artifact.path),
      [
        '.agents/skills/resonant-code/references/change.md',
        '.agents/skills/resonant-code/SKILL.md',
        '.gitignore',
        'AGENTS.md',
      ],
    );
    assert.equal(inspectProjectInstallation(root).status, 'current');

    const unchanged = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(unchanged.status, 'initialized');
    assert.equal(unchanged.counts.unchanged, 4);

    writeFileSync(skillPath, `${skill}\nowner note\n`, 'utf8');
    const blocked = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.artifacts.some((artifact) =>
      artifact.path.endsWith('SKILL.md') && artifact.action === 'blocked'));
    assert.match(readFileSync(skillPath, 'utf8'), /owner note/);
    const forced = initializeProject({ projectRoot: root, adapters: ['codex'], force: true });
    assert.equal(forced.status, 'initialized');
    assert.doesNotMatch(readFileSync(skillPath, 'utf8'), /owner note/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installation inspection reports generated adapter drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-drift-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['claude'] });
    const changePath = join(root, '.claude', 'skills', 'resonant-code', 'references', 'change.md');
    rmSync(changePath);
    const inspection = inspectProjectInstallation(root);
    assert.equal(inspection.status, 'drifted');
    assert.ok(inspection.artifacts.some((artifact) =>
      artifact.path.endsWith('change.md') && artifact.status === 'missing'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy artifacts block init without migration or deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-legacy-'));
  try {
    const legacyPath = join(root, '.resonant-code', 'playbook');
    mkdirSync(legacyPath, { recursive: true });
    writeFileSync(join(legacyPath, 'local-augment.yaml'), 'legacy\n', 'utf8');
    const result = initializeProject({ projectRoot: root, adapters: ['codex'], force: true });
    assert.equal(result.status, 'blocked');
    assert.ok(result.artifacts.some((artifact) =>
      artifact.path === '.resonant-code/playbook' && artifact.action === 'blocked'));
    assert.equal(readFileSync(join(legacyPath, 'local-augment.yaml'), 'utf8'), 'legacy\n');
    assert.equal(existsSync(join(root, '.resonant-code', 'manifest.json')), false);
    const inspection = inspectProjectInstallation(root);
    assert.equal(inspection.status, 'legacy');
    assert.deepEqual(inspection.legacyArtifacts, ['.resonant-code/playbook']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run writes nothing and managed blocks preserve owner content', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-dry-run-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'Owner instructions\r\n', 'utf8');
    const planned = initializeProject({ projectRoot: root, adapters: ['codex'], dryRun: true });
    assert.equal(planned.status, 'planned');
    assert.equal(existsSync(join(root, '.resonant-code', 'manifest.json')), false);
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), 'Owner instructions\r\n');
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^Owner instructions\r\n/);
    assert.equal(agents.match(/<!-- resonant-code:begin -->/g)?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new manifest rejects unknown fields and newer generators', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-manifest-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const manifestPath = join(root, '.resonant-code', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, unknown: true })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /unrecognized key|unknown/i);

    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, generatorVersion: '99.0.0' })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /newer CLI/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
