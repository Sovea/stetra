import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { adapterIds, adapterRegistry, adapters } from '../../src/adapters/registry.js';

test('adapter registration preserves saved choices, menu labels, and shared skill discovery', () => {
  assert.deepEqual(adapterIds, ['codex', 'claude', 'pi', 'agents']);
  assert.deepEqual(adapters.map(({ id, label, skillDirectory }) => ({ id, label, skillDirectory })), [
    { id: 'codex', label: 'Codex', skillDirectory: '.agents/skills' },
    { id: 'claude', label: 'Claude Code', skillDirectory: '.claude/skills' },
    { id: 'pi', label: 'pi', skillDirectory: '.agents/skills' },
    { id: 'agents', label: 'Agent Skills (.agents/skills)', skillDirectory: '.agents/skills' },
  ]);
  for (const id of adapterIds) {
    assert.equal(adapterRegistry[id].id, id, 'Persisted adapter IDs must resolve to their original integration.');
    assert.deepEqual(adapterRegistry[id].runtimeFiles ?? [], id === 'pi' ? ['pi.js'] : []);
  }
  assert.equal(adapterRegistry.agents.artifacts, undefined, 'Generic Agent Skills must not install a native hook or extension.');
});

test('native startup hooks retain each Host event and configuration contract', () => {
  for (const id of ['codex', 'claude'] as const) {
    const artifacts = adapterRegistry[id].artifacts!();
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[1]!.event, 'UserPromptSubmit');
    const artifact = artifacts[0]!;
    assert.equal(artifact.kind, 'hook');
    assert.equal(artifact.path, id === 'codex' ? '.codex/hooks.json' : '.claude/settings.json');
    assert.equal(artifact.event, 'SessionStart');
    const group = JSON.parse(artifact.content);
    assert.equal(group.matcher, id === 'codex' ? 'startup|resume|clear|compact' : 'startup|resume|clear|compact|fork');
    assert.equal(group.hooks.length, 1);
    const hook = group.hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.timeout, 5);
    assert.ok(hook.command.includes(`${adapterRegistry[id].skillDirectory}/stetra-explore/scripts/stetra.mjs`));
    assert.ok(!hook.command.includes(process.cwd()), 'Generated hooks must remain portable across project locations.');
    assert.deepEqual(
      Object.fromEntries(Object.entries(hook).filter(([key]) => key !== 'command')),
      id === 'codex'
        ? { type: 'command', timeout: 5, statusMessage: 'Loading Stetra context', additionalContextLimit: 16000 }
        : { type: 'command', timeout: 5 },
      'Codex-only hook fields must not leak into Claude settings.',
    );
  }
});

test('the generated pi entry resolves its installed runtime and project independently of cwd', async t => {
  const root = await mkdtemp(join(tmpdir(), "stetra pi project's "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = adapterRegistry.pi.artifacts!();
  assert.equal(artifacts.length, 1);
  const artifact = artifacts[0]!;
  assert.equal(artifact.kind, 'file');
  assert.equal(artifact.path, '.pi/extensions/stetra.js');
  await mkdir(join(root, '.pi/extensions'), { recursive: true });
  await mkdir(join(root, '.stetra/runtime'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(root, '.stetra/runtime/pi.js'), 'export const activate = (host, options) => ({ host, options });\n');
  await writeFile(join(root, artifact.path), artifact.content);
  const extension = await import(pathToFileURL(join(root, artifact.path)).href);
  const host = { name: 'pi test Host' };
  const activated = extension.default(host);
  assert.equal(activated.host, host);
  assert.equal(activated.options.cliPath, join(root, '.stetra/runtime/cli.js'));
  assert.equal(resolve(activated.options.projectRoot), root);
});
