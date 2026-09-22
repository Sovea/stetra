import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sessionStart } from '../../src/adapters/shared/session-start.js';
import { contextInstructions } from '../../src/runtime/context.js';
import { MemoryStore } from '../../src/runtime/knowledge/store.js';
import { Workspace } from '../../src/runtime/workspace.js';

test('hooks read the installed project and ignore unrelated lifecycle events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stetra hook project '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'installed project');
  const otherProject = join(directory, 'event cwd');
  await mkdir(project); await mkdir(otherProject);
  const cli = join(project, '.stetra/runtime/cli.js');
  const instructions = await contextInstructions(project, cli);
  const result = await sessionStart({ hook_event_name: 'SessionStart', cwd: otherProject }, cli, project);
  assert.deepEqual(result, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: instructions.text } });
  assert.ok(!instructions.text.includes(otherProject));
  assert.deepEqual(await sessionStart({ hook_event_name: 'Stop', cwd: otherProject }, cli, otherProject), {});
  assert.deepEqual(await readdir(otherProject), []);
});

test('both hook events refresh current selected knowledge and isolate native Host sessions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'stetra hook knowledge '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root);
  const memories = new MemoryStore(root);
  const codexMemory = await memories.create({ title: 'Cache constraint', body: 'Selected Codex knowledge.', source: 'developer' });
  const claudeMemory = await memories.create({ title: 'Parser constraint', body: 'Selected Claude knowledge.', source: 'developer' });
  const cli = join(root, '.stetra/runtime/cli.js');
  for (const host of ['codex', 'claude'] as const) {
    const session = { host, sessionId: 'same-native-id' };
    const selected = host === 'codex' ? codexMemory : claudeMemory;
    await workspace.context({ session, ids: [selected.id] });
    for (const hook_event_name of ['SessionStart', 'UserPromptSubmit']) {
      const result = await sessionStart({ hook_event_name, cwd: root, session_id: session.sessionId }, cli, root, host);
      const expected = await contextInstructions(root, cli, session);
      assert.deepEqual(result, { hookSpecificOutput: { hookEventName: hook_event_name, additionalContext: expected.text } });
      assert.ok(expected.text.includes(selected.body));
      assert.ok(!expected.text.includes(host === 'codex' ? claudeMemory.body : codexMemory.body));
    }
  }
  const updated = await memories.update(codexMemory.id, codexMemory.revision, { title: codexMemory.title, body: 'Revised knowledge replaces earlier guidance.', source: codexMemory.source });
  const refreshed = await sessionStart({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'same-native-id' }, cli, root, 'codex');
  const text = (refreshed.hookSpecificOutput as { additionalContext: string }).additionalContext;
  assert.ok(text.includes(updated.body));
  assert.ok(!text.includes(codexMemory.body));
  const fork = await sessionStart({ hook_event_name: 'SessionStart', cwd: root, session_id: 'new-native-id' }, cli, root, 'codex');
  assert.ok(!JSON.stringify(fork).includes(updated.body));
  const initial = JSON.parse((fork.hookSpecificOutput as { additionalContext: string }).additionalContext.split('\n').at(-1)!);
  assert.deepEqual(initial.library, { activeCount: 2 });
  assert.deepEqual(initial.selection.ids, []);
  assert.deepEqual(initial.knowledge.memories, []);
  await workspace.context({ session: { host: 'codex', sessionId: 'same-native-id' }, reset: true });
  const reset = await sessionStart({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'same-native-id' }, cli, root, 'codex');
  assert.ok(!JSON.stringify(reset).includes(updated.body));
});
