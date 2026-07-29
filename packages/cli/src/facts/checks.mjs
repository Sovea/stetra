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
  rationale: z.string().trim().min(1),
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

export function loadCheckConfiguration(
  configPath,
  { required = false } = {},
) {
  if (!existsSync(configPath)) {
    if (required) {
      throw inputError(`Check configuration does not exist at ${configPath}.`);
    }
    return [];
  }
  return [...readCheckDefinitions(configPath).values()];
}

export function buildCheckPlan(definitions, verificationPlan) {
  if (!Array.isArray(definitions)) {
    throw new Error('Check definitions must be an array.');
  }
  if (!verificationPlan || !Array.isArray(verificationPlan.commands)) {
    throw new Error('Verification plan commands must be an array.');
  }
  const requested = verificationPlan.commands.map((item) => ({
    id: validateCheckId(item?.id, 'verification plan'),
    reasons: validateNonEmptyStrings(item.reasons, `verification plan ${item.id} reasons`),
    sources: validateVerificationSources(item.sources, `verification plan ${item.id} sources`),
  }));
  const requestedIds = new Set(requested.map((item) => item.id));
  const definitionById = new Map(definitions.map((definition) => [
    validateCheckId(definition?.id, 'check definition'),
    definition,
  ]));
  const active = requested.map((request) => {
    const definition = definitionById.get(request.id);
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
        request.reasons,
        request.sources,
      ]),
    };
  });
  const omitted = [...definitionById.keys()]
    .filter((id) => !requestedIds.has(id));
  if (omitted.length) {
    throw new Error(
      `Runtime verification plan omitted selected check definition(s): ${omitted.join(', ')}.`,
    );
  }
  return active;
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
      throw new Error(
        `Prepared check "${item.id}" has no executable definition; rerun prepare.`,
      );
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
        item.reasons,
        item.sources,
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
      rationale: value.rationale,
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
  const stdoutPath = resolve(outputDirectory, `${item.id}.stdout.log`);
  const stderrPath = resolve(outputDirectory, `${item.id}.stderr.log`);
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
  const status = result.exitCode === null
    ? 'unavailable'
    : !result.failed && result.exitCode === 0
      ? 'passed'
      : 'failed';
  const reason = result.timedOut
    ? `Check timed out after ${item.timeoutMs} ms.`
    : result.executionError
      ? `Check could not start: ${result.message ?? result.code}`
      : status === 'unavailable'
        ? `Check became unavailable before producing an exit code${result.signal ? ` (${result.signal})` : ''}.`
        : status === 'failed'
          ? `Check exited with ${result.exitCode ?? result.signal ?? 'unknown status'}.`
          : undefined;
  const outputRefs = {
    ...(stdoutStream.persisted
      ? { stdout: relative(projectRoot, stdoutPath).replace(/\\/g, '/') }
      : {}),
    ...(stderrStream.persisted
      ? { stderr: relative(projectRoot, stderrPath).replace(/\\/g, '/') }
      : {}),
  };
  return {
    id: item.id,
    status,
    command: item.command,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    outputDigest,
    ...(Object.keys(outputRefs).length ? { outputRefs } : {}),
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

function validateNonEmptyStrings(value, location) {
  if (!Array.isArray(value)
    || !value.length
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${location} must be a non-empty string array.`);
  }
  return value.map((item) => item.trim());
}

function validateVerificationSources(value, location) {
  const sources = validateNonEmptyStrings(value, location);
  if (sources.some((source) =>
    !['delivered-guidance', 'team-default', 'host-task'].includes(source))) {
    throw new Error(`${location} contains an unsupported source.`);
  }
  return sources;
}

class BoundedLogWriter extends Writable {
  constructor(path, maxBytes) {
    super();
    this.path = path;
    this.descriptor = null;
    this.created = false;
    this.contentLimit = maxBytes - TRUNCATION_MARKER.length;
    this.contentBytes = 0;
    this.truncated = false;
  }

  get persisted() {
    return this.created;
  }

  _write(chunk, encoding, callback) {
    try {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      const remaining = Math.max(0, this.contentLimit - this.contentBytes);
      const persisted = value.subarray(0, remaining);
      if (persisted.length) {
        this.open();
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
      if (this.truncated) {
        this.open();
        writeBuffer(this.descriptor, TRUNCATION_MARKER);
      }
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

  open() {
    if (this.descriptor !== null) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.descriptor = openSync(this.path, 'w');
    this.created = true;
  }
}

function writeBuffer(descriptor, value) {
  let offset = 0;
  while (offset < value.length) {
    offset += writeSync(descriptor, value, offset, value.length - offset);
  }
}
