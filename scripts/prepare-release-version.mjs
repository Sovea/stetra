import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createReleasePlan,
  loadReleaseSource,
} from './release-contract.mjs';

export const RELEASE_VERSION_FILES = Object.freeze([
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/cli/src/version.ts',
]);

export function prepareReleaseVersion({
  workspaceRoot,
  sourceVersion,
  releaseVersion,
}) {
  const root = resolve(workspaceRoot);
  const releaseSource = loadReleaseSource(root);
  const plan = createReleasePlan({
    tag: `v${releaseVersion}`,
    releaseIsPrerelease: true,
    repositoryPrivate: false,
    ...releaseSource,
  });

  if (plan.sourceVersion !== sourceVersion) {
    throw new Error(
      `Expected committed source version ${sourceVersion}, found ${plan.sourceVersion}.`,
    );
  }
  if (!plan.prepareVersion) {
    throw new Error(`Release ${releaseVersion} does not require version preparation.`);
  }

  const [corePath, cliPath, productVersionPath] = RELEASE_VERSION_FILES.map(
    (path) => resolve(root, path),
  );
  const updates = [
    {
      path: corePath,
      content: replacePackageVersion(
        readFileSync(corePath, 'utf8'),
        sourceVersion,
        releaseVersion,
        '@sovea/stetra-core',
      ),
    },
    {
      path: cliPath,
      content: replacePackageVersion(
        readFileSync(cliPath, 'utf8'),
        sourceVersion,
        releaseVersion,
        '@sovea/stetra',
      ),
    },
    {
      path: productVersionPath,
      content: replaceProductVersion(
        readFileSync(productVersionPath, 'utf8'),
        sourceVersion,
        releaseVersion,
      ),
    },
  ];

  for (const update of updates) {
    writeFileSync(update.path, update.content, 'utf8');
  }

  const prepared = loadReleaseSource(root);
  if (
    prepared.coreManifest.version !== releaseVersion
    || prepared.cliManifest.version !== releaseVersion
    || prepared.productVersion !== releaseVersion
  ) {
    throw new Error(`Release version preparation did not produce ${releaseVersion}.`);
  }

  return {
    sourceVersion,
    version: releaseVersion,
    changedFiles: [...RELEASE_VERSION_FILES],
  };
}

function replacePackageVersion(content, expected, replacement, packageName) {
  let replacements = 0;
  const updated = content.replace(
    /^(\s*"version"\s*:\s*")([^"]+)("\s*,?\s*)$/gm,
    (line, prefix, current, suffix) => {
      replacements += 1;
      if (current !== expected) {
        throw new Error(
          `${packageName} source version ${current} does not match ${expected}.`,
        );
      }
      return `${prefix}${replacement}${suffix}`;
    },
  );
  if (replacements !== 1) {
    throw new Error(
      `${packageName} manifest must contain exactly one standalone version field.`,
    );
  }
  return updated;
}

function replaceProductVersion(content, expected, replacement) {
  let replacements = 0;
  const updated = content.replace(
    /^(\s*export const PRODUCT_VERSION\s*=\s*')([^']+)(';\s*)$/gm,
    (line, prefix, current, suffix) => {
      replacements += 1;
      if (current !== expected) {
        throw new Error(
          `CLI product version ${current} does not match ${expected}.`,
        );
      }
      return `${prefix}${replacement}${suffix}`;
    },
  );
  if (replacements !== 1) {
    throw new Error(
      'packages/cli/src/version.ts must contain exactly one PRODUCT_VERSION declaration.',
    );
  }
  return updated;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function run() {
  const result = prepareReleaseVersion({
    workspaceRoot: resolve(process.env.GITHUB_WORKSPACE ?? process.cwd()),
    sourceVersion: requiredEnvironment('SOURCE_VERSION'),
    releaseVersion: requiredEnvironment('RELEASE_VERSION'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
