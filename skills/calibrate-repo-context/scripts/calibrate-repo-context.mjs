import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PLUGIN_ROOT = resolve(import.meta.dirname, '../../..');

async function main(argv) {
  const [command, projectRootInput, ...rest] = argv;
  if (!command || !projectRootInput) {
    throw new Error('Usage: calibrate-repo-context.mjs <prepare|commit|approve|validate|refresh-stale> <project-root> [options]');
  }
  const { flags } = parseFlags(rest);
  const projectRoot = resolve(projectRootInput);
  const pluginRoot = resolve(single(flags, 'plugin-root') ?? DEFAULT_PLUGIN_ROOT);
  const rccl = await loadRccl(pluginRoot);

  if (command === 'prepare') {
    assertAllowed(flags, ['evidence', 'plugin-root']);
    const result = rccl.prepareCalibration({
      projectRoot,
      evidenceSelections: multiple(flags, 'evidence').map(parseEvidenceSelection),
    });
    if (result.status === 'rejected') process.exitCode = 1;
    return result;
  }
  if (command === 'commit') {
    assertAllowed(flags, ['input', 'contract', 'rccl-path', 'plugin-root']);
    const input = single(flags, 'input');
    const contract = single(flags, 'contract');
    if (!input) throw new Error('commit requires --input <proposal.yaml|proposal.json|->.');
    if (!contract) throw new Error('commit requires --contract <prepare-output.json>.');
    if (input === '-' && contract === '-') throw new Error('--input and --contract cannot both read stdin.');
    const result = rccl.commitCalibration({
      projectRoot,
      contract: readContract(contract),
      proposal: readInput(input),
      rcclPath: single(flags, 'rccl-path'),
    });
    if (result.status === 'rejected') process.exitCode = 1;
    return result;
  }
  if (command === 'approve') {
    assertAllowed(flags, ['id', 'approved-by', 'rccl-path', 'plugin-root']);
    const approvedBy = single(flags, 'approved-by');
    if (!approvedBy) throw new Error('approve requires --approved-by <reviewer> and at least one --id <observation-id>.');
    const result = rccl.approveContext({
      projectRoot,
      observationIds: multiple(flags, 'id'),
      approvedBy,
      rcclPath: single(flags, 'rccl-path'),
    });
    if (result.status === 'rejected') process.exitCode = 1;
    return result;
  }
  if (command === 'validate' || command === 'refresh-stale') {
    assertAllowed(flags, ['rccl-path', 'plugin-root']);
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
  const module = await import(`${pathToFileURL(dist).href}?v=3`);
  if (typeof module.prepareCalibration !== 'function'
    || typeof module.commitCalibration !== 'function'
    || typeof module.approveContext !== 'function'
    || typeof module.validateContext !== 'function') {
    throw new Error(`RCCL dist at ${dist} does not expose the current lifecycle.`);
  }
  return module;
}

function readInput(path) {
  return path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8');
}

function readContract(path) {
  const text = readInput(path);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('--contract must name the JSON output written by prepare.');
  }
  return parsed?.contract ?? parsed;
}

function parseEvidenceSelection(value) {
  const match = /^(.*):([1-9]\d*)-([1-9]\d*)$/.exec(value);
  if (!match || !match[1]) throw new Error(`Invalid --evidence ${value}; expected <repository-file>:<start>-<end>.`);
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (end < start) throw new Error(`Invalid --evidence ${value}; end must be greater than or equal to start.`);
  return { file: match[1], lineRange: [start, end] };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
