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
  delegationPrepareDraft,
  delegationPrepareGuide,
} from '../src/adapters/templates.ts';
import {
  initializeProject,
  inspectProjectInstallation,
} from '../src/project/init.ts';
import {
  PrepareAuthoringDocumentSchema,
  type PrepareAuthoringDocument,
} from '../src/schemas/authoring.ts';
import { DEFAULT_EXECUTION_BUDGET } from '../src/workflow/authoring-compiler.ts';

test('generated Prepare draft requires explicit assurance and verification authoring', () => {
  const draft = delegationPrepareDraft();
  const parsed = PrepareAuthoringDocumentSchema.safeParse(draft);
  assert.equal(parsed.success, false);
  assert.equal('protocol' in draft, false);
  assert.equal('prepareRequestId' in draft, false);
  assert.equal(draft.assurance.kind, 'routine');
  assert.deepEqual(draft.verification.checks, []);
  assert.equal(delegationPrepareGuide().schema.included, false);
  assert.equal('inputSchema' in delegationPrepareGuide(), false);
  assert.ok(Buffer.byteLength(JSON.stringify(delegationPrepareGuide())) < 4 * 1024);
});

test('prepare rejects a bounded timeout retry that cannot increase the attempt budget', () => {
  const draft = delegationPrepareDraft();
  const input: PrepareAuthoringDocument = PrepareAuthoringDocumentSchema.parse({
    ...draft,
    developerEvents: [{ key: 'request', content: 'Exercise timeout validation.' }],
    task: { ...draft.task, desiredOutcome: 'Exercise timeout validation.' },
    assurance: {
      ...draft.assurance,
      rationale: 'No material adoption condition is needed for this validation fixture.',
    },
    verification: {
      mode: 'no-command',
      rationale: 'This validation fixture has no executable behavior.',
    },
    executionBudgetOverride: structuredClone(DEFAULT_EXECUTION_BUDGET),
  });
  if (input.executionBudgetOverride?.timeoutRetry.mode !== 'bounded') return;
  input.executionBudgetOverride.timeoutRetry.maxTimeoutMs = input.executionBudgetOverride.checkTimeoutMs;
  const parsed = PrepareAuthoringDocumentSchema.safeParse(input);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.ok(parsed.error.issues.some((issue) =>
    issue.path.join('.') === 'executionBudgetOverride.timeoutRetry.maxTimeoutMs'
    && /must allow more time/.test(issue.message)));
});

