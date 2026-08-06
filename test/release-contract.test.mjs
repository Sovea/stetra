import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  createReleasePlan,
  deriveDistTag,
  formatReleaseOutputs,
  loadReleaseSource,
} from '../scripts/release-contract.mjs';
import {
  prepareReleaseVersion,
  RELEASE_VERSION_FILES,
} from '../scripts/prepare-release-version.mjs';
import {
  classifyPublishState,
  tarballIntegrity,
  validatePublishedPackage,
} from '../scripts/publish-release.mjs';

const root = resolve(import.meta.dirname, '..');
const source = loadReleaseSource(root);

test('current source forms a stable release plan', () => {
  assert.doesNotMatch(source.productVersion, /[-+]/);
  assert.deepEqual(createReleasePlan({
    tag: `v${source.productVersion}`,
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
  }), {
    tag: `v${source.productVersion}`,
    sourceVersion: source.productVersion,
    version: source.productVersion,
    prerelease: false,
    prepareVersion: false,
    distTag: 'latest',
  });
});

test('release channels follow the semantic prerelease identifier', () => {
  assert.equal(deriveDistTag('alpha.1'), 'alpha');
  assert.equal(deriveDistTag('BETA.2'), 'beta');
  assert.equal(deriveDistTag('rc.0'), 'rc');
  assert.equal(deriveDistTag('canary.5'), 'next');
  assert.equal(deriveDistTag(null), 'latest');
});

test('a prerelease plan derives a transient version from a matching stable baseline', () => {
  const version = `${source.productVersion}-alpha.1`;
  const plan = createReleasePlan({
    tag: `v${version}`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...source,
  });
  assert.deepEqual(plan, {
    tag: `v${version}`,
    sourceVersion: source.productVersion,
    version,
    prerelease: true,
    prepareVersion: true,
    distTag: 'alpha',
  });
  assert.equal(
    formatReleaseOutputs(plan),
    [
      `tag=v${version}`,
      `source_version=${source.productVersion}`,
      `version=${version}`,
      'prepare_version=true',
      'dist_tag=alpha',
      '',
    ].join('\n'),
  );
  assert.throws(() => createReleasePlan({
    tag: `v${version}`,
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
  }), /prerelease flag/);
  assert.throws(() => createReleasePlan({
    tag: `v${source.productVersion}-alpha.01`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...source,
  }), /valid SemVer/);
  assert.throws(() => createReleasePlan({
    tag: `v${version}+build.1`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...source,
  }), /build metadata/);
});

test('private repositories, unstable baselines, and version mismatches cannot publish', () => {
  const nextVersion = nextPatch(source.productVersion);
  assert.throws(() => createReleasePlan({
    tag: `v${source.productVersion}`,
    releaseIsPrerelease: false,
    repositoryPrivate: true,
    ...source,
  }), /public repository/);
  assert.throws(() => createReleasePlan({
    tag: `v${nextVersion}`,
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
  }), /Stable release .* must match committed source baseline/);
  assert.throws(() => createReleasePlan({
    tag: `v${nextVersion}-alpha.0`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...source,
  }), /must use committed source baseline/);
  assert.throws(() => createReleasePlan({
    tag: `v${source.productVersion}`,
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
    productVersion: nextVersion,
  }), /CLI product version/);
  assert.throws(() => createReleasePlan({
    tag: `v${source.productVersion}`,
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
    cliManifest: { ...source.cliManifest, version: nextVersion },
  }), /Core source version/);
  assert.throws(() => createReleasePlan({
    tag: `v${source.productVersion}-alpha.1`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...sourceAtVersion(`${source.productVersion}-alpha.1`),
  }), /stable SemVer baseline/);
});

