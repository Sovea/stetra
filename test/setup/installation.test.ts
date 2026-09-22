import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { test, type TestContext } from 'node:test';
import { planInstallation, readInstallation } from '../../src/setup/installation.js';
import type { InstallArtifact } from '../../src/setup/artifacts.js';
import { StetraError } from '../../src/runtime/shared.js';

const runtime: InstallArtifact = { path: '.stetra/runtime/cli.js', kind: 'file', content: 'console.log("runtime v1");\n' };
const markers = { start: '# stetra:begin', end: '# stetra:end' };
const ignore: InstallArtifact = { path: '.stetra/.gitignore', kind: 'block', markers, content: `${markers.start}\nruntime/\nstate.sqlite*\n${markers.end}` };
function hook(command = 'node .stetra/runtime/cli.js hook'): InstallArtifact {
  return { path: '.claude/settings.json', kind: 'hook', event: 'SessionStart', content: JSON.stringify({ matcher: '*', hooks: [{ type: 'command', command }] }) };
}
const artifacts = () => [runtime, ignore, hook()];
const hasCode = (code: StetraError['code']) => (error: unknown) => error instanceof StetraError && error.code === code;

async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stetra init '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function save(root: string, path: string, content: string) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}

test('dry-run reports a complete installation without creating directories or state', async t => {
  const root = await fixture(t);
  const result = planInstallation(root, ['claude'], artifacts(), { dryRun: true });
  assert.equal(result.status, 'planned');
  assert.equal(result.counts.create, 3);
  assert.deepEqual(await readdir(root), []);
  assert.equal(readInstallation(root), null);
});

test('installation preserves JSONC settings, unrelated hooks, and ignore content and is byte-idempotent', async t => {
  const root = await fixture(t);
  const settings = `{
  // Keep this project setting.
  "theme": "dark",
  "hooks": {
    "SessionStart": [
      // The developer's hook stays first.
      {"hooks": [{"type": "command", "command": "echo user-owned"}]},
    ],
    "Stop": [{"hooks": [{"type": "command", "command": "echo finished"}]}],
  },
}\n`;
  await save(root, '.claude/settings.json', settings);
  await save(root, '.stetra/.gitignore', '# Developer files\nprivate-notes.md\n');
  const initialized = planInstallation(root, ['claude'], artifacts());
  assert.equal(initialized.status, 'initialized');
  const content = await readFile(join(root, hook().path), 'utf8');
  const value = parse(content);
  assert.equal(value.theme, 'dark');
  assert.equal(value.hooks.SessionStart.length, 2);
  assert.equal(value.hooks.SessionStart[0].hooks[0].command, 'echo user-owned');
  assert.equal(value.hooks.Stop[0].hooks[0].command, 'echo finished');
  assert.ok(content.includes('// Keep this project setting.'));
  assert.ok(content.includes("// The developer's hook stays first."));
  assert.equal(await readFile(join(root, ignore.path), 'utf8'), '# Developer files\nprivate-notes.md\n' + ignore.content + '\n');
  assert.deepEqual(readInstallation(root)?.adapters, ['claude']);
  assert.ok(!(await readdir(join(root, '.stetra'))).includes('state.sqlite'));
  const manifestBefore = await readFile(join(root, '.stetra/installation.json'), 'utf8');
  const modifiedBefore = (await stat(join(root, runtime.path))).mtimeMs;
  const repeated = planInstallation(root, ['claude'], artifacts());
  assert.equal(repeated.counts.unchanged, 3);
  assert.equal(await readFile(join(root, hook().path), 'utf8'), content);
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), manifestBefore);
  assert.equal((await stat(join(root, runtime.path))).mtimeMs, modifiedBefore);
});

