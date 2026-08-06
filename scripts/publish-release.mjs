import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REGISTRY_URL = 'https://registry.npmjs.org/';
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const CORE_NAME = '@sovea/stetra-core';
const CLI_NAME = '@sovea/stetra';
const DIST_TAGS = new Set(['alpha', 'beta', 'rc', 'next', 'latest']);

export function tarballIntegrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

export function validatePublishedPackage(record, expected) {
  if (record?.name !== expected.name || record?.version !== expected.version) {
    throw new Error(
      `Registry identity does not match ${expected.name}@${expected.version}.`,
    );
  }
  if (record.dist?.integrity !== expected.integrity) {
    throw new Error(
      `Registry integrity does not match the prepared ${expected.name} tarball.`,
    );
  }
  if (record.dist?.attestations?.provenance?.predicateType !== PROVENANCE_PREDICATE) {
    throw new Error(`${expected.name}@${expected.version} has no npm provenance.`);
  }
  if (expected.coreVersion !== undefined
    && record.dependencies?.[CORE_NAME] !== expected.coreVersion) {
    throw new Error(
      `${expected.name}@${expected.version} does not pin Core ${expected.coreVersion}.`,
    );
  }
  return record;
}

export function classifyPublishState(coreRecord, cliRecord) {
  if (!coreRecord && cliRecord) {
    throw new Error('CLI exists in the registry while its matching Core version is absent.');
  }
  if (coreRecord && cliRecord) return 'complete';
  if (coreRecord) return 'resume-cli';
  return 'new';
}

async function fetchRegistryVersion(name, version) {
  const url = new URL(
    `${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    REGISTRY_URL,
  );
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Registry lookup failed for ${name}@${version}: ${response.status}.`);
  }
  return response.json();
}

async function waitForPublishedPackage(expected) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await fetchRegistryVersion(expected.name, expected.version);
    if (record) {
      try {
        return validatePublishedPackage(record, expected);
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
  }
  throw lastError ?? new Error(
    `${expected.name}@${expected.version} did not become visible in the registry.`,
  );
}

function publish(tarball, distTag) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, [
    'publish',
    tarball,
    '--access',
    'public',
    '--tag',
    distTag,
    '--registry',
    REGISTRY_URL,
  ], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`npm publish failed for ${tarball} with status ${result.status}.`);
  }
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return process.argv[index + 1];
}

async function run() {
  const version = requiredArgument('--version');
  const distTag = requiredArgument('--dist-tag');
  if (!DIST_TAGS.has(distTag)) {
    throw new Error(`Unsupported npm dist-tag: ${distTag}.`);
  }
  const coreTarball = resolve(requiredArgument('--core-tarball'));
  const cliTarball = resolve(requiredArgument('--cli-tarball'));
  const coreExpected = {
    name: CORE_NAME,
    version,
    integrity: tarballIntegrity(coreTarball),
  };
  const cliExpected = {
    name: CLI_NAME,
    version,
    integrity: tarballIntegrity(cliTarball),
    coreVersion: version,
  };

  let coreRecord = await fetchRegistryVersion(CORE_NAME, version);
  let cliRecord = await fetchRegistryVersion(CLI_NAME, version);
  if (coreRecord) validatePublishedPackage(coreRecord, coreExpected);
  if (cliRecord) validatePublishedPackage(cliRecord, cliExpected);
  const initialState = classifyPublishState(coreRecord, cliRecord);

  if (!coreRecord) {
    publish(coreTarball, distTag);
    coreRecord = await waitForPublishedPackage(coreExpected);
  }
  if (!cliRecord) {
    publish(cliTarball, distTag);
    cliRecord = await waitForPublishedPackage(cliExpected);
  }

  process.stdout.write(`${JSON.stringify({
    status: initialState === 'complete' ? 'already-published' : 'published',
    resumed: initialState === 'resume-cli',
    core: `${coreRecord.name}@${coreRecord.version}`,
    cli: `${cliRecord.name}@${cliRecord.version}`,
    distTag,
  })}\n`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
