import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { execa } from 'execa';

export interface CommandResult {
  code?: string;
  exitCode: number | null;
  failed: boolean;
  message?: string;
  signal: string | null;
  timedOut: boolean;
}

export interface BufferedCommandResult extends CommandResult {
  stderr: Buffer;
  stdout: Buffer;
}

export async function runBufferedCommand(input: {
  args: string[];
  cwd: string;
  file: string;
  maxBuffer: number;
}): Promise<BufferedCommandResult> {
  const result = await execa(input.file, input.args, {
    cwd: input.cwd,
    encoding: 'buffer',
    maxBuffer: input.maxBuffer,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
  });
  return {
    code: result.code,
    exitCode: result.exitCode ?? null,
    failed: result.failed,
    message: result.shortMessage ?? result.message,
    signal: result.signal ?? null,
    timedOut: result.timedOut,
    stdout: Buffer.from(result.stdout ?? []),
    stderr: Buffer.from(result.stderr ?? []),
  };
}

export async function runStreamingCommand(input: {
  args: string[];
  cwd: string;
  file: string;
  onStderr?: (chunk: Buffer) => void;
  onStdout?: (chunk: Buffer) => void;
  stderr: Writable;
  stdout: Writable;
  timeoutMs: number;
}): Promise<CommandResult> {
  const subprocess = execa(input.file, input.args, {
    buffer: false,
    cwd: input.cwd,
    forceKillAfterDelay: 1_000,
    reject: false,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
    timeout: input.timeoutMs,
  });
  if (!subprocess.stdout || !subprocess.stderr) {
    throw new Error('Command runner failed to create stdout/stderr pipes.');
  }
  subprocess.stdout.on('data', (chunk: Buffer) => input.onStdout?.(chunk));
  subprocess.stderr.on('data', (chunk: Buffer) => input.onStderr?.(chunk));
  subprocess.stdout.pipe(input.stdout);
  subprocess.stderr.pipe(input.stderr);
  const outputFinished = Promise.all([
    finished(input.stdout),
    finished(input.stderr),
  ]);
  const result = await subprocess;
  await outputFinished;
  return {
    code: result.code,
    exitCode: result.exitCode ?? null,
    failed: result.failed,
    message: result.shortMessage ?? result.message,
    signal: result.signal ?? null,
    timedOut: result.timedOut,
  };
}
