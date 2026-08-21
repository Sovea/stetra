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
const temporary = mkdtempSync(join(tmpdir(), 'stetra-core-release-'));
try {
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n', 'utf8');

  const coreTarball = packPackage(join(workspace, 'packages', 'core'), packDirectory);
  run(npmCommand(), ['install', coreTarball, '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installedCore = join(consumer, 'node_modules', '@sovea', 'stetra-core');
  const manifest = JSON.parse(readFileSync(join(installedCore, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@sovea/stetra-core');
  assert.equal(manifest.version, expectedVersion);
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './package.json']);
  assert.equal(existsSync(join(installedCore, 'assets')), false);

  const core = await import(pathToFileURL(join(installedCore, 'dist', 'index.mjs')).href);
  assert.deepEqual(Object.keys(core).sort(), ['compileDelegation', 'evaluateHandoff']);
  const compiled = core.compileDelegation({
    protocol: 'cognitive-adoption',
    schemaVersion: '1',
    developerEvents: [{
      key: 'request', content: 'Deliver an inspectable Cognitive Adoption task.',
    }],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Expose the Cognitive Adoption workflow.',
      constraints: [], nonGoals: [], focus: [],
    },
    materialDecisionForks: [],
    conditions: [],
    hostPolicyRequirements: [],
    executionBudget: { checkTimeoutMs: 300_000, maxDeliveryRepairs: 1 },
    noCommandRationale: 'The isolated Core smoke has no repository command surface.',
  });
  assert.equal(compiled.status, 'delegation-compiled');
  const contract = compiled.contract;
  const changedFile = {
    id: 'file:example', path: 'example.ts', operation: 'modified',
    before: { kind: 'file', contentDigest: sha256('before'), mode: '100644' },
    after: { kind: 'file', contentDigest: sha256('after'), mode: '100644' },
    representation: 'text',
  };
  const summary = (name) => ({
    head: null, fingerprint: sha256(name), entryCount: 1,
  });
  const bundleBase = {
    protocol: 'cognitive-adoption', schemaVersion: '1',
    effectiveContractId: contract.effectiveContractId,
    attemptId: 'attempt:1',
    baseline: summary('baseline'), preCheck: summary('current'), current: summary('current'),
    baselineVerification: (() => {
      const value = {
        preCheck: summary('baseline'), postCheck: summary('baseline'),
        preCheckExecutionInputs: [], postCheckExecutionInputs: [],
        checkInducedChanges: [], checks: [],
      };
      return { fingerprint: stableFingerprint(value), ...value };
    })(),
    preCheckExecutionInputs: [], currentExecutionInputs: [],
    changeFingerprint: stableFingerprint([changedFile]),
    changedFiles: [changedFile], checkInducedChanges: [], checks: [], checkComparisons: [],
    evidenceConcerns: [], verifierMutations: [],
    environment: {
      platform: process.platform, architecture: process.arch, executables: [],
    },
    patch: { path: 'change.patch', digest: sha256('patch'), byteLength: 5 },
    provenance: { collector: 'stetra-cli', cliVersion: expectedVersion, coreVersion: expectedVersion },
  };
  const factCollectionId = collectionFingerprint(bundleBase);
  const factBundle = { ...bundleBase, factCollectionId };
  const handoffProjection = {
    protocol: 'cognitive-adoption', schemaVersion: '1', handoffId: 'handoff:smoke',
    effectiveContractId: contract.effectiveContractId,
    attemptId: factBundle.attemptId, factCollectionId,
    actualChange: {
      behavior: 'The isolated consumer exposes the Cognitive Adoption kernel.',
      mechanism: ['The two public Core operations remain the complete runtime surface.'],
      preservedInvariants: ['Human adoption remains separate from Agent recommendation.'],
      failureAndRecovery: [],
      importantEffects: ['Two public operations remain.'],
      materialTradeoffs: [],
    },
    obligationConclusions: [],
    conditionConclusions: [],
    residualUnknowns: [], reviewQuestions: [],
    recommendation: { action: 'accept', rationale: 'The installed API matches the contract.', caveats: [] },
  };
  const handoff = {
    ...handoffProjection,
    handoffFingerprint: stableFingerprint(handoffProjection),
  };
  const evaluation = core.evaluateHandoff({
    protocol: 'cognitive-adoption', schemaVersion: '1', contract, factBundle,
    currentWorktreeFingerprint: factBundle.current.fingerprint,
    challenges: [], hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  assert.equal(evaluation.status, 'handoff-ready');
  assert.deepEqual(evaluation.adoption, { authority: 'human', status: 'pending' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function collectionFingerprint(bundle) {
  return stableFingerprint({
    protocol: bundle.protocol, schemaVersion: bundle.schemaVersion,
    effectiveContractId: bundle.effectiveContractId, attemptId: bundle.attemptId,
    baseline: bundle.baseline, preCheck: bundle.preCheck, current: bundle.current,
    preCheckExecutionInputs: bundle.preCheckExecutionInputs,
    currentExecutionInputs: bundle.currentExecutionInputs,
    baselineVerification: bundle.baselineVerification,
    changeFingerprint: bundle.changeFingerprint, changedFiles: bundle.changedFiles,
    checkInducedChanges: bundle.checkInducedChanges, checks: bundle.checks,
    checkComparisons: bundle.checkComparisons,
    evidenceConcerns: bundle.evidenceConcerns,
    verifierMutations: bundle.verifierMutations, environment: bundle.environment,
    patch: bundle.patch ?? null, provenance: bundle.provenance,
  });
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
  const created = readdirSync(destination).filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, [`Command failed: ${command} ${args.join(' ')}`, result.stdout, result.stderr].join('\n'));
  return result;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
