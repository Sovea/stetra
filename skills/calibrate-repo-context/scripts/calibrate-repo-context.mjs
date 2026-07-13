#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FALSEY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);
const args = process.argv.slice(2);
const command = args[0];
const projectRoot = resolve(args[1] || '.');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDirectory, '..', '..', '..');
const rcclEntry = pathToFileURL(resolve(pluginRoot, 'rccl', 'dist', 'index.mjs')).href;

async function loadRccl() {
  return import(rcclEntry);
}

function shouldEmitDebugArtifacts(explicit) {
  if (explicit !== undefined) return Boolean(explicit);
  const value = process.env.RESONANT_CODE_DEBUG_ARTIFACTS;
  if (!value) return false;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function readBooleanFlagValue(value) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function readInputText(input) {
  if (input === '-') return readFileSync(0, 'utf-8');
  return readFileSync(input, 'utf-8');
}

async function runPrepare(options = {}) {
  const rccl = await loadRccl();
  const result = rccl.prepareCalibration({
    projectRoot,
    mode: 'full',
    scope: options.scope,
    debugArtifacts: shouldEmitDebugArtifacts(options.debugArtifacts),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

async function runPrepareStage(options = {}) {
  if (!options.stage) {
    process.stderr.write('? Missing --stage argument for prepare-stage.\n');
    process.exit(1);
  }
  if (!['discover', 'critique', 'synthesize'].includes(options.stage)) {
    process.stderr.write('? --stage must be one of discover, critique, synthesize.\n');
    process.exit(1);
  }

  const rccl = await loadRccl();
  const discovery = options.discovery ? readInputText(options.discovery) : undefined;
  const critique = options.critique ? readInputText(options.critique) : undefined;

  const result = rccl.prepareCalibration({
    projectRoot,
    mode: options.stage,
    scope: options.scope,
    artifacts: { discovery, critique },
    debugArtifacts: shouldEmitDebugArtifacts(options.debugArtifacts),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

async function runPrepareIncremental(options = {}) {
  const rccl = await loadRccl();
  const result = rccl.prepareCalibration({
    projectRoot,
    mode: 'incremental',
    scope: options.scope,
    targetFiles: options.targetFiles,
    changedFiles: options.changedFiles,
    incrementalMode: options.mode,
    fileLimit: options.fileLimit,
    windowLimit: options.windowLimit,
    debugArtifacts: shouldEmitDebugArtifacts(options.debugArtifacts),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

async function runCommit(options = {}) {
  if (!options.input) {
    process.stderr.write('? Missing --input argument for commit phase.\n');
    process.exit(1);
  }

  let yamlText;
  try {
    yamlText = readInputText(options.input);
  } catch (err) {
    process.stderr.write(`? Failed to read input ${options.input === '-' ? 'from stdin' : `file: ${err.message}`}\n`);
    process.exit(1);
  }

  const rccl = await loadRccl();
  const issued = rccl.prepareCalibration({
    projectRoot,
    mode: 'full',
    scope: options.scope,
  });
  const result = rccl.commitCalibration({
    projectRoot,
    plan: {
      mode: 'full',
      contract: issued.contract,
      scope: options.scope,
      debugArtifacts: shouldEmitDebugArtifacts(options.debugArtifacts),
    },
    artifacts: { candidate: yamlText },
  });
  if (result.status === 'failed') {
    process.stderr.write(`? RCCL commit failed: ${result.reason}\n`);
    process.stdout.write(JSON.stringify({ error: true, ...result }, null, 2) + '\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    ...result,
    input: {
      source: options.input === '-' ? 'stdin' : options.input,
      supportsStdin: true,
    },
  }, null, 2) + '\n');

  if (result.verification_summary.demoted_count > 0 || result.verification_summary.reduced_confidence_count > 0) {
    process.stderr.write('Verification summary:\n');
    process.stderr.write(`  kept: ${result.verification_summary.kept_count}\n`);
    process.stderr.write(`  reduced-confidence: ${result.verification_summary.reduced_confidence_count}\n`);
    process.stderr.write(`  demoted: ${result.verification_summary.demoted_count}\n`);
    for (const observation of result.verification_summary.observations) {
      if (observation.disposition === 'keep') continue;
      process.stderr.write(`  - ${observation.id}: disposition=${observation.disposition} evidence=${observation.evidence_status ?? 'pending'} induction=${observation.induction_status ?? 'pending'} verified=${observation.evidence_verified_count ?? 0}/${observation.evidence_total_count}\n`);
    }
  }
  process.exit(0);
}

async function runCommitRefresh(options = {}) {
  if (!options.input) {
    process.stderr.write('? Missing --input argument for commit-refresh phase.\n');
    process.exit(1);
  }

  let yamlText;
  try {
    yamlText = readInputText(options.input);
  } catch (err) {
    process.stderr.write(`? Failed to read input ${options.input === '-' ? 'from stdin' : `file: ${err.message}`}\n`);
    process.exit(1);
  }

  const rccl = await loadRccl();
  const issued = rccl.prepareCalibration({
    projectRoot,
    mode: 'incremental',
    scope: options.scope,
    targetFiles: options.targetFiles,
    changedFiles: options.changedFiles,
    incrementalMode: options.mode,
    fileLimit: options.fileLimit,
    windowLimit: options.windowLimit,
  });
  if (!issued.contract || issued.contract.kind !== 'rccl-observation-refresh') {
    process.stderr.write('? The current repository state did not issue a refresh contract. Re-run prepare-incremental with the same selectors.\n');
    process.exit(1);
  }
  const committed = rccl.commitCalibration({
    projectRoot,
    plan: {
      mode: 'refresh',
      contract: issued.contract,
      scope: options.scope,
      targetFiles: options.targetFiles,
      changedFiles: options.changedFiles,
      incrementalMode: options.mode,
      fileLimit: options.fileLimit,
      windowLimit: options.windowLimit,
      debugArtifacts: shouldEmitDebugArtifacts(options.debugArtifacts),
    },
    artifacts: { candidate: yamlText },
  });

  if (committed.status === 'failed') {
    process.stderr.write(`? RCCL refresh commit failed: ${committed.reason}\n`);
    for (const entry of committed.diagnostics?.entries ?? []) {
      if (entry.status === 'rejected') process.stderr.write(`  - [${entry.reason}] ${entry.path}: ${entry.message}\n`);
    }
    for (const error of committed.errors ?? []) process.stderr.write(`  - ${error}\n`);
    process.stdout.write(JSON.stringify({
      error: true,
      status: committed.status,
      reason: committed.reason,
      diagnostics: committed.diagnostics,
      errors: committed.errors,
      input: {
        source: options.input === '-' ? 'stdin' : options.input,
        supportsStdin: true,
      },
    }, null, 2) + '\n');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({
    status: committed.status,
    ...committed.result,
    diagnostics: committed.diagnostics,
    refresh_summary: committed.refresh_summary,
    input: {
      source: options.input === '-' ? 'stdin' : options.input,
      supportsStdin: true,
    },
    debugArtifacts: committed.debugArtifacts,
  }, null, 2) + '\n');

  if (committed.result.verification_summary.demoted_count > 0 || committed.result.verification_summary.reduced_confidence_count > 0) {
    process.stderr.write('Verification summary:\n');
    process.stderr.write(`  kept: ${committed.result.verification_summary.kept_count}\n`);
    process.stderr.write(`  reduced-confidence: ${committed.result.verification_summary.reduced_confidence_count}\n`);
    process.stderr.write(`  demoted: ${committed.result.verification_summary.demoted_count}\n`);
    for (const observation of committed.result.verification_summary.observations) {
      if (observation.disposition === 'keep') continue;
      process.stderr.write(`  - ${observation.id}: disposition=${observation.disposition} evidence=${observation.evidence_status ?? 'pending'} induction=${observation.induction_status ?? 'pending'} verified=${observation.evidence_verified_count ?? 0}/${observation.evidence_total_count}\n`);
    }
  }
  process.exit(0);
}

function readAndParseDiscovery(rccl, filePath) {
  let yamlText;
  try {
    yamlText = readInputText(filePath);
  } catch (err) {
    process.stderr.write(`? Failed to read discovery artifact: ${err.message}\n`);
    process.exit(1);
  }
  const parsed = rccl.parseRcclDiscoveryArtifact(yamlText);
  if (!parsed.valid) {
    process.stderr.write('? Validation failed for RCCL discovery artifact:\n');
    for (const err of parsed.errors ?? []) process.stderr.write(`  - ${err}\n`);
    process.exit(1);
  }
  return parsed.data;
}

function readAndParseCritique(rccl, filePath) {
  let yamlText;
  try {
    yamlText = readInputText(filePath);
  } catch (err) {
    process.stderr.write(`? Failed to read critique artifact: ${err.message}\n`);
    process.exit(1);
  }
  const parsed = rccl.parseRcclCritiqueArtifact(yamlText);
  if (!parsed.valid) {
    process.stderr.write('? Validation failed for RCCL critique artifact:\n');
    for (const err of parsed.errors ?? []) process.stderr.write(`  - ${err}\n`);
    process.exit(1);
  }
  return parsed.data;
}

function parseArgs(argsArray) {
  const opts = {};
  for (let i = 0; i < argsArray.length; i += 1) {
    if (argsArray[i] === '--scope') opts.scope = argsArray[++i];
    else if (argsArray[i] === '--input') opts.input = argsArray[++i];
    else if (argsArray[i] === '--stage') opts.stage = argsArray[++i];
    else if (argsArray[i] === '--mode') opts.mode = argsArray[++i];
    else if (argsArray[i] === '--file-limit') opts.fileLimit = readPositiveIntegerFlag('--file-limit', argsArray[++i]);
    else if (argsArray[i] === '--window-limit') opts.windowLimit = readPositiveIntegerFlag('--window-limit', argsArray[++i]);
    else if (argsArray[i] === '--target-file') {
      opts.targetFiles ??= [];
      opts.targetFiles.push(argsArray[++i]);
    }
    else if (argsArray[i] === '--changed-file') {
      opts.changedFiles ??= [];
      opts.changedFiles.push(argsArray[++i]);
    }
    else if (argsArray[i] === '--discovery') opts.discovery = argsArray[++i];
    else if (argsArray[i] === '--critique') opts.critique = argsArray[++i];
    else if (argsArray[i] === '--debug-artifacts') {
      const next = argsArray[i + 1];
      if (!next || next.startsWith('--')) opts.debugArtifacts = true;
      else {
        opts.debugArtifacts = readBooleanFlagValue(next);
        i += 1;
      }
    }
  }
  return opts;
}

function readPositiveIntegerFlag(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    process.stderr.write(`? ${flag} must be a positive integer.\n`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  process.stderr.write('Usage: calibrate-repo-context.mjs <prepare|prepare-incremental|prepare-stage|commit|commit-refresh> <project-root> [opts...]\n');
  process.stderr.write('  prepare <project-root> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-incremental <project-root> [--target-file <path>] [--changed-file <path>] [--scope <glob>] [--mode <task-scoped|changed-files|full>] [--file-limit <n>] [--window-limit <n>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage discover [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage critique --discovery <path> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage synthesize --discovery <path> --critique <path> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  commit <project-root> --input <path-to-yaml|-> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  commit-refresh <project-root> --input <path-to-refresh-yaml|-> [--target-file <path>] [--changed-file <path>] [--scope <glob>] [--mode <task-scoped|changed-files|full>] [--file-limit <n>] [--window-limit <n>] [--debug-artifacts[=<bool>]]\n');
}

const opts = parseArgs(args);
if (command === 'prepare') {
  runPrepare(opts).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else if (command === 'prepare-incremental') {
  runPrepareIncremental(opts).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else if (command === 'prepare-stage') {
  runPrepareStage(opts).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else if (command === 'commit') {
  runCommit(opts).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else if (command === 'commit-refresh') {
  runCommitRefresh(opts).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else {
  printUsage();
  process.exit(1);
}
