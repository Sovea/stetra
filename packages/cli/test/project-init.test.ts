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

import { DELEGATION_PREPARE_EXAMPLE } from '../src/adapters/templates.ts';
import {
  initializeProject,
  inspectProjectInstallation,
} from '../src/project/init.ts';
import { DelegationPrepareDocumentSchema } from '../src/schemas/delegation.ts';
import {
  compareSemanticVersions,
  PRODUCT_VERSION,
} from '../src/version.ts';

test('generated prepare example is an exact schema-valid document with complete evidence windows', () => {
  const parsed = DelegationPrepareDocumentSchema.parse(DELEGATION_PREPARE_EXAMPLE);
  assert.deepEqual(parsed.repositoryEvidence, [{
    key: 'relevant-source', path: 'src/example.ts', startLine: 1, endLine: 20,
  }]);
});

test('generator versions follow semantic prerelease precedence', () => {
  const ordered = [
    '0.0.1-alpha',
    '0.0.1-alpha.0',
    '0.0.1-alpha.2',
    '0.0.1-alpha.10',
    '0.0.1-beta.0',
    '0.0.1-rc.0',
    '0.0.1',
    '0.1.0-alpha.0',
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(compareSemanticVersions(ordered[index - 1], ordered[index]) < 0);
    assert.ok(compareSemanticVersions(ordered[index], ordered[index - 1]) > 0);
  }
  assert.equal(
    compareSemanticVersions('0.0.1-alpha.0+build.1', '0.0.1-alpha.0+build.2'),
    0,
  );
  assert.throws(() => compareSemanticVersions('0.0.1-alpha.01', '0.0.1'));
});