test('project init generates the Cognitive Adoption host projection and manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-init-'));
  try {
    const initialized = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(initialized.status, 'initialized');
    assert.equal(initialized.protocol, 'cognitive-adoption');
    assert.equal(initialized.schemaVersion, '1');

    const skillPath = join(root, '.agents', 'skills', 'stetra', 'SKILL.md');
    const referencesPath = join(root, '.agents', 'skills', 'stetra', 'references');
    const recoveryPath = join(referencesPath, 'recovery.md');
    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(recoveryPath), true);
    assert.equal(existsSync(join(root, '.codex', 'agents', 'stetra-challenger.toml')), false);
    assert.equal(existsSync(join(referencesPath, 'change.md')), false);
    assert.equal(existsSync(join(referencesPath, 'delivery.md')), false);
    assert.equal(existsSync(join(referencesPath, 'challenge.md')), false);
    assert.equal(existsSync(join(referencesPath, 'handoff.md')), false);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'stetra', 'references', 'bootstrap.md')), false);
    assert.equal(existsSync(join(root, '.agents', 'skills', 'stetra', 'references', 'context.md')), false);
    const skill = readFileSync(skillPath, 'utf8');
    const recovery = readFileSync(recoveryPath, 'utf8');
    const pointer = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.match(skill, /developer owns intent, long-lived choices,\s+exceptions, and adoption/);
    assert.match(skill, /Follow \*\*hostAction\.kind\*\*/);
    assert.match(skill, /run its \*\*reserve\.argv\*\*/);
    assert.match(skill, /developerDecisionBrief\.primary/);
    assert.match(skill, /Do not invoke an interactive\s+input tool for the adoption decision/);
    assert.match(skill, /thin adapter created an independent Agent context/);
    assert.match(skill, /stetra input reserve \. --kind prepare --json/);
    assert.match(skill, /run its exact \*\*submit\.argv\*\*/);
    assert.match(skill, /Never invoke \*\*stetra host begin\*\*\s+without the projected adapter/);
    assert.doesNotMatch(skill, /stetra host begin \. --json/);
    assert.match(recovery, /retry-timed-out-check/);
    assert.match(recovery, /resolve-evidence-decision/);
    assert.match(recovery, /revise-verification/);
    assert.ok(
      Buffer.byteLength(skill) + Buffer.byteLength(recovery) <= 6_000,
      'the generated Host instruction surface must stay compact',
    );
    assert.doesNotMatch(`${skill}${recovery}`, /loadHostActionInput|submitHostAction|executeChallengeHostAction/);
    assert.doesNotMatch(`${skill}${recovery}`, /presentationLocale|presentationMarkdown/);
    assert.doesNotMatch(`${skill}${recovery}${pointer}`, /\p{Script=Han}/u);
    const manifest = JSON.parse(readFileSync(join(root, '.stetra', 'manifest.json'), 'utf8'));
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /\.stetra\/inbox\//);
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /\.stetra\/host-sessions\//);
    assert.equal(manifest.protocol, 'cognitive-adoption');
    assert.equal(manifest.schemaVersion, '1');
    assert.deepEqual(
      manifest.artifacts.map((artifact: { path: string }) => artifact.path),
      [
        '.agents/skills/stetra/references/recovery.md',
        '.agents/skills/stetra/SKILL.md',
        '.codex/hooks.json',
        '.gitignore',
        'AGENTS.md',
      ],
    );
    assert.equal(inspectProjectInstallation(root).status, 'current');

    const unchanged = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(unchanged.status, 'initialized');
    assert.equal(unchanged.counts.unchanged, 5);

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
    const recoveryPath = join(root, '.claude', 'skills', 'stetra', 'references', 'recovery.md');
    rmSync(recoveryPath);
    const inspection = inspectProjectInstallation(root);
    assert.equal(inspection.status, 'drifted');
    assert.ok(inspection.artifacts.some((artifact) =>
      artifact.path.endsWith('recovery.md') && artifact.status === 'missing'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generated thin adapters coexist with Trellis agents and hook ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-trellis-coexistence-'));
  try {
    const codexHookPath = join(root, '.codex', 'hooks.json');
    const codexTrellisAgentPath = join(root, '.codex', 'agents', 'trellis-check.toml');
    const claudeSettingsPath = join(root, '.claude', 'settings.json');
    const claudeTrellisAgentPath = join(root, '.claude', 'agents', 'trellis-check.md');
    mkdirSync(join(root, '.codex', 'agents'), { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(codexHookPath, '{\n  // Trellis lifecycle ownership\n  "hooks": { "SubagentStart": [] }\n}\n', 'utf8');
    writeFileSync(codexTrellisAgentPath, 'name = "trellis-check"\n', 'utf8');
    writeFileSync(claudeSettingsPath, '{\n  // Trellis lifecycle ownership\n  "hooks": { "PreToolUse": [] }\n}\n', 'utf8');
    writeFileSync(claudeTrellisAgentPath, '---\nname: trellis-check\n---\n', 'utf8');

    const initialized = initializeProject({
      projectRoot: root,
      adapters: ['codex', 'claude'],
    });
    assert.equal(initialized.status, 'initialized');
    const codexHooks = readFileSync(codexHookPath, 'utf8');
    assert.match(codexHooks, /Trellis lifecycle ownership/);
    assert.deepEqual(JSON.parse(codexHooks.replace(/\s*\/\/ Trellis lifecycle ownership\n/, '\n')).hooks.SubagentStart, []);
    assert.match(codexHooks, /stetra host hook --adapter codex --event session-start/);
    assert.match(codexHooks, /stetra host hook --adapter codex --event stop/);
    assert.equal(readFileSync(codexTrellisAgentPath, 'utf8'), 'name = "trellis-check"\n');
    const claudeSettings = readFileSync(claudeSettingsPath, 'utf8');
    assert.match(claudeSettings, /Trellis lifecycle ownership/);
    assert.deepEqual(JSON.parse(claudeSettings.replace(/\s*\/\/ Trellis lifecycle ownership\n/, '\n')).hooks.PreToolUse, []);
    assert.match(claudeSettings, /stetra host hook --adapter claude --event session-start/);
    assert.match(claudeSettings, /stetra host hook --adapter claude --event stop/);
    assert.equal(
      readFileSync(claudeTrellisAgentPath, 'utf8'),
      '---\nname: trellis-check\n---\n',
    );
    for (const skillPath of [
      join(root, '.agents', 'skills', 'stetra', 'SKILL.md'),
      join(root, '.claude', 'skills', 'stetra', 'SKILL.md'),
    ]) {
      const skill = readFileSync(skillPath, 'utf8');
      assert.match(skill, /stetra input reserve \. --kind prepare --json/);
      assert.doesNotMatch(skill, /stetra host begin \. --json/);
    }
    assert.equal(
      existsSync(join(root, '.codex', 'agents', 'stetra-challenger.toml')),
      false,
    );
    assert.equal(
      existsSync(join(root, '.claude', 'agents', 'stetra-challenger.md')),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('project init protects only the Stetra-owned Hook groups from drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-hook-drift-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const hookPath = join(root, '.codex', 'hooks.json');
    const document = JSON.parse(readFileSync(hookPath, 'utf8'));
    document.hooks.Stop[0].hooks[0].timeout = 99;
    document.hooks.PreToolUse = [{
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'trellis check' }],
    }];
    writeFileSync(hookPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const blocked = initializeProject({ projectRoot: root, adapters: ['codex'] });
    assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.artifacts.some((artifact) =>
      artifact.path === '.codex/hooks.json' && artifact.action === 'blocked'));
    assert.equal(JSON.parse(readFileSync(hookPath, 'utf8')).hooks.Stop[0].hooks[0].timeout, 99);

    const forced = initializeProject({
      projectRoot: root,
      adapters: ['codex'],
      force: true,
    });
    assert.equal(forced.status, 'initialized');
    const replaced = JSON.parse(readFileSync(hookPath, 'utf8'));
    assert.equal(replaced.hooks.Stop[0].hooks[0].timeout, 10);
    assert.equal(replaced.hooks.PreToolUse[0].hooks[0].command, 'trellis check');
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

test('the initial manifest rejects every non-current shape without migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-manifest-'));
  try {
    initializeProject({ projectRoot: root, adapters: ['codex'] });
    const manifestPath = join(root, '.stetra', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, unknown: true })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /unrecognized key|unknown/i);

    const [first, ...rest] = manifest.artifacts;
    const { generatedHash: _hash, ...invalidArtifact } = first;
    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      artifacts: [invalidArtifact, ...rest],
    })}\n`, 'utf8');
    assert.throws(() => initializeProject({ projectRoot: root }), /generatedHash/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
