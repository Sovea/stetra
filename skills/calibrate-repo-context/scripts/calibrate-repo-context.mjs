import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PLUGIN_ROOT = resolve(import.meta.dirname, '../../..');

async function main(argv) {
  const [command, projectRootInput, ...rest] = argv;
  if (!command || !projectRootInput) {
    throw new Error('Usage: calibrate-repo-context.mjs <prepare|commit|validate|refresh-stale> <project-root> [options]');
  }
  const { flags } = parseFlags(rest);
  assertAllowed(flags, ['path', 'scope', 'max-files', 'input', 'rccl-path', 'plugin-root']);
  const projectRoot = resolve(projectRootInput);
  const pluginRoot = resolve(single(flags, 'plugin-root') ?? DEFAULT_PLUGIN_ROOT);
  const rccl = await loadRccl(pluginRoot);
  const base = {
    projectRoot,
    paths: multiple(flags, 'path'),
    scope: single(flags, 'scope'),
    maxFiles: positiveInteger(single(flags, 'max-files'), 'max-files'),
  };

  if (command === 'prepare') {
    return rccl.prepareCalibration(base);
  }
  if (command === 'commit') {
    const input = single(flags, 'input');
    if (!input) throw new Error('commit requires --input <proposal.yaml|proposal.json|->.');
    const result = rccl.commitCalibration({
      ...base,
      proposal: readInput(input),
      rcclPath: single(flags, 'rccl-path'),
    });
    if (result.status === 'rejected') process.exitCode = 1;
    return result;
  }
  if (command === 'validate' || command === 'refresh-stale') {
    return rccl.validateContext({
      projectRoot,
      rcclPath: single(flags, 'rccl-path'),
      write: command === 'refresh-stale',
    });
  }
  throw new Error(`Unknown command: ${command}.`);
}

async function loadRccl(pluginRoot) {
  const dist = join(pluginRoot, 'rccl', 'dist', 'index.mjs');
  if (!existsSync(dist)) throw new Error(`RCCL dist is missing: ${dist}. Run pnpm build.`);
  const module = await import(`${pathToFileURL(dist).href}?v=2`);
  if (typeof module.prepareCalibration !== 'function' || typeof module.commitCalibration !== 'function' || typeof module.validateContext !== 'function') {
    throw new Error(`RCCL dist at ${dist} does not expose the current lifecycle.`);
  }
  return module;
}

function readInput(path) {
  return path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8');
}

function parseFlags(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}.`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Flag ${token} requires a value.`);
    const values = flags.get(key) ?? [];
    values.push(value);
    flags.set(key, values);
    index += 1;
  }
  return { flags };
}

function assertAllowed(flags, allowed) {
  for (const key of flags.keys()) if (!allowed.includes(key)) throw new Error(`Unknown flag --${key}.`);
}

function single(flags, key) {
  const values = flags.get(key) ?? [];
  if (values.length > 1) throw new Error(`Flag --${key} may only be provided once.`);
  return values[0];
}

function multiple(flags, key) {
  return flags.get(key) ?? [];
}

function positiveInteger(value, label) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${label} must be a positive integer.`);
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