test('managed upgrades replace the old hook once and adding another Host preserves existing installation', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  const newer = [
    { ...runtime, content: 'console.log("runtime v2");\n' }, ignore,
    hook('node .stetra/runtime/cli.js hook --updated'),
    { path: '.codex/skills/stetra/SKILL.md', kind: 'file' as const, content: '# A second Host\n' },
  ];
  const result = planInstallation(root, ['claude', 'codex'], newer);
  assert.equal(result.status, 'initialized');
  assert.equal(result.counts.upgrade, 2);
  assert.equal(result.counts.create, 1);
  assert.deepEqual(readInstallation(root)?.adapters, ['claude', 'codex']);
  const document = parse(await readFile(join(root, hook().path), 'utf8'));
  assert.equal(document.hooks.SessionStart.length, 1);
  assert.equal(document.hooks.SessionStart[0].hooks[0].command, 'node .stetra/runtime/cli.js hook --updated');
  assert.equal(planInstallation(root, ['claude', 'codex'], newer).counts.unchanged, 4);
  assert.throws(() => planInstallation(root, ['codex'], newer), hasCode('invalid'));
  assert.equal(planInstallation(root, ['claude', 'codex'], artifacts()).counts.remove, 1);
});

test('all conflicts are reported before writing and force only replaces established file ownership', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  await writeFile(join(root, runtime.path), 'Developer modified this managed runtime.\n');
  const unowned: InstallArtifact = { path: 'notes.txt', kind: 'file', content: 'Generated replacement\n' };
  await writeFile(join(root, unowned.path), 'Unrelated developer notes.\n');
  const newFile: InstallArtifact = { path: 'new-adapter/SKILL.md', kind: 'file', content: '# New adapter\n' };
  const before = await readFile(join(root, '.stetra/installation.json'), 'utf8');
  const blocked = planInstallation(root, ['claude'], [...artifacts(), unowned, newFile]);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.counts.blocked, 2);
  assert.ok(!(await readdir(root)).includes('new-adapter'));
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), before);
  const forced = planInstallation(root, ['claude'], [...artifacts(), unowned, newFile], { force: true });
  assert.equal(forced.status, 'blocked');
  assert.equal(await readFile(join(root, runtime.path), 'utf8'), 'Developer modified this managed runtime.\n');
  assert.equal(await readFile(join(root, unowned.path), 'utf8'), 'Unrelated developer notes.\n');
  const repaired = planInstallation(root, ['claude'], artifacts(), { force: true });
  assert.equal(repaired.status, 'initialized');
  assert.equal(repaired.counts.force, 1);
  assert.equal(await readFile(join(root, runtime.path), 'utf8'), runtime.content);
});

test('modified hooks require force with exact prior commands and an unidentifiable old hook is never duplicated', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  const path = join(root, hook().path);
  const document = parse(await readFile(path, 'utf8'));
  document.hooks.SessionStart[0].matcher = 'startup';
  document.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'echo unrelated' }] });
  await writeFile(path, JSON.stringify(document, null, 2));
  assert.equal(planInstallation(root, ['claude'], artifacts()).status, 'blocked');
  const result = planInstallation(root, ['claude'], artifacts(), { force: true });
  assert.equal(result.status, 'initialized');
  assert.equal(result.counts.force, 1);
  const repaired = parse(await readFile(path, 'utf8'));
  assert.equal(repaired.hooks.SessionStart.length, 2);
  assert.equal(repaired.hooks.SessionStart[0].hooks[0].command, 'echo unrelated');
  assert.equal(repaired.hooks.SessionStart[1].matcher, '*');
  repaired.hooks.SessionStart[1].hooks[0].command = 'echo deliberately-replaced-command';
  await writeFile(path, JSON.stringify(repaired));
  const before = await readFile(path, 'utf8');
  assert.equal(planInstallation(root, ['claude'], artifacts(), { force: true }).status, 'blocked');
  assert.equal(await readFile(path, 'utf8'), before);
});

