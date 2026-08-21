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
  CheckAttemptFact,
  CheckFact,
  CheckStepAttemptFact,
  CheckStreamFact,
  VerificationDefinition,
} from '@sovea/stetra-core';

import { runStreamingCommand } from '../infrastructure/process.ts';
import { sha256, stableFingerprint } from '../protocol.ts';
import { captureVerificationInputs } from './execution-inputs.ts';

export const MAX_CHECK_LOG_BYTES = 1024 * 1024;
export interface FrozenCheckExecution {
  definition: VerificationDefinition;
  timeoutMs: number;
  previousAttempts?: CheckAttemptFact[];
}

export async function runFrozenChecks(input: {
  projectRoot: string;
  executions: FrozenCheckExecution[];
  outputDirectory: string;
  recordedOutputDirectory?: string;
}): Promise<CheckFact[]> {
  const results: CheckFact[] = [];
  for (const execution of input.executions) {
    results.push(await runFrozenCheck({
      projectRoot: input.projectRoot,
      ...execution,
      outputDirectory: input.outputDirectory,
      recordedOutputDirectory: input.recordedOutputDirectory ?? input.outputDirectory,
    }));
  }
  return results;
}

async function runFrozenCheck(input: {
  projectRoot: string;
  definition: VerificationDefinition;
  timeoutMs: number;
  previousAttempts?: CheckAttemptFact[];
  outputDirectory: string;
  recordedOutputDirectory: string;
}): Promise<CheckFact> {
  const { definition } = input;
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error(`Check ${definition.definitionId} timeout must be a positive safe integer.`);
  }
  const previousAttempts = input.previousAttempts ?? [];
  const prior = previousAttempts.at(-1);
  if (prior && (prior.termination.kind !== 'timeout' || input.timeoutMs <= prior.timeoutMs)) {
    throw new Error(
      `Check ${definition.definitionId} retry requires a timeout greater than the prior timed-out attempt.`,
    );
  }
  const attemptNumber = previousAttempts.length + 1;
  const startedMs = performance.now();
  const beforePreparation = captureVerificationInputs(input.projectRoot, [definition])[0];
  const steps: CheckStepAttemptFact[] = [];
  for (const [index, step] of definition.execution.preparation.entries()) {
    const fact = await runCheckStep({
      ...input,
      attemptNumber,
      stepNumber: index + 1,
      step: { ...step, role: 'preparation' },
    });
    steps.push(fact);
    if (fact.status !== 'passed') break;
  }
  const readyForAssertion = captureVerificationInputs(input.projectRoot, [definition])[0];
  const preparationPassed = steps.every((step) => step.status === 'passed');
  if (preparationPassed) {
    steps.push(await runCheckStep({
      ...input,
      attemptNumber,
      stepNumber: definition.execution.preparation.length + 1,
      step: { ...definition.execution.assertion, role: 'assertion' },
    }));
  }
  const afterAssertion = captureVerificationInputs(input.projectRoot, [definition])[0];
  const terminal = steps.at(-1);
  if (!terminal) throw new Error(`Check ${definition.definitionId} produced no execution step.`);
  const observedPhase = terminal.role;
  const status = observedPhase === 'assertion' ? terminal.status : 'unavailable';
  const durationMs = Math.max(0, Math.round(performance.now() - startedMs));
  const reason = observedPhase === 'preparation'
    ? `Check assertion was not observed because preparation step ${terminal.key ?? terminal.stepId} did not pass.`
    : terminal.reason;
  const attempt: CheckAttemptFact = {
    attempt: attemptNumber,
    durationMs,
    timeoutMs: input.timeoutMs,
    status,
    observedPhase,
    termination: terminal.termination,
    outcomeFingerprint: stableFingerprint({
      attempt: attemptNumber,
      timeoutMs: input.timeoutMs,
      status,
      observedPhase,
      termination: terminal.termination,
      steps: steps.map((step) => step.outcomeFingerprint),
      executionInputs: {
        beforePreparation: beforePreparation.fingerprint,
        readyForAssertion: readyForAssertion.fingerprint,
        afterAssertion: afterAssertion.fingerprint,
      },
    }),
    stdout: { ...terminal.stdout },
    stderr: { ...terminal.stderr },
    steps,
    executionInputs: {
      beforePreparation,
      readyForAssertion,
      afterAssertion,
    },
    ...(reason ? { reason } : {}),
  };
  return {
    verifierId: definition.verifierId,
    definitionId: definition.definitionId,
    assertionArgv: [...definition.execution.assertion.argv],
    definitionFingerprint: stableFingerprint(definition),
    attempts: [
      ...previousAttempts.map((item) => structuredClone(item)),
      attempt,
    ],
  };
}