test('project init generates the Cognitive Adoption host projection and manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-init-'));
  try {
    const initialized = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(initialized.status, 'initialized');
    assert.equal(initialized.protocol, 'cognitive-adoption');
    assert.equal(initialized.schemaVersion, '1');
    assert.equal(initialized.adapterProtocolVersion, '1');
    assert.deepEqual(initialized.readiness, { required: [], recommended: [], optional: [] });

    const skillPath = join(root, '.agents', 'skills', 'stetra', 'SKILL.md');
    const referencesPath = join(root, '.agents', 'skills', 'stetra', 'references');
    const changePath = join(referencesPath, 'change.md');
    const deliveryPath = join(referencesPath, 'delivery.md');
    const challengePath = join(referencesPath, 'challenge.md');
    const handoffPath = join(referencesPath, 'handoff.md');
    const recoveryPath = join(referencesPath, 'recovery.md');
    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(changePath), true);
    assert.equal(existsSync(deliveryPath), true);
    assert.equal(existsSync(challengePath), true);
    assert.equal(existsSync(handoffPath), true);
    assert.equal(existsSync(recoveryPath), true);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'stetra', 'references', 'bootstrap.md')), false);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'stetra', 'references', 'context.md')), false);
    const skill = readFileSync(skillPath, 'utf8');
    const change = readFileSync(changePath, 'utf8');
    const delivery = readFileSync(deliveryPath, 'utf8');
    const challenge = readFileSync(challengePath, 'utf8');
    const handoff = readFileSync(handoffPath, 'utf8');
    const recovery = readFileSync(recoveryPath, 'utf8');
    assert.match(skill, /developer owns goals, long-lived tradeoffs, exceptions/);
    assert.match(skill, /do not reread an\s+unchanged page/);
    assert.match(change, /change prepare/);
    assert.match(change, /developerEvent/);
    assert.match(change, /conditions/);
    assert.match(change, /verifierSelectors/);
    assert.match(change, /\{"mode":"unknown"\}/);
    assert.match(change, /Do not\s+add rationale or obligationKeys to unknown/);
    assert.match(delivery, /baseline-to-current change/);
    assert.match(delivery, /evidence\s+disposition/);
    assert.match(delivery, /fieldRequirements/);
    assert.match(challenge, /fresh Host context/);
    assert.match(challenge, /Challenge output remains Agent judgment/);
    assert.match(challenge, /canonical identities, not paths/);
    assert.match(skill, /owns the final\s+cognitive handoff/);
    assert.match(handoff, /hostAction\.developerDecisionBrief/);
    assert.match(handoff, /Do not execute\s+\*\*hostAction\.decisionContinuation\*\*/);
    assert.match(handoff, /residual-unknown and\s+review-question item shapes/);
    assert.match(handoff, /accepted\/correction-requested\/rejected\/deferred/);
    assert.match(skill, /Preserve paths, IDs, enums, commands, numeric facts/);
    assert.match(recovery, /retry-timed-out-check/);
    assert.match(recovery, /resolve-evidence-decision/);
    assert.match(recovery, /revise-verification/);
    assert.ok(
      Buffer.byteLength(skill) + Buffer.byteLength(change) + Buffer.byteLength(delivery) <= 10_000,
      'the normal delivery instruction projection must stay within 10 KB',
    );
    assert.doesNotMatch(`${change}${delivery}${challenge}${handoff}${recovery}`, /Playbook|RCCL|ready-for-adoption/);
    assert.doesNotMatch(`${skill}${change}${delivery}${challenge}${handoff}${recovery}`, /presentationLocale|presentationMarkdown/);
    const manifest = JSON.parse(readFileSync(join(root, '.stetra', 'manifest.json'), 'utf8'));
    assert.equal(manifest.protocol, 'cognitive-adoption');
    assert.equal(manifest.schemaVersion, '1');
    assert.equal(manifest.generatorVersion, PRODUCT_VERSION);
    assert.equal(manifest.adapterProtocolVersion, '1');
    assert.deepEqual(
      manifest.artifacts.map((artifact: { path: string }) => artifact.path),
      [
        '.agents/skills/stetra/references/challenge.md',
        '.agents/skills/stetra/references/change.md',
        '.agents/skills/stetra/references/delivery.md',
        '.agents/skills/stetra/references/handoff.md',
        '.agents/skills/stetra/references/recovery.md',
        '.agents/skills/stetra/SKILL.md',
        '.gitignore',
        'AGENTS.md',
      ],
    );
    assert.equal(inspectProjectInstallation(root).status, 'current');

    const unchanged = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(unchanged.status, 'initialized');
    assert.equal(unchanged.counts.unchanged, 8);

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
  const root = mkdtempSync(join(tmpdir(), 'stetra-drift-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['claude'] });
    const changePath = join(root, '.claude', 'skills', 'stetra', 'references', 'change.md');
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
  const root = mkdtempSync(join(tmpdir(), 'stetra-legacy-'));
  try {
    const legacyPath = join(root, '.stetra', 'playbook');
    mkdirSync(legacyPath, { recursive: true });
    writeFileSync(join(legacyPath, 'local-augment.yaml'), 'legacy\n', 'utf8');
    const result = initializeProject({ projectRoot: root, adapters: ['codex'], force: true });
    assert.equal(result.status, 'blocked');
    assert.ok(result.artifacts.some((artifact) =>
      artifact.path === '.stetra/playbook' && artifact.action === 'blocked'));
    assert.equal(readFileSync(join(legacyPath, 'local-augment.yaml'), 'utf8'), 'legacy\n');
    assert.equal(existsSync(join(root, '.stetra', 'manifest.json')), false);
    const inspection = inspectProjectInstallation(root);
    assert.equal(inspection.status, 'legacy');
    assert.deepEqual(inspection.legacyArtifacts, ['.stetra/playbook']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renamed Resonant Code installation blocks Stetra init without mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-renamed-product-'));
  try {
    const oldRunPath = join(root, '.resonant-code', 'runs', 'old-run', 'run.json');
    mkdirSync(join(root, '.resonant-code', 'runs', 'old-run'), { recursive: true });
    writeFileSync(oldRunPath, '{"state":"completed"}\n', 'utf8');
    writeFileSync(
      join(root, 'AGENTS.md'),
      '<!-- resonant-code:begin -->\nold generated pointer\n<!-- resonant-code:end -->\n',
      'utf8',
    );

    const result = initializeProject({ projectRoot: root, adapters: ['codex'], force: true });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.path),
      ['.resonant-code', 'AGENTS.md'],
    );
    assert.equal(readFileSync(oldRunPath, 'utf8'), '{"state":"completed"}\n');
    assert.equal(existsSync(join(root, '.stetra')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run writes nothing and managed blocks preserve owner content', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-dry-run-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'Owner instructions\r\n', 'utf8');
    const planned = initializeProject({ projectRoot: root, adapters: ['codex'], dryRun: true });
    assert.equal(planned.status, 'planned');
    assert.equal(existsSync(join(root, '.stetra', 'manifest.json')), false);
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), 'Owner instructions\r\n');
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^Owner instructions\r\n/);
    assert.equal(agents.match(/<!-- stetra:begin -->/g)?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new manifest rejects unknown fields and newer generators', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-manifest-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const manifestPath = join(root, '.stetra', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, unknown: true })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /unrecognized key|unknown/i);

    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      generatorVersion: '99.0.0-alpha.0',
    })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /newer CLI/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
