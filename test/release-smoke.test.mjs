import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(import.meta.dirname, '..');
const expectedVersion = JSON.parse(
  readFileSync(resolve(workspace, 'packages', 'core', 'package.json'), 'utf8'),
).version;
const temporary = mkdtempSync(join(tmpdir(), 'resonant-core-release-'));
try {
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n', 'utf8');

  const coreTarball = packPackage(join(workspace, 'packages', 'core'), packDirectory);
  run(npmCommand(), [
    'install',
    coreTarball,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], consumer);
  const installedCore = join(consumer, 'node_modules', '@sovea', 'resonant-code-core');
  const manifest = JSON.parse(readFileSync(join(installedCore, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@sovea/resonant-code-core');
  assert.equal(manifest.version, expectedVersion);
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './package.json']);
  assert.equal(existsSync(join(installedCore, 'assets')), false);
  assert.equal(existsSync(join(installedCore, 'dist', 'rccl.mjs')), false);

  const core = await import(pathToFileURL(join(installedCore, 'dist', 'index.mjs')).href);
  assert.deepEqual(Object.keys(core).sort(), ['compileDelegation', 'evaluateHandoff']);
  const task = 'Replace the public workflow with an inspectable Semantic Handoff.';
  const compiled = core.compileDelegation({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    humanEvents: [{
      id: 'event:task',
      kind: 'task',
      content: task,
      contentFingerprint: sha256(task),
    }],
    semantic: {
      desiredOutcome: {
        value: 'Expose the Semantic Handoff workflow.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      constraints: [],
      nonGoals: [],
      focus: [],
      consequence: {
        value: 'high',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      },
      assuranceDimensions: [{
        dimension: 'behavior',
        criticality: 'adoption-critical',
        rationale: 'The installed public workflow behavior determines whether the change can be adopted.',
        basis: { humanEventIds: ['event:task'], repositoryEvidenceIds: [] },
      }],
    },
    verification: {
      noCommandRationale: 'The isolated Core smoke has no repository command surface.',
    },
  });
  assert.equal(compiled.status, 'delegation-compiled');
  const contract = compiled.contract;
  const changedFile = {
    id: 'file:example',
    path: 'example.ts',
    operation: 'modified',
    before: { kind: 'file', contentDigest: sha256('before'), mode: '100644' },
    after: { kind: 'file', contentDigest: sha256('after'), mode: '100644' },
    representation: 'text',
  };
  const timestamp = '2026-08-03T12:00:00.000Z';
  const bundleBase = {
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    contractId: contract.contractId,
    collectedAt: timestamp,
    baseline: {
      head: null,
      fingerprint: sha256('baseline'),
      entryCount: 1,
      capturedAt: timestamp,
    },
    current: {
      head: null,
      fingerprint: sha256('current'),
      entryCount: 1,
      capturedAt: timestamp,
    },
    changeFingerprint: stableFingerprint([changedFile]),
    changedFiles: [changedFile],
    checks: [],
    verifierMutations: [],
    patch: {
      path: 'change.patch',
      digest: sha256('patch'),
      byteLength: 5,
    },
    provenance: {
      collector: 'resonant-code-cli',
      cliVersion: expectedVersion,
      coreVersion: expectedVersion,
    },
  };
  const factCollectionId = stableFingerprint({
    contractId: bundleBase.contractId,
    baselineFingerprint: bundleBase.baseline.fingerprint,
    currentFingerprint: bundleBase.current.fingerprint,
    changeFingerprint: bundleBase.changeFingerprint,
    changedFiles: bundleBase.changedFiles,
    checks: bundleBase.checks,
    verifierMutations: bundleBase.verifierMutations,
    patch: bundleBase.patch,
  });
  const withCollection = { ...bundleBase, factCollectionId };
  const factBundle = {
    ...withCollection,
    bundleFingerprint: stableFingerprint(withCollection),
  };
  const evaluation = core.evaluateHandoff({
    protocol: 'semantic-delegation',
    schemaVersion: '1',
    contract,
    factBundle,
    currentWorktreeFingerprint: factBundle.current.fingerprint,
    handoff: {
      protocol: 'semantic-delegation',
      schemaVersion: '1',
      systemMeaningUpdate: 'The isolated consumer now exposes the new public workflow.',
      materialClaims: [{
        id: 'claim:behavior',
        dimension: 'behavior',
        statement: 'The public workflow changed as requested.',
        adoptionConsequence: 'Consumers use the Semantic Handoff API.',
        adoptionCritical: true,
        basis: 'agent-judgment',
        evidence: { changedFiles: [changedFile.path] },
        falsification: {
          failureHypothesis: 'The isolated public workflow could retain legacy behavior.',
          attempt: 'Inspected the complete isolated change for legacy behavior.',
          status: 'supported',
          supportingEvidence: { changedFiles: [changedFile.path] },
          counterEvidence: {},
          conclusion: 'No conflicting public behavior was present in the bounded change.',
        },
      }],
      residualUnknowns: [],
      reviewMap: [{
        id: 'review:public',
        priority: 'must-read',
        changedFiles: [changedFile.path],
        checkIds: [],
        claimIds: ['claim:behavior'],
        unknownIds: [],
        rationale: 'This file represents the public behavior change.',
        prevents: 'Adopting an unintended API boundary.',
      }],
    },
  });
  assert.equal(evaluation.status, 'handoff-ready');
  assert.match(evaluation.humanAuthorityNotice, /human review only/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableFingerprint(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function packPackage(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  run('corepack', ['pnpm', 'pack', '--pack-destination', destination], packageDirectory);
  const created = readdirSync(destination)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, [
    `Command failed: ${command} ${args.join(' ')}`,
    result.stdout,
    result.stderr,
  ].join('\n'));
  return result;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