test('malformed JSONC and wrong hook shapes never replace settings, even with force', async t => {
  const root = await fixture(t);
  const invalid = [
    '{ broken', '{"hooks":[]}', '{"hooks":{"SessionStart":{}}}',
    '{"hooks":{"SessionStart":[42]}}', '{"hooks":{},"hooks":{}}',
  ];
  for (const content of invalid) {
    await save(root, hook().path, content);
    const result = planInstallation(root, ['claude'], artifacts(), { force: true });
    assert.equal(result.status, 'blocked', content);
    assert.equal(await readFile(join(root, hook().path), 'utf8'), content);
    assert.equal(readInstallation(root), null);
    assert.ok(!(await readdir(root)).includes('.stetra'));
  }
});

test('managed blocks preserve surrounding text and do not repair ambiguous markers by overwriting the file', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  const path = join(root, ignore.path);
  await writeFile(path, `# Before\n${ignore.content.replace('runtime/', 'custom-runtime/')}\n# After\n`);
  assert.equal(planInstallation(root, ['claude'], artifacts()).status, 'blocked');
  assert.equal(planInstallation(root, ['claude'], artifacts(), { force: true }).status, 'initialized');
  assert.equal(await readFile(path, 'utf8'), `# Before\n${ignore.content}\n# After\n`);
  await writeFile(path, `${markers.start}\ncustom-content\n`);
  assert.equal(planInstallation(root, ['claude'], artifacts(), { force: true }).status, 'blocked');
  assert.equal(await readFile(path, 'utf8'), `${markers.start}\ncustom-content\n`);
});

test('path traversal, symbolic links, and overlapping artifact paths are refused before writes', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  for (const path of ['../outside.txt', '/tmp/stetra-unsafe-target', '.stetra/../outside.txt', 'a\\b.txt']) {
    assert.throws(() => planInstallation(root, ['claude'], [{ path, kind: 'file', content: 'unsafe' }]), hasCode('invalid'));
  }
  assert.throws(() => planInstallation(root, ['claude'], [
    { path: 'a', kind: 'file', content: 'parent file' }, { path: 'a/b', kind: 'file', content: 'child file' },
  ]), hasCode('invalid'));
  assert.deepEqual(await readdir(root), []);
  await symlink(outside, join(root, '.claude'));
  assert.throws(() => planInstallation(root, ['claude'], artifacts()), hasCode('invalid'));
  assert.deepEqual(await readdir(outside), []);
  await rm(join(root, '.claude'));
  await symlink(outside, join(root, '.stetra'));
  assert.throws(() => readInstallation(root), hasCode('invalid'));
  assert.deepEqual(await readdir(outside), []);
});

test('invalid or future installation manifests are not replaced by init or force', async t => {
  const root = await fixture(t);
  for (const value of ['not JSON', JSON.stringify({ schemaVersion: 2, adapters: ['claude'], artifacts: [] })]) {
    await save(root, '.stetra/installation.json', value);
    assert.throws(() => planInstallation(root, ['claude'], artifacts(), { force: true }), hasCode('invalid'));
    assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), value);
    assert.deepEqual(await readdir(join(root, '.stetra')), ['installation.json']);
  }
});

test('multiple hook events share a settings document without losing either addition', async t => {
  const root = await fixture(t);
  const first = hook();
  const second = { ...hook('node .stetra/runtime/cli.js other-hook'), event: 'Stop' };
  const result = planInstallation(root, ['claude'], [first, second]);
  assert.equal(result.status, 'initialized');
  const document = parse(await readFile(join(root, first.path), 'utf8'));
  assert.equal(document.hooks.SessionStart.length, 1);
  assert.equal(document.hooks.Stop.length, 1);
  assert.equal(planInstallation(root, ['claude'], [first, second]).counts.unchanged, 2);
});

