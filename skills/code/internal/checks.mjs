import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

import { stableFactHash } from './worktree.mjs';

const CHECK_CONFIG_SCHEMA_VERSION = '1.0';

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
    throw new Error(
      `Failed to read check configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Check configuration must be an object.');
  }
  const unknown = Object.keys(parsed).filter((key) => !['version', 'checks'].includes(key));
  if (unknown.length) {
    throw new Error(`Check configuration contains unsupported field(s): ${unknown.join(', ')}.`);
  }
  if (parsed.version !== CHECK_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `UNSUPPORTED_SCHEMA_VERSION: check configuration must use ${CHECK_CONFIG_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(parsed.checks)) {
    throw new Error('Check configuration checks must be an array.');
  }
  const definitions = new Map();
  for (const [index, value] of parsed.checks.entries()) {
    const location = `checks[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Check configuration ${location} must be an object.`);
    }
    const fields = Object.keys(value).filter((key) => !['id', 'command', 'timeoutMs'].includes(key));
    if (fields.length) {
      throw new Error(`Check configuration ${location} contains unsupported field(s): ${fields.join(', ')}.`);
    }
    const id = validateCheckId(value.id, location);
    if (!Array.isArray(value.command)
      || !value.command.length
      || value.command.some((part) => typeof part !== 'string' || !part)) {
      throw new Error(`Check configuration ${location}.command must be a non-empty string array.`);
    }
    if (!Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0) {
      throw new Error(`Check configuration ${location}.timeoutMs must be a positive integer.`);
    }
    if (definitions.has(id)) throw new Error(`Duplicate check configuration id: ${id}.`);
    definitions.set(id, {
      id,
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
  const stdoutStream = createWriteStream(stdoutPath, { flags: 'w' });
  const stderrStream = createWriteStream(stderrPath, { flags: 'w' });
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  const [executable, ...args] = item.command;
  const child = spawn(executable, args, {
    cwd: projectRoot,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError = null;
  let timedOut = false;
  child.stdout.on('data', (chunk) => {
    stdoutHash.update(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrHash.update(chunk);
  });
  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);
  child.on('error', (error) => {
    spawnError = error;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, item.timeoutMs);
  const forceKill = setTimeout(() => {
    if (timedOut && child.exitCode === null) child.kill('SIGKILL');
  }, item.timeoutMs + 1_000);
  const { code, signal } = await new Promise((resolveResult) => {
    child.on('close', (exitCode, exitSignal) => {
      resolveResult({ code: exitCode, signal: exitSignal });
    });
  });
  clearTimeout(timeout);
  clearTimeout(forceKill);
  await Promise.all([finished(stdoutStream), finished(stderrStream)]);
  const stdoutDigest = stdoutHash.digest('hex');
  const stderrDigest = stderrHash.digest('hex');
  const outputDigest = createHash('sha256')
    .update(JSON.stringify({ stdoutDigest, stderrDigest, signal }))
    .digest('hex');
  const status = !spawnError && !timedOut && code === 0 ? 'passed' : 'failed';
  const reason = timedOut
    ? `Check timed out after ${item.timeoutMs} ms.`
    : spawnError
      ? `Check could not start: ${spawnError.message}`
      : status === 'failed'
        ? `Check exited with ${code ?? signal ?? 'unknown status'}.`
        : undefined;
  return {
    id: item.id,
    status,
    command: item.command,
    exitCode: Number.isInteger(code) ? code : null,
    outputDigest,
    outputRefs: {
      stdout: relative(projectRoot, stdoutPath).replace(/\\/g, '/'),
      stderr: relative(projectRoot, stderrPath).replace(/\\/g, '/'),
    },
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
