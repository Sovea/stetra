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
  const result = rccl.prepareRccl(projectRoot, {
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
  const discovery = options.discovery ? readAndParseDiscovery(rccl, options.discovery) : undefined;
  const critique = options.critique ? readAndParseCritique(rccl, options.critique) : undefined;

  const result = rccl.prepareRcclWorkflowStage(projectRoot, {
    stage: options.stage,
    scope: options.scope,
    discovery,
    critique,
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
  const validated = rccl.validateRcclCandidatePayload(yamlText);

  if (!validated.valid) {
    process.stderr.write('? Validation failed for RCCL generation:\n');
    for (const entry of validated.diagnostics.entries) {
      if (entry.status === 'rejected') process.stderr.write(`  - [${entry.reason}] ${entry.path}: ${entry.message}\n`);
    }
    process.stdout.write(JSON.stringify({
      error: true,
      diagnostics: validated.diagnostics,
      input: {
        source: options.input === '-' ? 'stdin' : options.input,
        supportsStdin: true,
      },
    }, null, 2) + '\n');
    process.exit(1);
  }

  const candidateDoc = { version: validated.document?.version ?? '1.0', generated_at: validated.document?.generated_at ?? null, git_ref: validated.document?.git_ref ?? null, observations: validated.observations };
  const consolidation = rccl.consolidateObservations(validated.observations);
  const draftDocument = {
    version: candidateDoc.version,
    generated_at: candidateDoc.generated_at,
    git_ref: candidateDoc.git_ref,
    observations: rccl.materializeRcclObservations(consolidation.observations),
  };
  const evidenceVerified = rccl.verifyEvidenceForDocument(draftDocument, projectRoot);
  const verified = rccl.verifyInductionForDocument(evidenceVerified);
  const result = rccl.emitRccl(verified, projectRoot);
  const debugArtifactsEnabled = shouldEmitDebugArtifacts(options.debugArtifacts);
  const debugArtifacts = debugArtifactsEnabled
    ? {
      enabled: true,
      candidates: rccl.writeCandidateArtifact(projectRoot, candidateDoc),
      consolidation: rccl.writeConsolidationArtifact(projectRoot, consolidation, verified),
    }
    : { enabled: false };

  process.stdout.write(JSON.stringify({
    ...result,
    diagnostics: validated.diagnostics,
    input: {
      source: options.input === '-' ? 'stdin' : options.input,
      supportsStdin: true,
    },
    debugArtifacts,
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

function printUsage() {
  process.stderr.write('Usage: calibrate-repo-context.mjs <prepare|prepare-stage|commit> <project-root> [opts...]\n');
  process.stderr.write('  prepare <project-root> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage discover [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage critique --discovery <path> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  prepare-stage <project-root> --stage synthesize --discovery <path> --critique <path> [--scope <glob>] [--debug-artifacts[=<bool>]]\n');
  process.stderr.write('  commit <project-root> --input <path-to-yaml|-> [--debug-artifacts[=<bool>]]\n');
}

const opts = parseArgs(args);
if (command === 'prepare') {
  runPrepare(opts).catch((error) => {
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
} else {
  printUsage();
  process.exit(1);
}
