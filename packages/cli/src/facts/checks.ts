/** Exact frozen-check execution with bounded persisted logs and full-stream digests. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Writable } from 'node:stream';

import type {
  CheckFact,
  VerificationDefinition,
} from '@sovea/resonant-code-core';

import { runStreamingCommand } from '../infrastructure/process.ts';
import { sha256, stableFingerprint } from '../protocol.ts';

export const MAX_CHECK_LOG_BYTES = 1024 * 1024;

export async function runFrozenChecks(input: {
  projectRoot: string;
  definitions: VerificationDefinition[];
  outputDirectory: string;
}): Promise<CheckFact[]> {
  const results: CheckFact[] = [];
  for (const definition of input.definitions) {
    results.push(await runFrozenCheck({
      projectRoot: input.projectRoot,
      definition,
      outputDirectory: input.outputDirectory,
    }));
  }
  return results;
}

async function runFrozenCheck(input: {
  projectRoot: string;
  definition: VerificationDefinition;
  outputDirectory: string;
}): Promise<CheckFact> {
  const { definition } = input;
  const logStem = `check-${sha256(definition.id).slice(-16)}`;
  const stdoutPath = resolve(input.outputDirectory, `${logStem}.stdout.log`);
  const stderrPath = resolve(input.outputDirectory, `${logStem}.stderr.log`);
  const stdout = new BoundedLogWriter(stdoutPath, MAX_CHECK_LOG_BYTES);
  const stderr = new BoundedLogWriter(stderrPath, MAX_CHECK_LOG_BYTES);
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  const [file, ...args] = definition.argv;
  const result = await runStreamingCommand({
    file,
    args,
    cwd: input.projectRoot,
    timeoutMs: definition.timeoutMs,
    stdout,
    stderr,
    onStdout(chunk) {
      stdoutHash.update(chunk);
    },
    onStderr(chunk) {
      stderrHash.update(chunk);
    },
  });
  const stdoutFact = stdout.fact(
    `sha256:${stdoutHash.digest('hex')}`,
    input.projectRoot,
  );
  const stderrFact = stderr.fact(
    `sha256:${stderrHash.digest('hex')}`,
    input.projectRoot,
  );
  const status: CheckFact['status'] = result.exitCode === null
    ? 'unavailable'
    : result.exitCode === 0 && !result.failed
      ? 'passed'
      : 'failed';
  const reason = result.timedOut
    ? `Check timed out after ${definition.timeoutMs} ms.`
    : result.executionError
      ? `Check could not start: ${result.message ?? result.code ?? 'unknown execution error'}`
      : status === 'unavailable'
        ? `Check did not produce an exit code${result.signal ? ` (${result.signal})` : ''}.`
        : status === 'failed'
          ? `Check exited with ${result.exitCode ?? result.signal ?? 'unknown status'}.`
          : undefined;
  return {
    id: definition.id,
    status,
    argv: [...definition.argv],
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    definitionFingerprint: stableFingerprint(definition),
    outputDigest: stableFingerprint({
      status,
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      signal: result.signal,
      stdoutDigest: stdoutFact.digest,
      stderrDigest: stderrFact.digest,
    }),
    stdout: stdoutFact,
    stderr: stderrFact,
    ...(reason ? { reason } : {}),
  };
}

class BoundedLogWriter extends Writable {
  private descriptor: number | null = null;
  private observedBytes = 0;
  private writtenBytes = 0;

  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
  ) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.observedBytes += value.length;
      const remaining = this.maxBytes - this.writtenBytes;
      if (remaining > 0 && value.length) {
        const persisted = value.subarray(0, remaining);
        this.open();
        writeBuffer(this.descriptor!, persisted);
        this.writtenBytes += persisted.length;
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    try {
      if (this.descriptor !== null) closeSync(this.descriptor);
      this.descriptor = null;
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  fact(digest: string, projectRoot: string): CheckFact['stdout'] {
    return {
      digest,
      byteLength: this.observedBytes,
      persistedBytes: this.writtenBytes,
      truncated: this.writtenBytes < this.observedBytes,
      ...(this.writtenBytes
        ? { logPath: relative(projectRoot, this.path).replace(/\\/g, '/') }
        : {}),
    };
  }

  private open(): void {
    if (this.descriptor !== null) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.descriptor = openSync(this.path, 'w');
  }
}

function writeBuffer(descriptor: number, value: Buffer): void {
  let offset = 0;
  while (offset < value.length) {
    offset += writeSync(descriptor, value, offset, value.length - offset);
  }
}
