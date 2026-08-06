import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY_URL = 'https://github.com/Sovea/resonant-code.git';
const REGISTRY_URL = 'https://registry.npmjs.org/';
const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function createReleasePlan({
  tag,
  releaseIsPrerelease,
  repositoryPrivate,
  coreManifest,
  cliManifest,
  productVersion,
}) {
  if (repositoryPrivate) {
    throw new Error(
      'Trusted publication requires a public repository so npm can attach provenance.',
    );
  }
  if (!tag?.startsWith('v')) {
    throw new Error(`Release tag must start with v: ${tag || '<empty>'}`);
  }

  const version = tag.slice(1);
  const match = SEMANTIC_VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`Release tag is not valid SemVer: ${tag}`);
  const prerelease = match[4] ?? null;
  const expectedPrerelease = prerelease !== null;
  if (releaseIsPrerelease !== expectedPrerelease) {
    throw new Error(
      `GitHub prerelease flag ${releaseIsPrerelease} does not match tag ${tag}.`,
    );
  }

  assertPackageManifest(coreManifest, {
    name: '@sovea/resonant-code-core',
    version,
  });
  assertPackageManifest(cliManifest, {
    name: '@sovea/resonant-code',
    version,
  });
  if (productVersion !== version) {
    throw new Error(
      `CLI product version ${productVersion} does not match release ${version}.`,
    );
  }
  if (cliManifest.dependencies?.['@sovea/resonant-code-core'] !== 'workspace:*') {
    throw new Error('CLI source dependency on Core must remain workspace:* before packing.');
  }

  return {
    tag,
    version,
    prerelease: expectedPrerelease,
    distTag: deriveDistTag(prerelease),
  };
}

export function deriveDistTag(prerelease) {
  if (prerelease === null) return 'latest';
  const channel = prerelease.split('.')[0].toLowerCase();
  if (['alpha', 'beta', 'rc'].includes(channel)) return channel;
  return 'next';
}

export function loadReleaseSource(workspaceRoot) {
  const coreManifest = readJson(resolve(workspaceRoot, 'packages/core/package.json'));
  const cliManifest = readJson(resolve(workspaceRoot, 'packages/cli/package.json'));
  const versionSource = readFileSync(
    resolve(workspaceRoot, 'packages/cli/src/version.ts'),
    'utf8',
  );
  const productVersion = versionSource.match(
    /PRODUCT_VERSION\s*=\s*'([^']+)'/,
  )?.[1];
  if (!productVersion) {
    throw new Error('Could not read PRODUCT_VERSION from packages/cli/src/version.ts.');
  }
  return { coreManifest, cliManifest, productVersion };
}

function assertPackageManifest(manifest, expected) {
  if (manifest.name !== expected.name) {
    throw new Error(`Expected package ${expected.name}, found ${manifest.name}.`);
  }
  if (manifest.version !== expected.version) {
    throw new Error(
      `${expected.name} version ${manifest.version} does not match release ${expected.version}.`,
    );
  }
  if (manifest.repository?.url !== REPOSITORY_URL) {
    throw new Error(`${expected.name} repository must be ${REPOSITORY_URL}.`);
  }
  if (manifest.publishConfig?.access !== 'public') {
    throw new Error(`${expected.name} publish access must be public.`);
  }
  if (manifest.publishConfig?.registry !== REGISTRY_URL) {
    throw new Error(`${expected.name} registry must be ${REGISTRY_URL}.`);
  }
  if (manifest.publishConfig?.provenance !== undefined) {
    throw new Error(
      `${expected.name} must rely on automatic trusted-publishing provenance.`,
    );
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requiredBooleanEnvironment(name) {
  const value = process.env[name];
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false.`);
}

function run() {
  const workspaceRoot = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const plan = createReleasePlan({
    tag: process.env.RELEASE_TAG,
    releaseIsPrerelease: requiredBooleanEnvironment('RELEASE_IS_PRERELEASE'),
    repositoryPrivate: requiredBooleanEnvironment('REPOSITORY_PRIVATE'),
    ...loadReleaseSource(workspaceRoot),
  });

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tag=${plan.tag}\nversion=${plan.version}\ndist_tag=${plan.distTag}\n`,
      'utf8',
    );
  }
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
