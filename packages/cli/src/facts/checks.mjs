/** CLI-owned deterministic check-plan execution and collection. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Writable } from 'node:stream';

import { z } from 'zod';

import { inputError } from '../errors.ts';
import { runStreamingCommand } from '../infrastructure/process.ts';
import { parseArtifact } from '../validation.ts';
import { stableFactHash } from './worktree.mjs';

const CHECK_CONFIG_SCHEMA_VERSION = '1.0';
const MAX_CHECK_LOG_BYTES = 1024 * 1024;
const TRUNCATION_MARKER = Buffer.from(
  '\n[resonant-code: persisted check output truncated; outputDigest covers the full stream]\n',
);
const CheckDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  command: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().positive(),
});
const CheckConfigurationSchema = z.strictObject({
  version: z.string(),
  checks: z.array(CheckDefinitionSchema),
}).superRefine((configuration, context) => {
  const ids = new Set();
  for (const [index, check] of configuration.checks.entries()) {
    if (ids.has(check.id)) {
      context.addIssue({
        code: 'custom',
        path: ['checks', index, 'id'],
        message: `duplicate check id ${check.id}`,
      });
    }
    ids.add(check.id);
  }
});

export function loadCheckPlan(configPath, verificationPlan) {
  const requested = verificationPlan.commands.map((item) => ({
    id: validateCheckId(item.id, 'verification plan'),
    reason: item.reason,
  }));
  const definitions = existsSync(configPath)
    ? readCheckDefinitions(configPath)
    : new Map();
  return requested.map((request) => {
    const definition = definitions.get(request.id);
    if (!definition) {
      return {
        ...request,
        status: 'missing',
      };
    }
    return {
      ...request,
      status: 'configured',
      command: definition.command,
      timeoutMs: definition.timeoutMs,
      definitionFingerprint: stableFactHash([
        definition.id,
        definition.command,
        definition.timeoutMs,
      ]),
    };
  });
}

export async function runCheckPlan({
  projectRoot,
  plan,
  outputDirectory,
}) {
  const results = [];
  for (const item of plan) {
    validateCheckId(item?.id, 'prepared check plan');
    if (item.status === 'missing') {
      const reason = `No explicit command is configured for verification check "${item.id}".`;
      results.push({
        id: item.id,
        status: 'skipped',
        command: [],
        exitCode: null,
        outputDigest: stableFactHash([item.id, 'skipped', reason]),
        reason,
        provenance: {
          source: 'resonant-code-workflow',
          collectionId: 'pending',
        },
      });
      continue;
    }
    if (item.status !== 'configured'
      || !Array.isArray(item.command)
      || !item.command.length
      || !Number.isInteger(item.timeoutMs)
      || item.timeoutMs <= 0
      || item.definitionFingerprint !== stableFactHash([
        item.id,
        item.command,
        item.timeoutMs,
      ])) {
      throw new Error(`Prepared check "${item.id}" is invalid or was modified; rerun prepare.`);
    }
    results.push(await runConfiguredCheck({
      projectRoot,
      outputDirectory,
      item,
    }));
  }
  return results;
}

function readCheckDefinitions(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
  } catch (error) {
    throw inputError(
      `Failed to read check configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.version !== CHECK_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `UNSUPPORTED_SCHEMA_VERSION: check configuration must use ${CHECK_CONFIG_SCHEMA_VERSION}.`,
    );
  }
  const configuration = parseArtifact(
    CheckConfigurationSchema,
    parsed,
    'check configuration',
  );
  const definitions = new Map();
  for (const value of configuration.checks) {
    definitions.set(value.id, {
      id: value.id,
      command: [...value.command],
      timeoutMs: value.timeoutMs,
    });
  }
  return definitions;
}

async function runConfiguredCheck({
  projectRoot,
  outputDirectory,
  item,
}) {
  mkdirSync(outputDirectory, { recursive: true });
  const stdoutPath = resolve(outputDirectory, `${item.id}.stdout.log`);
  const stderrPath = resolve(outputDirectory, `${item.id}.stderr.log`);
  mkdirSync(dirname(stdoutPath), { recursive: true });
  const stdoutStream = new BoundedLogWriter(stdoutPath, MAX_CHECK_LOG_BYTES);
  const stderrStream = new BoundedLogWriter(stderrPath, MAX_CHECK_LOG_BYTES);
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  const [executable, ...args] = item.command;
  const result = await runStreamingCommand({
    file: executable,
    args,
    cwd: projectRoot,
    timeoutMs: item.timeoutMs,
    stdout: stdoutStream,
    stderr: stderrStream,
    onStdout(chunk) {
      stdoutHash.update(chunk);
    },
    onStderr(chunk) {
      stderrHash.update(chunk);
    },
  });
  const stdoutDigest = stdoutHash.digest('hex');
  const stderrDigest = stderrHash.digest('hex');
  const outputDigest = createHash('sha256')
    .update(JSON.stringify({
      stdoutDigest,
      stderrDigest,
      signal: result.signal,
    }))
    .digest('hex');
  const status = !result.failed && result.exitCode === 0 ? 'passed' : 'failed';
  const reason = result.timedOut
    ? `Check timed out after ${item.timeoutMs} ms.`
    : result.code && result.exitCode === null
      ? `Check could not start: ${result.message ?? result.code}`
      : status === 'failed'
        ? `Check exited with ${result.exitCode ?? result.signal ?? 'unknown status'}.`
        : undefined;
  return {
    id: item.id,
    status,
    command: item.command,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    outputDigest,
    outputRefs: {
      stdout: relative(projectRoot, stdoutPath).replace(/\\/g, '/'),
      stderr: relative(projectRoot, stderrPath).replace(/\\/g, '/'),
    },
    ...(stdoutStream.truncated || stderrStream.truncated
      ? {
          outputTruncated: {
            stdout: stdoutStream.truncated,
            stderr: stderrStream.truncated,
          },
        }
      : {}),
    definitionFingerprint: item.definitionFingerprint,
    ...(reason ? { reason } : {}),
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: 'pending',
    },
  };
}

function validateCheckId(value, location) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid check id at ${location}.`);
  }
  return value;
}

class BoundedLogWriter extends Writable {
  constructor(path, maxBytes) {
    super();
    this.descriptor = openSync(path, 'w');
    this.contentLimit = maxBytes - TRUNCATION_MARKER.length;
    this.contentBytes = 0;
    this.truncated = false;
  }

  _write(chunk, encoding, callback) {
    try {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      const remaining = Math.max(0, this.contentLimit - this.contentBytes);
      const persisted = value.subarray(0, remaining);
      if (persisted.length) {
        writeBuffer(this.descriptor, persisted);
        this.contentBytes += persisted.length;
      }
      if (persisted.length < value.length) this.truncated = true;
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _final(callback) {
    try {
      if (this.truncated) writeBuffer(this.descriptor, TRUNCATION_MARKER);
      this.close();
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _destroy(error, callback) {
    try {
      this.close();
      callback(error);
    } catch (closeError) {
      callback(closeError);
    }
  }

  close() {
    if (this.descriptor === null) return;
    closeSync(this.descriptor);
    this.descriptor = null;
  }
}

function writeBuffer(descriptor, value) {
  let offset = 0;
  while (offset < value.length) {
    offset += writeSync(descriptor, value, offset, value.length - offset);
  }
}