async function runCheckStep(input: {
  projectRoot: string;
  definition: VerificationDefinition;
  timeoutMs: number;
  outputDirectory: string;
  recordedOutputDirectory: string;
  attemptNumber: number;
  stepNumber: number;
  step: {
    stepId: string;
    role: 'preparation' | 'assertion';
    key?: string;
    argv: string[];
  };
}): Promise<CheckStepAttemptFact> {
  const { definition, step } = input;
  const logStem = `check-${sha256(definition.definitionId).slice(-16)}-attempt-${input.attemptNumber}-step-${input.stepNumber}`;
  const stdoutPath = resolve(input.outputDirectory, `${logStem}.stdout.log`);
  const stderrPath = resolve(input.outputDirectory, `${logStem}.stderr.log`);
  const recordedStdoutPath = resolve(input.recordedOutputDirectory, `${logStem}.stdout.log`);
  const recordedStderrPath = resolve(input.recordedOutputDirectory, `${logStem}.stderr.log`);
  const stdout = new BoundedLogWriter(stdoutPath, MAX_CHECK_LOG_BYTES);
  const stderr = new BoundedLogWriter(stderrPath, MAX_CHECK_LOG_BYTES);
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  const [file, ...args] = step.argv;
  const startedMs = performance.now();
  const result = await runStreamingCommand({
    file,
    args,
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs,
    stdout,
    stderr,
    onStdout(chunk) {
      stdoutHash.update(chunk);
    },
    onStderr(chunk) {
      stderrHash.update(chunk);
    },
  });
  const durationMs = Math.max(0, Math.round(performance.now() - startedMs));
  const stdoutFact = stdout.fact(
    `sha256:${stdoutHash.digest('hex')}`,
    input.projectRoot,
    recordedStdoutPath,
  );
  const stderrFact = stderr.fact(
    `sha256:${stderrHash.digest('hex')}`,
    input.projectRoot,
    recordedStderrPath,
  );
  const termination: CheckStepAttemptFact['termination'] = result.timedOut
    ? { kind: 'timeout', ...(result.signal ? { signal: result.signal } : {}) }
    : result.executionError
      ? { kind: 'spawn-error', ...(result.code ? { code: result.code } : {}) }
      : result.signal
        ? { kind: 'signal', signal: result.signal }
        : result.exitCode !== null
          ? { kind: 'exit', exitCode: result.exitCode }
          : noTerminationResult(definition.definitionId);
  const status: CheckStepAttemptFact['status'] = termination.kind !== 'exit'
    ? 'unavailable'
    : termination.exitCode === 0 && !result.failed
      ? 'passed' : 'failed';
  const reason = termination.kind === 'timeout'
    ? `Check timed out after ${input.timeoutMs} ms.`
    : termination.kind === 'spawn-error'
      ? `Check could not start: ${result.message ?? result.code ?? 'unknown execution error'}`
      : termination.kind === 'signal'
        ? `Check terminated by signal ${termination.signal}.`
        : status === 'failed'
          ? `Check exited with ${termination.exitCode}.`
          : undefined;
  return {
    stepId: step.stepId,
    role: step.role,
    ...(step.key ? { key: step.key } : {}),
    argv: [...step.argv],
    durationMs,
    timeoutMs: input.timeoutMs,
    status,
    termination,
    outcomeFingerprint: stableFingerprint({
      stepId: step.stepId,
      role: step.role,
      timeoutMs: input.timeoutMs,
      status,
      termination,
      stdoutDigest: stdoutFact.digest,
      stderrDigest: stderrFact.digest,
    }),
    stdout: stdoutFact,
    stderr: stderrFact,
    ...(reason ? { reason } : {}),
  };
}

function noTerminationResult(definitionId: string): never {
  throw new Error(`Check ${definitionId} returned no exit, signal, timeout, or spawn error.`);
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

  fact(digest: string, projectRoot: string, recordedPath: string): CheckStreamFact {
    return {
      digest,
      byteLength: this.observedBytes,
      persistedBytes: this.writtenBytes,
      truncated: this.writtenBytes < this.observedBytes,
      ...(this.writtenBytes
        ? { logPath: relative(projectRoot, recordedPath).replace(/\\/g, '/') }
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
