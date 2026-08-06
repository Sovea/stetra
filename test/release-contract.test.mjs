import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createReleasePlan,
  deriveDistTag,
  loadReleaseSource,
} from '../scripts/release-contract.mjs';
import {
  classifyPublishState,
  tarballIntegrity,
  validatePublishedPackage,
} from '../scripts/publish-release.mjs';

const root = resolve(import.meta.dirname, '..');
const source = loadReleaseSource(root);

test('current source forms a release plan without hard-coded package versions', () => {
  const prerelease = source.productVersion.match(/^[^-]+-(.+?)(?:\+.*)?$/)?.[1] ?? null;
  assert.deepEqual(createReleasePlan({
    tag: `v${source.productVersion}`,
    releaseIsPrerelease: prerelease !== null,
    repositoryPrivate: false,
    ...source,
  }), {
    tag: `v${source.productVersion}`,
    version: source.productVersion,
    prerelease: prerelease !== null,
    distTag: deriveDistTag(prerelease),
  });
});

test('release channels follow the semantic prerelease identifier', () => {
  assert.equal(deriveDistTag('alpha.1'), 'alpha');
  assert.equal(deriveDistTag('BETA.2'), 'beta');
  assert.equal(deriveDistTag('rc.0'), 'rc');
  assert.equal(deriveDistTag('canary.5'), 'next');
  assert.equal(deriveDistTag(null), 'latest');
});

test('a prerelease plan requires matching source and GitHub metadata', () => {
  const prereleaseSource = sourceAtVersion('0.0.1-alpha.1');
  const plan = createReleasePlan({
    tag: 'v0.0.1-alpha.1',
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...prereleaseSource,
  });
  assert.equal(plan.distTag, 'alpha');
  assert.throws(() => createReleasePlan({
    tag: 'v0.0.1-alpha.1',
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...prereleaseSource,
  }), /prerelease flag/);
  assert.throws(() => createReleasePlan({
    tag: 'v0.0.1-alpha.01',
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...prereleaseSource,
  }), /valid SemVer/);
});

test('private repositories and inconsistent source versions cannot publish', () => {
  assert.throws(() => createReleasePlan({
    tag: 'v0.0.1',
    releaseIsPrerelease: false,
    repositoryPrivate: true,
    ...source,
  }), /public repository/);
  assert.throws(() => createReleasePlan({
    tag: 'v0.0.2',
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
  }), /does not match release/);
  assert.throws(() => createReleasePlan({
    tag: 'v0.0.1',
    releaseIsPrerelease: false,
    repositoryPrivate: false,
    ...source,
    productVersion: '0.0.2',
  }), /CLI product version/);
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