test('obsolete managed artifacts retire without deleting developer content or changing JSONC neighbors', async t => {
  const root = await fixture(t);
  const oldSkill: InstallArtifact = { path: '.agents/skills/stetra/SKILL.md', kind: 'file', content: 'Old managed skill.\n' };
  const newSkill: InstallArtifact = { path: '.agents/skills/stetra-explore/SKILL.md', kind: 'file', content: 'New managed skill.\n' };
  const userHook = { hooks: [{ type: 'command', command: 'echo developer' }] };
  await save(root, hook().path, `{// Preserve this comment.\n"hooks":{"SessionStart":[${JSON.stringify(userHook)}]}}\n`);
  await save(root, ignore.path, '# Keep before\n');
  planInstallation(root, ['claude'], [runtime, oldSkill, ignore, hook()]);
  await save(root, '.agents/skills/stetra/notes.md', 'Developer notes.\n');
  const manifestBefore = await readFile(join(root, '.stetra/installation.json'), 'utf8');
  const preview = planInstallation(root, ['claude'], [runtime, newSkill], { dryRun: true });
  assert.equal(preview.counts.remove, 3);
  assert.equal(await readFile(join(root, oldSkill.path), 'utf8'), oldSkill.content);
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), manifestBefore);

  await writeFile(join(root, oldSkill.path), 'Edited obsolete skill.\n');
  const blocked = planInstallation(root, ['claude'], [runtime, newSkill], { force: true });
  assert.equal(blocked.status, 'blocked', 'Force must not discard edits in an obsolete artifact.');
  assert.equal(await readFile(join(root, oldSkill.path), 'utf8'), 'Edited obsolete skill.\n');
  await assert.rejects(readFile(join(root, newSkill.path)), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), manifestBefore);

  await writeFile(join(root, oldSkill.path), oldSkill.content);
  const result = planInstallation(root, ['claude'], [runtime, newSkill]);
  assert.equal(result.status, 'initialized');
  assert.equal(result.counts.remove, 3);
  await assert.rejects(readFile(join(root, oldSkill.path)), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, '.agents/skills/stetra/notes.md'), 'utf8'), 'Developer notes.\n');
  const settings = await readFile(join(root, hook().path), 'utf8');
  assert.match(settings, /Preserve this comment/);
  assert.deepEqual(parse(settings).hooks.SessionStart, [userHook]);
  assert.match(await readFile(join(root, ignore.path), 'utf8'), /^# Keep before/);
  assert.equal(readInstallation(root)!.artifacts.length, 2);
});

test('retiring a managed hook never silently removes comments added inside its group', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  const path = join(root, hook().path);
  const original = await readFile(path, 'utf8');
  const edited = original.replace('"matcher":', '// A developer note about this hook.\n      "matcher":');
  await writeFile(path, edited);
  const manifest = await readFile(join(root, '.stetra/installation.json'), 'utf8');
  const result = planInstallation(root, ['claude'], [runtime, ignore], { force: true });
  assert.equal(result.status, 'blocked');
  assert.equal(await readFile(path, 'utf8'), edited);
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), manifest);
});

test('hook upgrades preserve developer comments unless force explicitly replaces the owned group', async t => {
  const root = await fixture(t);
  planInstallation(root, ['claude'], artifacts());
  const path = join(root, hook().path);
  const original = await readFile(path, 'utf8');
  const edited = original.replace('"matcher":', '// Explain why this hook runs here.\n      "matcher":');
  await writeFile(path, edited);
  const manifest = await readFile(join(root, '.stetra/installation.json'), 'utf8');
  const updated = [runtime, ignore, hook('node .stetra/runtime/cli.js hook --updated')];
  assert.equal(planInstallation(root, ['claude'], updated).status, 'blocked');
  assert.equal(await readFile(path, 'utf8'), edited);
  assert.equal(await readFile(join(root, '.stetra/installation.json'), 'utf8'), manifest);
  const forced = planInstallation(root, ['claude'], updated, { force: true });
  assert.equal(forced.status, 'initialized');
  assert.equal(forced.counts.force, 1);
  const settings = parse(await readFile(path, 'utf8'));
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'node .stetra/runtime/cli.js hook --updated');
});