test('prerelease preparation changes only the three release version locations', (context) => {
  const fixture = createReleaseFixture(context);
  const version = `${source.productVersion}-alpha.7`;
  const before = new Map(
    [...RELEASE_VERSION_FILES, 'sentinel.txt'].map((path) => [
      path,
      readFileSync(resolve(fixture, path), 'utf8'),
    ]),
  );

  assert.throws(() => prepareReleaseVersion({
    workspaceRoot: fixture,
    sourceVersion: nextPatch(source.productVersion),
    releaseVersion: version,
  }), /Expected committed source version/);
  assert.deepEqual(prepareReleaseVersion({
    workspaceRoot: fixture,
    sourceVersion: source.productVersion,
    releaseVersion: version,
  }), {
    sourceVersion: source.productVersion,
    version,
    changedFiles: [...RELEASE_VERSION_FILES],
  });

  const prepared = loadReleaseSource(fixture);
  assert.equal(prepared.coreManifest.version, version);
  assert.equal(prepared.cliManifest.version, version);
  assert.equal(prepared.productVersion, version);
  assert.equal(
    readFileSync(resolve(fixture, 'sentinel.txt'), 'utf8'),
    before.get('sentinel.txt'),
  );
  for (const path of RELEASE_VERSION_FILES) {
    const expected = before.get(path).replaceAll(source.productVersion, version);
    assert.equal(readFileSync(resolve(fixture, path), 'utf8'), expected);
  }
});

test('publish recovery accepts only an ordered Core then CLI state', () => {
  assert.equal(classifyPublishState(null, null), 'new');
  assert.equal(classifyPublishState({ name: 'core' }, null), 'resume-cli');
  assert.equal(classifyPublishState({ name: 'core' }, { name: 'cli' }), 'complete');
  assert.throws(() => classifyPublishState(null, { name: 'cli' }), /Core version is absent/);
});

test('registry recovery requires identical artifacts and provenance', () => {
  const fixture = resolve(import.meta.dirname, 'release-contract.test.mjs');
  const integrity = `sha512-${createHash('sha512')
    .update(readFileSync(fixture))
    .digest('base64')}`;
  assert.equal(tarballIntegrity(fixture), integrity);
  const record = {
    name: '@sovea/resonant-code',
    version: '0.0.1-alpha.1',
    dependencies: { '@sovea/resonant-code-core': '0.0.1-alpha.1' },
    dist: {
      integrity,
      attestations: {
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  };
  assert.equal(validatePublishedPackage(record, {
    name: record.name,
    version: record.version,
    integrity,
    coreVersion: record.version,
  }), record);
  assert.throws(() => validatePublishedPackage({
    ...record,
    dist: { ...record.dist, integrity: 'sha512-different' },
  }, {
    name: record.name,
    version: record.version,
    integrity,
    coreVersion: record.version,
  }), /integrity/);
  assert.throws(() => validatePublishedPackage({
    ...record,
    dist: { integrity },
  }, {
    name: record.name,
    version: record.version,
    integrity,
    coreVersion: record.version,
  }), /no npm provenance/);
});

function sourceAtVersion(version) {
  return {
    coreManifest: { ...source.coreManifest, version },
    cliManifest: { ...source.cliManifest, version },
    productVersion: version,
  };
}

function nextPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function createReleaseFixture(context) {
  const fixture = mkdtempSync(join(tmpdir(), 'resonant-release-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(resolve(fixture, 'packages/core'), { recursive: true });
  mkdirSync(resolve(fixture, 'packages/cli/src'), { recursive: true });
  writeFileSync(
    resolve(fixture, 'packages/core/package.json'),
    `${JSON.stringify(source.coreManifest, null, 2)}\n`,
  );
  writeFileSync(
    resolve(fixture, 'packages/cli/package.json'),
    `${JSON.stringify(source.cliManifest, null, 2)}\n`,
  );
  writeFileSync(
    resolve(fixture, 'packages/cli/src/version.ts'),
    readFileSync(resolve(root, 'packages/cli/src/version.ts'), 'utf8'),
  );
  writeFileSync(resolve(fixture, 'sentinel.txt'), 'unchanged\n');
  return fixture;
}
