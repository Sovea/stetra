import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyReleaseInstallation(installationRoot, expectedVersion) {
  const coreRoot = resolve(
    installationRoot,
    'node_modules/@sovea/stetra-core',
  );
  const cliRoot = resolve(
    installationRoot,
    'node_modules/@sovea/stetra',
  );
  const coreManifest = readJson(resolve(coreRoot, 'package.json'));
  const cliManifest = readJson(resolve(cliRoot, 'package.json'));

  assert.equal(coreManifest.name, '@sovea/stetra-core');
  assert.equal(cliManifest.name, '@sovea/stetra');
  assert.equal(coreManifest.version, expectedVersion);
  assert.equal(cliManifest.version, expectedVersion);
  assert.equal(
    cliManifest.dependencies?.['@sovea/stetra-core'],
    expectedVersion,
    'Packed CLI must depend on the exact matching Core version.',
  );

  const core = await import(pathToFileURL(resolve(coreRoot, 'dist/index.mjs')).href);
  assert.deepEqual(
    Object.keys(core).sort(),
    ['compileDelegation', 'evaluateHandoff'],
  );

  const cliEntrypoint = resolve(cliRoot, cliManifest.bin['stetra']);
  const result = spawnSync(process.execPath, [cliEntrypoint, '--version'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expectedVersion);
  assert.deepEqual(cliManifest.exports?.['./host'], {
    types: './dist/host.d.mts',
    import: './dist/host.mjs',
  });
  const host = await import(pathToFileURL(resolve(cliRoot, 'dist/host.mjs')).href);
  assert.deepEqual(Object.keys(host).sort(), [
    'CliError',
    'HostChallengeLifecycle',
    'formatCliError',
    'formatCliOutput',
    'guardFinalResponse',
    'normalizeCliError',
    'runCli',
  ]);

  return {
    core: `${coreManifest.name}@${coreManifest.version}`,
    cli: `${cliManifest.name}@${cliManifest.version}`,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return process.argv[index + 1];
}

async function run() {
  const result = await verifyReleaseInstallation(
    resolve(readArgument('--root')),
    readArgument('--version'),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
