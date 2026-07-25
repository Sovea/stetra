import { fileURLToPath } from 'node:url';

import {
  autoCodeTask,
  completeCodeTask,
  explainCodeSession,
  getCodeStatus,
  prepareCodeTask,
} from '../internal/workflow.mjs';

export {
  autoCodeTask,
  completeCodeTask,
  explainCodeSession,
  getCodeStatus,
  prepareCodeTask,
} from '../internal/workflow.mjs';

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('Expected a command: prepare, auto, complete, explain, status, or doctor.');

  if (command === 'prepare' || command === 'auto') {
    const { positionals, flags } = parseFlags(rest);
    assertAllowedFlags(flags, [
      'task', 'plugin-root', 'mode', 'change-type', 'target', 'tech', 'risk', 'scope',
      'constraint', 'uncertainty', 'avoid', 'relation-file', 'selection-file',
      'guidance-byte-limit',
    ]);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error(`${command} requires <project-root>.`);
    const taskDescription = single(flags, 'task');
    if (!taskDescription) throw new Error(`${command} requires --task "<description>".`);
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: single(flags, 'plugin-root'),
        taskDescription,
        guidanceMode: single(flags, 'mode'),
        changeType: single(flags, 'change-type'),
        targets: multiple(flags, 'target'),
        techStack: multiple(flags, 'tech'),
        risk: single(flags, 'risk'),
        scope: single(flags, 'scope'),
        constraints: multiple(flags, 'constraint'),
        uncertainties: multiple(flags, 'uncertainty'),
        avoid: multiple(flags, 'avoid'),
        relationFile: single(flags, 'relation-file'),
        selectionFile: single(flags, 'selection-file'),
        guidanceByteLimit: single(flags, 'guidance-byte-limit'),
      },
    };
  }

  if (command === 'complete') {
    const { positionals, flags } = parseFlags(rest);
    assertAllowedFlags(flags, ['session', 'evaluation-file']);
    if (positionals.length) throw new Error('complete does not accept positional arguments.');
    const sessionPath = single(flags, 'session');
    if (!sessionPath) throw new Error('complete requires --session <path>.');
    return {
      command,
      options: {
        sessionPath,
        evaluationFile: single(flags, 'evaluation-file'),
      },
    };
  }

  if (command === 'explain') {
    const { positionals, flags } = parseFlags(rest);
    assertAllowedFlags(flags, ['session']);
    if (positionals.length) throw new Error('explain does not accept positional arguments.');
    const sessionPath = single(flags, 'session');
    if (!sessionPath) throw new Error('explain requires --session <path>.');
    return { command, options: { sessionPath } };
  }

  if (command === 'status' || command === 'doctor') {
    const { positionals, flags } = parseFlags(rest);
    assertAllowedFlags(flags, ['plugin-root']);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error(`${command} requires <project-root>.`);
    return { command, options: { projectRoot, pluginRoot: single(flags, 'plugin-root') } };
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseFlags(argv) {
  const positionals = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Flag ${token} requires a value.`);
    const values = flags.get(key) ?? [];
    values.push(value);
    flags.set(key, values);
    index += 1;
  }
  return { positionals, flags };
}

function assertAllowedFlags(flags, allowed) {
  for (const key of flags.keys()) {
    if (!allowed.includes(key)) throw new Error(`Unknown flag --${key}.`);
  }
}

function single(flags, key) {
  const values = flags.get(key) ?? [];
  if (values.length > 1) throw new Error(`Flag --${key} may only be provided once.`);
  return values[0];
}

function multiple(flags, key) {
  return flags.get(key) ?? [];
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  let result;
  if (parsed.command === 'prepare') result = await prepareCodeTask(parsed.options);
  else if (parsed.command === 'auto') result = await autoCodeTask(parsed.options);
  else if (parsed.command === 'complete') result = await completeCodeTask(parsed.options);
  else if (parsed.command === 'explain') result = explainCodeSession(parsed.options);
  else result = await getCodeStatus(parsed.options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
