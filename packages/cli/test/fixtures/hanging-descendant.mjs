import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [pidPath, mode] = process.argv.slice(2);
if (!pidPath) throw new Error('Expected a descendant PID output path.');

const descendantSource = mode === 'ignore-term'
  || mode === 'ignore-term-no-output'
  ? "process.on('SIGTERM', () => {}); process.send('ready'); process.disconnect(); setInterval(() => {}, 10_000)"
  : "process.send('ready'); process.disconnect(); setInterval(() => {}, 10_000)";
const descendantOutput = mode === 'ignore-term-no-output' ? 'ignore' : 'inherit';
const descendant = spawn(
  process.execPath,
  ['-e', descendantSource],
  { stdio: ['ignore', descendantOutput, descendantOutput, 'ipc'] },
);
descendant.once('message', () => {
  writeFileSync(pidPath, `${descendant.pid}\n`, 'utf8');
  descendant.unref();
  if (mode !== 'launcher-exits') setInterval(() => {}, 10_000);
});
