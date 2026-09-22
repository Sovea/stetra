import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { planInstallation, type InstallationResult } from '../../src/setup/installation.js';
import type { InstallArtifact } from '../../src/setup/artifacts.js';
import { initializeProject } from '../../src/setup/init.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const bundle = join(repository, 'dist/cli.js');

function execute(entry: string, args: string[], cwd: string, input?: unknown): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd, encoding: 'utf8', timeout: 10_000,
    input: input === undefined ? undefined : JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function successful<T>(entry: string, args: string[], cwd: string, input?: unknown): T {
  const result = execute(entry, args, cwd, input);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as T;
}

function init(root: string, args: string[] = [], entry = bundle): InstallationResult {
  return successful(entry, ['init', '--project', root, '--json', ...args], root);
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string, prefix = ''): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${prefix}${item.name}`;
      if (item.isDirectory()) { files[`${path}/`] = 'directory'; await visit(join(directory, item.name), `${path}/`); }
      else files[path] = createHash('sha256').update(await readFile(join(directory, item.name))).digest('hex');
    }
  }
  await visit(root);
  return files;
}

test('project installation and bundled refresh preserve Host configuration and independent launchers', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stetra init '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "developer's $draft project");
  const nested = join(root, 'src', 'nested working directory');
  const packaged = join(directory, 'temporary installed package');
  await mkdir(nested, { recursive: true });
  await mkdir(packaged);
  for (const path of ['dist', 'skills', 'package.json']) await cp(join(repository, path), join(packaged, path), { recursive: true });
  const entry = join(packaged, 'dist/cli.js');
  await mkdir(join(root, '.claude'));
  const existingHook = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-owned-hook' }] };
  const settings = `{
  // Keep this developer comment.
  "permissions": { "allow": ["Bash(git status:*)"], },
  "hooks": {
    "SessionStart": [${JSON.stringify(existingHook)}],
    "Stop": [{ "hooks": [{ "type": "command", "command": "echo existing-stop" }] }],
  },
}\n`;
  await writeFile(join(root, '.claude/settings.json'), settings);
  await mkdir(join(root, '.stetra'));
  await writeFile(join(root, '.stetra/.gitignore'), '# User-owned ignore\n/private-notes/\n');

  // Selection is tested by the terminal UI. Seed its explicit result through the core API,
  // then exercise the distributable CLI against the recorded installation below.
  const result = await initializeProject(root, { adapters: ['codex', 'claude', 'pi', 'agents'] });
  assert.equal(result.status, 'initialized');
  assert.deepEqual(result.adapters, ['agents', 'claude', 'codex', 'pi']);
  assert.equal(existsSync(join(root, '.stetra/state.sqlite')), false, 'Initialization must not create obsolete runtime state.');
  const currentSettings = await readFile(join(root, '.claude/settings.json'), 'utf8');
  assert.match(currentSettings, /Keep this developer comment/);
  const parsed = parse(currentSettings);
  assert.deepEqual(parsed.permissions, { allow: ['Bash(git status:*)'] });
  assert.deepEqual(parsed.hooks.SessionStart[0], existingHook);
  assert.deepEqual(parsed.hooks.Stop, parse(settings).hooks.Stop);
  assert.equal(parsed.hooks.SessionStart.length, 2);
  assert.match(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), /^# User-owned ignore\n\/private-notes\/\n/);
  assert.match(await readFile(join(root, '.agents/skills/stetra-explore/SKILL.md'), 'utf8'), /^---\nname: stetra-explore\n/);
  assert.deepEqual((await readdir(join(root, '.agents/skills'))).sort(), ['.stetra-shared', 'stetra-design', 'stetra-explain', 'stetra-explore']);
  assert.equal(existsSync(join(root, '.pi/skills')), false, 'Codex, pi, and Agent Skills share one discovered skill.');
  assert.ok(existsSync(join(root, '.pi/extensions/stetra.js')), 'Pi auto-discovery requires a .js or .ts extension entry.');
  assert.equal(existsSync(join(root, '.stetra/runtime/web')), false);
  assert.match(await readFile(join(root, '.stetra/.gitignore'), 'utf8'), /\/cache\//);

  const before = await snapshot(root);
  const repeated = init(root, ['--yes'], entry);
  assert.equal(repeated.counts.create, 0);
  assert.equal(repeated.counts.upgrade, 0);
  assert.deepEqual(await snapshot(root), before, 'An unchanged init is byte-idempotent, including JSONC and the manifest.');
  await rm(packaged, { recursive: true, force: true });

  const runtimeSetup = execute(join(root, '.stetra/runtime/cli.js'), ['init', '--yes', '--project', root], root);
  assert.equal(runtimeSetup.status, 1);
  const setupError = JSON.parse(runtimeSetup.stderr).error;
  assert.equal(setupError.code, 'invalid');
  assert.match(setupError.message, /installed Stetra CLI or a built checkout/);
  assert.deepEqual(await snapshot(root), before, 'Using the runtime as an installer must fail without changing the project.');

  const launchers = ['.agents', '.claude'].flatMap(host => ['stetra-design', 'stetra-explore', 'stetra-explain'].map(skill => `${host}/skills/${skill}/scripts/stetra.mjs`));
  for (const launcher of launchers) {
    const context = successful<{ knowledge: { memories: unknown[] } }>(join(root, launcher), ['context'], nested);
    assert.deepEqual(context.knowledge.memories, []);
    const instructions = successful<{ text: string }>(join(root, launcher), ['context', '--instructions'], nested);
    assert.ok(instructions.text.includes(`Project: ${JSON.stringify(root)}`));
    assert.ok(instructions.text.includes(join(root, '.stetra/runtime/cli.js')));
  }
  const memory = successful<{ id: string }>(join(root, launchers[0]!), ['call', 'memory', '--input', '-'], nested, {
    action: 'create', memory: { title: 'Project constraint', body: 'Preserve rejected requests.', source: 'developer', scope: { kind: 'project' } },
  });
  for (const host of ['codex', 'claude']) successful(join(root, launchers[0]!), ['context', '--memory', memory.id, '--host', host, '--session', 'test-native-session'], nested);
  for (const settingsPath of ['.codex/hooks.json', '.claude/settings.json']) {
    const config = parse(await readFile(join(root, settingsPath), 'utf8'));
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const command = config.hooks[event].at(-1).hooks[0].command;
      const response = spawnSync('sh', ['-c', command], {
        cwd: nested, encoding: 'utf8', timeout: 10_000,
        input: JSON.stringify({ hook_event_name: event, cwd: nested, source: 'compact', session_id: 'test-native-session' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      assert.equal(response.status, 0, response.stderr);
      const output = JSON.parse(response.stdout).hookSpecificOutput;
      assert.equal(output.hookEventName, event);
      assert.ok(output.additionalContext.includes(memory.id), 'The hook must load the installed project, not its nested cwd.');
      assert.ok(output.additionalContext.includes(`Project: ${JSON.stringify(root)}`));
      assert.ok(output.additionalContext.includes('test-native-session'));
    }
  }
  assert.equal(existsSync(join(root, '.stetra/state.sqlite')), false);
  assert.equal(existsSync(join(nested, '.stetra')), false);
});

test('Agent Skills alone installs a standalone launcher without native Host integrations', { timeout: 20_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'stetra generic skills '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nested = join(root, 'src', 'nested');
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, 'existing.txt'), 'Developer content remains.\n');
  const before = await snapshot(root);
  const planned = await initializeProject(root, { adapters: ['agents'], dryRun: true });
  assert.equal(planned.status, 'planned');
  assert.deepEqual(planned.adapters, ['agents']);
  assert.ok(planned.counts.create > 0);
  assert.deepEqual(await snapshot(root), before, 'A generic-only preview must create no files or directories.');

  const result = await initializeProject(root, { adapters: ['agents'] });
  assert.equal(result.status, 'initialized');
  assert.deepEqual(result.adapters, ['agents']);
  assert.ok(result.artifacts.every(artifact => artifact.kind !== 'hook'));
  for (const path of ['.codex', '.claude', '.pi', '.stetra/runtime/pi.js', '.stetra/state.sqlite']) {
    assert.equal(existsSync(join(root, path)), false, `Generic Agent Skills must not install ${path}.`);
  }
  assert.deepEqual((await readdir(join(root, '.agents/skills'))).sort(), ['.stetra-shared', 'stetra-design', 'stetra-explain', 'stetra-explore']);
  const launcher = join(root, '.agents/skills/stetra-explore/scripts/stetra.mjs');
  const context = successful<{ projectRoot: string; knowledge: { memories: unknown[] } }>(launcher, ['context'], nested);
  assert.equal(context.projectRoot, root);
  assert.deepEqual(context.knowledge.memories, []);
  const memory = successful<{ id: string; revision: string }>(launcher, ['call', 'memory', '--input', '-'], nested, {
    action: 'create', memory: { title: 'Generic skill knowledge', body: 'Keep rejected queries visible to callers.', source: 'developer', scope: { kind: 'project' } },
  });
  const recalled = successful<{ body: string }>(launcher, ['call', 'memory', '--input', '-'], nested, { action: 'read', memoryId: memory.id });
  assert.equal(recalled.body, 'Keep rejected queries visible to callers.');
  assert.equal(successful<{ knowledge: { memories: { id: string }[] } }>(launcher, ['context', '--memory', memory.id], nested).knowledge.memories[0]!.id, memory.id);
  successful(launcher, ['call', 'memory', '--input', '-'], nested, { action: 'delete', memoryId: memory.id, expectedRevision: memory.revision });
  assert.deepEqual(successful<{ knowledge: { memories: unknown[] } }>(launcher, ['context'], nested).knowledge.memories, []);
  assert.equal(existsSync(join(root, '.stetra/state.sqlite')), false);
  assert.equal(existsSync(join(nested, '.stetra')), false);
  assert.equal(await readFile(join(root, 'existing.txt'), 'utf8'), 'Developer content remains.\n');
});

for (const [first, second] of [[['agents'], ['codex', 'pi']], [['codex', 'pi'], ['agents']]]) {
  test(`adding ${second!.join(' and ')} after ${first!.join(' and ')} keeps one shared set of skills`, { timeout: 15_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'stetra shared skills '));
    t.after(() => rm(root, { recursive: true, force: true }));
    await initializeProject(root, { adapters: first! });
    const skillRoot = join(root, '.agents/skills/stetra-explore');
    const originalSkill = await snapshot(skillRoot);
    const result = await initializeProject(root, { adapters: second! });
    assert.equal(result.status, 'initialized');
    assert.deepEqual(result.adapters, ['agents', 'codex', 'pi']);
    assert.deepEqual(await snapshot(skillRoot), originalSkill, 'Adding another consumer must preserve the existing shared skill files.');
    assert.deepEqual((await readdir(join(root, '.agents/skills'))).sort(), ['.stetra-shared', 'stetra-design', 'stetra-explain', 'stetra-explore']);
    const sharedEntries = result.artifacts.filter(artifact => artifact.path.startsWith('.agents/skills/stetra-explore/'));
    assert.ok(sharedEntries.length > 0);
    assert.ok(sharedEntries.every(artifact => artifact.action === 'unchanged'));
    const manifest = JSON.parse(await readFile(join(root, '.stetra/installation.json'), 'utf8')) as { artifacts: { path: string; kind: string; event?: string }[] };
    const keys = manifest.artifacts.map(artifact => `${artifact.kind}:${artifact.path}:${artifact.event ?? ''}`);
    assert.equal(new Set(keys).size, keys.length, 'Shared files must have only one ownership entry.');
    const codex = parse(await readFile(join(root, '.codex/hooks.json'), 'utf8'));
    assert.equal(codex.hooks.SessionStart.length, 1);
    assert.ok(existsSync(join(root, '.pi/extensions/stetra.js')));
    assert.equal(existsSync(join(root, '.pi/skills')), false);
    assert.equal(existsSync(join(root, '.claude')), false);
    const installed = await snapshot(root);
    assert.deepEqual(init(root, ['--yes']).adapters, ['agents', 'codex', 'pi']);
    assert.deepEqual(await snapshot(root), installed);
  });
}

test('explicit core Host choices are additive and CLI dry-run refresh writes nothing', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'stetra init choices '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'existing.txt'), 'Keep this file.\n');
  const before = await snapshot(root);
  const planned = await initializeProject(root, { adapters: ['codex'], dryRun: true });
  assert.equal(planned.status, 'planned');
  assert.deepEqual(planned.adapters, ['codex']);
  assert.ok(planned.counts.create > 0);
  assert.deepEqual(await snapshot(root), before);

  const pi = await initializeProject(root, { adapters: ['pi'] });
  assert.deepEqual(pi.adapters, ['pi']);
  assert.equal(existsSync(join(root, '.codex/hooks.json')), false);
  assert.equal(existsSync(join(root, '.claude/settings.json')), false);
  const piOnly = await snapshot(root);
  const recordedPreview = init(root, ['--yes', '--dry-run']);
  assert.equal(recordedPreview.status, 'planned');
  assert.deepEqual(recordedPreview.adapters, ['pi']);
  assert.deepEqual(await snapshot(root), piOnly);
  const preview = await initializeProject(root, { adapters: ['claude'], dryRun: true });
  assert.deepEqual(preview.adapters, ['claude', 'pi']);
  assert.deepEqual(await snapshot(root), piOnly);
  assert.deepEqual((await initializeProject(root, { adapters: ['claude'] })).adapters, ['claude', 'pi']);
  assert.deepEqual((await initializeProject(root, { adapters: ['codex'] })).adapters, ['claude', 'codex', 'pi']);
  const installed = await snapshot(root);
  assert.deepEqual(init(root, ['--yes']).adapters, ['claude', 'codex', 'pi']);
  assert.deepEqual(await snapshot(root), installed);
  assert.equal(await readFile(join(root, 'existing.txt'), 'utf8'), 'Keep this file.\n');
  assert.equal(existsSync(join(root, '.stetra/state.sqlite')), false);
});

test('init conflicts block every planned write, including when adding another Host', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'stetra init conflicts '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.claude/skills/stetra-explore'), { recursive: true });
  await writeFile(join(root, '.claude/skills/stetra-explore/SKILL.md'), 'A user-owned skill.\n');
  const initial = await snapshot(root);
  const unowned = await initializeProject(root, { adapters: ['claude', 'pi'], force: true });
  assert.equal(unowned.status, 'blocked');
  assert.deepEqual(await snapshot(root), initial, 'Even --force must preserve unknown files and block the entire installation.');

  await initializeProject(root, { adapters: ['codex'] });
  const skill = join(root, '.agents/skills/stetra-explore/SKILL.md');
  await writeFile(skill, `${await readFile(skill, 'utf8')}\nA developer edit.\n`);
  const edited = await snapshot(root);
  const conflicting = await initializeProject(root, { adapters: ['pi'] });
  assert.equal(conflicting.status, 'blocked');
  const refresh = execute(bundle, ['init', '--project', root, '--yes', '--json'], root);
  assert.equal(refresh.status, 2, refresh.stderr);
  assert.equal(JSON.parse(refresh.stdout).status, 'blocked');
  assert.deepEqual(await snapshot(root), edited);
  assert.equal(existsSync(join(root, '.pi/extensions')), false);
  assert.equal(existsSync(join(root, '.stetra/runtime/pi.js')), false);
  const forced = init(root, ['--yes', '--force']);
  assert.equal(forced.status, 'initialized');
  assert.deepEqual(forced.adapters, ['codex']);
  assert.doesNotMatch(await readFile(skill, 'utf8'), /A developer edit/);
  assert.deepEqual((await initializeProject(root, { adapters: ['pi'] })).adapters, ['codex', 'pi']);
  assert.equal(await readFile(join(root, '.claude/skills/stetra-explore/SKILL.md'), 'utf8'), 'A user-owned skill.\n');
});

test('upgrading retires unchanged browser artifacts and preserves edits and project knowledge', async t => {
  const root = await mkdtemp(join(tmpdir(), 'stetra retire browser '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy: InstallArtifact[] = [
    { path: '.stetra/runtime/cli.js', kind: 'file', content: 'throw new Error("old runtime");\n' },
    { path: '.stetra/runtime/web/app.js', kind: 'file', content: 'console.log("old browser");\n' },
    { path: '.stetra/runtime/web/style.css', kind: 'file', content: 'body { color: black; }\n' },
    { path: '.agents/skills/stetra/SKILL.md', kind: 'file', content: 'Old collaboration skill.\n' },
  ];
  assert.equal(planInstallation(root, ['agents'], legacy).status, 'initialized');
  await writeFile(join(root, '.stetra/runtime/web/developer-notes.txt'), 'Keep this developer file.\n');
  await mkdir(join(root, '.stetra/memory'));
  await writeFile(join(root, '.stetra/memory/project-notes.md'), 'Existing project knowledge.\n');
  const oldBrowser = join(root, legacy[1]!.path);
  await writeFile(oldBrowser, 'Developer edited this old browser artifact.\n');
  const before = await snapshot(root);
  assert.equal((await initializeProject(root, { adapters: ['agents'], force: true })).status, 'blocked');
  assert.deepEqual(await snapshot(root), before, 'No update may discard edited retired artifacts, even with force.');
  await writeFile(oldBrowser, legacy[1]!.content);
  const result = await initializeProject(root, { adapters: ['agents'] });
  assert.equal(result.status, 'initialized');
  assert.equal(result.counts.remove, 3);
  for (const artifact of legacy.slice(1)) assert.equal(existsSync(join(root, artifact.path)), false);
  assert.equal(await readFile(join(root, '.stetra/runtime/web/developer-notes.txt'), 'utf8'), 'Keep this developer file.\n');
  assert.equal(await readFile(join(root, '.stetra/memory/project-notes.md'), 'utf8'), 'Existing project knowledge.\n');
  const launcher = join(root, '.agents/skills/stetra-explore/scripts/stetra.mjs');
  assert.deepEqual(successful<{ knowledge: { memories: unknown[] } }>(launcher, ['context'], root).knowledge.memories, []);
});
