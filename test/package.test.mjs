import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function cli(entry, project, args, input) {
  return JSON.parse(execFileSync(process.execPath, [entry, ...args, '--project', project], {
    cwd: project, encoding: 'utf8', timeout: 5_000,
    input: input === undefined ? undefined : JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'],
  }));
}

test('packaged skills retrieve current knowledge independently of source, node_modules, and ancestor runtimes', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stetra package '));
  const plugin = join(directory, 'plugin with spaces');
  const project = join(directory, 'developer project with spaces');
  try {
    await mkdir(plugin); await mkdir(project);
    await mkdir(join(directory, '.stetra/runtime'), { recursive: true });
    await writeFile(join(directory, '.stetra/runtime/cli.js'), 'throw new Error("A packaged skill must not load a surrounding project runtime.");');
    for (const path of ['dist', '.codex-plugin', 'skills', 'hooks']) await cp(path, join(plugin, path), { recursive: true });
    assert.ok(!(await readdir(plugin)).includes('node_modules'));
    const manifest = JSON.parse(await readFile(join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
    const discoverable = (await readdir(join(plugin, 'skills'), { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.'));
    assert.deepEqual(discoverable.map(item => item.name).sort(), ['stetra-design', 'stetra-explain', 'stetra-explore']);
    for (const item of discoverable) assert.match(await readFile(join(plugin, 'skills', item.name, 'SKILL.md'), 'utf8'), /^---\n/);
    assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
    assert.ok(!('mcpServers' in manifest));
    const entry = join(plugin, 'dist/cli.js');
    assert.deepEqual(cli(entry, project, ['context']).knowledge.memories, []);
    for (const skill of discoverable) {
      const launcher = join(plugin, 'skills', skill.name, 'scripts/stetra.mjs');
      assert.deepEqual(cli(launcher, project, ['context']).knowledge.memories, []);
    }
    assert.deepEqual(await readdir(project), []);
    const memory = cli(entry, project, ['call', 'memory', '--input', '-'], {
      action: 'create', memory: { title: 'A bundled memory', body: 'Preserve lookup errors.', source: 'developer' },
    });
    assert.equal(cli(entry, project, ['call', 'memory', '--input', '-'], { action: 'read', memoryId: memory.id }).body, memory.body);
    const selected = cli(entry, project, ['context', '--memory', memory.id, '--host', 'codex', '--session', 'packaged-session']);
    assert.equal(selected.knowledge.memories[0].body, memory.body);
    assert.deepEqual(cli(entry, project, ['context', '--host', 'codex', '--session', 'another-session']).knowledge.memories, []);
    const hooks = JSON.parse(await readFile(join(plugin, 'hooks/hooks.json'), 'utf8'));
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const response = JSON.parse(execFileSync('sh', ['-c', hooks.hooks[event][0].hooks[0].command], {
        cwd: project, env: { ...process.env, PLUGIN_ROOT: plugin },
        input: JSON.stringify({ hook_event_name: event, cwd: project, source: 'startup', session_id: 'packaged-session' }),
        encoding: 'utf8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      }));
      assert.equal(response.hookSpecificOutput.hookEventName, event);
      assert.ok(response.hookSpecificOutput.additionalContext.includes(memory.body));
    }
    assert.equal(typeof cli(entry, project, ['schema', 'memory', '--action', 'update']).$schema, 'string');
    for (const args of [['view'], ...['task', 'entry', 'feedback', 'session', 'source'].map(domain => ['call', domain, '--input', '-'])]) {
      const result = spawnSync(process.execPath, [entry, ...args, '--project', project], { cwd: project, input: '{}', encoding: 'utf8', timeout: 5_000 });
      assert.notEqual(result.status, 0, `Retired command must be rejected: ${args.join(' ')}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the npm archive contains three skills and their hidden shared runtime without web or MCP resources', { timeout: 15_000 }, async () => {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }));
  const paths = new Set(pack.files.map(file => file.path));
  for (const path of ['.codex-plugin/plugin.json', 'hooks/hooks.json', 'skills/stetra-design/SKILL.md', 'skills/stetra-explore/SKILL.md', 'skills/stetra-explain/SKILL.md', 'skills/.stetra-shared/stetra.mjs', 'skills/.stetra-shared/cli.md', 'dist/cli.js', 'dist/init-ui.js', 'dist/pi.js']) {
    assert.ok(paths.has(path), `Missing ${path}`);
  }
  const allowed = new Set(['dist', 'skills', 'hooks', '.codex-plugin', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']);
  for (const path of paths) {
    assert.ok(allowed.has(path.split('/')[0]), `Unexpected package artifact: ${path}`);
    assert.ok(!path.startsWith('dist/web/'), `Retired browser resource remains packaged: ${path}`);
    assert.ok(!/(?:^|\/)\.mcp\.json$|(?:^|\/)mcp\.[cm]?js$|node_modules|@modelcontextprotocol/.test(path), `Unexpected MCP resource: ${path}`);
  }
  const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
  assert.ok(!('mcpServers' in manifest));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.ok(!Object.keys(pkg[field] ?? {}).some(name => name.startsWith('@modelcontextprotocol/')), `${field} must not declare an MCP SDK.`);
  }
  assert.doesNotMatch(await readFile('dist/cli.js', 'utf8'), /@modelcontextprotocol\/sdk/);
});
