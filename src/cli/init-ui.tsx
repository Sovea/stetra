import React, { useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { adapters, type AdapterId } from '../adapters/registry.js';

export type HostChoice = AdapterId;
const hosts = adapters.map(({ id: value, label }) => ({ value, label }));

type SelectionOptions = { projectRoot: string; installed: readonly HostChoice[] };

export function HostSelection({ projectRoot, installed, onComplete }: SelectionOptions & {
  onComplete(selection: HostChoice[] | null): void;
}) {
  const { exit } = useApp();
  const [focused, setFocused] = useState(0);
  const [selected, setSelected] = useState<Set<HostChoice>>(() => new Set(installed));
  const [error, setError] = useState('');
  const completed = useRef(false);

  function complete(selection: HostChoice[] | null): void {
    if (completed.current) return;
    completed.current = true;
    onComplete(selection);
    exit();
  }

  useInput((input, key) => {
    if (completed.current) return;
    if (key.escape || (key.ctrl && input === 'c')) { complete(null); return; }
    if (key.upArrow) { setFocused(previous => (previous + hosts.length - 1) % hosts.length); return; }
    if (key.downArrow) { setFocused(previous => (previous + 1) % hosts.length); return; }
    if (input === ' ') {
      const host = hosts[focused]!.value;
      if (installed.includes(host)) return;
      setSelected(previous => {
        const next = new Set(previous);
        if (next.has(host)) next.delete(host); else next.add(host);
        return next;
      });
      setError('');
      return;
    }
    if (input.toLowerCase() === 'a' && !key.ctrl && !key.meta) {
      setSelected(new Set(hosts.map(host => host.value)));
      setError('');
      return;
    }
    if (key.return) {
      if (!selected.size) { setError('Select at least one integration to continue.'); return; }
      complete(hosts.filter(host => selected.has(host.value)).map(host => host.value));
    }
  });

  return <Box flexDirection="column" paddingY={1}>
    <Text bold>Set up Stetra</Text>
    <Text>Project: {projectRoot}</Text>
    <Box marginTop={1} flexDirection="column">
      <Text>Select integrations for this project.</Text>
      {hosts.map((host, index) => <Text key={host.value} color={index === focused ? 'cyan' : undefined}>
        {index === focused ? '>' : ' '} [{selected.has(host.value) ? 'x' : ' '}] {host.label}
        {installed.includes(host.value) ? ' (installed, kept)' : ''}
      </Text>)}
    </Box>
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>Agent Skills includes the shared skills and runtime, without automatic session context.</Text>
      <Text dimColor>Up/Down: move · Space: toggle · A: select all</Text>
      <Text dimColor>Enter: continue · Esc or Ctrl+C: cancel</Text>
      {installed.length > 0 && <Text dimColor>Existing integrations remain enabled.</Text>}
      {error && <Text color="yellow">{error}</Text>}
    </Box>
  </Box>;
}

export async function selectHosts(options: SelectionOptions): Promise<HostChoice[] | null> {
  let selection: HostChoice[] | null = null;
  // Allocate the renderer first so cleanup is available even if mounting fails.
  const app = render(null, {
    stdout: process.stderr, stderr: process.stderr, stdin: process.stdin,
    exitOnCtrlC: false, patchConsole: false,
  });
  try {
    app.rerender(<HostSelection {...options} onComplete={value => { selection = value; }} />);
    await app.waitUntilExit();
  } finally {
    app.cleanup();
  }
  return selection;
}
