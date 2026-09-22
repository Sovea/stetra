import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import React from 'react';
import { render } from 'ink-testing-library';
import { HostSelection, type HostChoice } from '../../src/cli/init-ui.js';

// Allow Ink's input effect and throttled frame rendering to finish between keys.
async function press(view: ReturnType<typeof render>, input: string): Promise<void> {
  view.stdin.write(input);
  await delay(50);
}

test('Host selection starts empty, rejects empty submission and supports keyboard selection', async t => {
  const completed: Array<HostChoice[] | null> = [];
  const view = render(<HostSelection projectRoot="/projects/developer's workspace" installed={[]} onComplete={result => completed.push(result)} />);
  t.after(() => { view.unmount(); view.cleanup(); });
  await delay(50);
  assert.match(view.lastFrame()!, /Project: \/projects\/developer's workspace/);
  assert.match(view.lastFrame()!, /> \[ \] Codex/);
  assert.match(view.lastFrame()!, /\[ \] Agent Skills \(\.agents\/skills\)/);
  assert.doesNotMatch(view.lastFrame()!, /\[x\]/);
  await press(view, '\r');
  assert.deepEqual(completed, []);
  assert.match(view.lastFrame()!, /Select at least one integration to continue\./);

  await press(view, '\u001B[B');
  assert.match(view.lastFrame()!, /> \[ \] Claude Code/);
  await press(view, ' ');
  assert.match(view.lastFrame()!, /> \[x\] Claude Code/);
  await press(view, '\u001B[B');
  await press(view, ' ');
  assert.match(view.lastFrame()!, /> \[x\] pi/);
  await press(view, '\u001B[A');
  await press(view, ' ');
  assert.match(view.lastFrame()!, /> \[ \] Claude Code/);
  await press(view, '\r');
  assert.deepEqual(completed, [['pi']]);
});

test('already installed Hosts stay selected while another Host can be added', async t => {
  const completed: Array<HostChoice[] | null> = [];
  const view = render(<HostSelection projectRoot="/project" installed={['codex']} onComplete={result => completed.push(result)} />);
  t.after(() => { view.unmount(); view.cleanup(); });
  await delay(50);
  assert.match(view.lastFrame()!, /> \[x\] Codex \(installed, kept\)/);
  await press(view, ' ');
  assert.match(view.lastFrame()!, /> \[x\] Codex \(installed, kept\)/);
  await press(view, '\u001B[A');
  assert.match(view.lastFrame()!, /> \[ \] Agent Skills \(\.agents\/skills\)/);
  await press(view, ' ');
  await press(view, '\r');
  assert.deepEqual(completed, [['codex', 'agents']]);
});

test('select-all checks every Host and an installed selection alone can be submitted', async t => {
  const all: Array<HostChoice[] | null> = [];
  const view = render(<HostSelection projectRoot="/project" installed={[]} onComplete={result => all.push(result)} />);
  t.after(() => { view.unmount(); view.cleanup(); });
  await delay(50);
  await press(view, 'a');
  assert.equal(view.lastFrame()!.match(/\[x\]/g)?.length, 4);
  await press(view, '\r');
  assert.deepEqual(all, [['codex', 'claude', 'pi', 'agents']]);

  const unchanged: Array<HostChoice[] | null> = [];
  const existing = render(<HostSelection projectRoot="/project" installed={['claude']} onComplete={result => unchanged.push(result)} />);
  t.after(() => { existing.unmount(); existing.cleanup(); });
  await delay(50);
  await press(existing, '\r');
  assert.deepEqual(unchanged, [['claude']]);
});

test('Agent Skills can be selected alone and its recorded selection stays locked on later setup', async t => {
  const completed: Array<HostChoice[] | null> = [];
  const view = render(<HostSelection projectRoot="/project" installed={[]} onComplete={result => completed.push(result)} />);
  t.after(() => { view.unmount(); view.cleanup(); });
  await delay(50);
  await press(view, '\u001B[A');
  assert.match(view.lastFrame()!, /> \[ \] Agent Skills \(\.agents\/skills\)/);
  await press(view, ' ');
  await press(view, '\r');
  assert.deepEqual(completed, [['agents']]);

  const refreshed: Array<HostChoice[] | null> = [];
  const existing = render(<HostSelection projectRoot="/project" installed={['agents']} onComplete={result => refreshed.push(result)} />);
  t.after(() => { existing.unmount(); existing.cleanup(); });
  await delay(50);
  await press(existing, '\u001B[A');
  assert.match(existing.lastFrame()!, /> \[x\] Agent Skills \(\.agents\/skills\) \(installed, kept\)/);
  await press(existing, ' ');
  assert.match(existing.lastFrame()!, /> \[x\] Agent Skills \(\.agents\/skills\) \(installed, kept\)/);
  await press(existing, '\u001B[B');
  await press(existing, ' ');
  await press(existing, '\r');
  assert.deepEqual(refreshed, [['codex', 'agents']]);
});

for (const [name, key] of [['Escape', '\u001B'], ['Ctrl+C', '\u0003']] as const) {
  test(`${name} cancels without submitting checked Hosts`, async t => {
    const completed: Array<HostChoice[] | null> = [];
    const view = render(<HostSelection projectRoot="/project" installed={['pi']} onComplete={result => completed.push(result)} />);
    t.after(() => { view.unmount(); view.cleanup(); });
    await delay(50);
    await press(view, key);
    assert.deepEqual(completed, [null]);
    await press(view, '\r');
    assert.deepEqual(completed, [null], 'Input after cancellation cannot submit a selection.');
  });
}
