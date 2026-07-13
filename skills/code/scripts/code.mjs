import { fileURLToPath } from 'node:url';

import {
  autoCodeTask,
  completeCodeTask,
  explainCodeSession,
  getCodeStatus,
  prepareAdherenceEvaluation,
  prepareCodeTask,
  prepareGovernanceEvolution,
  prepareInterpretation,
  prepareRelations,
  reportContextAcquisition,
  reportGovernanceEvolution,
} from '../internal/workflow.mjs';

export {
  autoCodeTask,
  completeCodeTask,
  explainCodeSession,
  getCodeStatus,
  prepareAdherenceEvaluation,
  prepareCodeTask,
  prepareGovernanceEvolution,
  prepareInterpretation,
  prepareRelations,
  reportContextAcquisition,
  reportGovernanceEvolution,
} from '../internal/workflow.mjs';

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error('Expected a command: auto, status, doctor, explain, prepare-interpretation, prepare-relations, prepare, prepare-governance-evolution, report-context-acquisition, report-governance-evolution, prepare-adherence, or complete.');
  }

  if (command === 'auto' || command === 'prepare-interpretation' || command === 'prepare-relations' || command === 'prepare') {
    const { positionals, flags } = parseFlags(rest);
    rejectRemovedFlags(flags, ['planning-file', 'candidate-file', 'host-proposal-file', 'semantic-proposal-file']);
    const projectRoot = positionals[0];
    const taskDescription = readSingleFlag(flags, 'task');
    if (!projectRoot) throw new Error(`${command} requires <project-root>.`);
    if (!taskDescription) throw new Error(`${command} requires --task "<description>".`);
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: readSingleFlag(flags, 'plugin-root'),
        taskDescription,
        guidanceMode: readSingleFlag(flags, 'mode'),
        taskModelFile: readSingleFlag(flags, 'task-model-file'),
        governanceGraphFile: readSingleFlag(flags, 'governance-graph-file'),
        verificationPolicy: readSingleFlag(flags, 'verification-policy'),
        targetFile: readSingleFlag(flags, 'target-file'),
        changedFiles: readMultiFlag(flags, 'changed-file'),
        techStack: readMultiFlag(flags, 'tech'),
        tags: readMultiFlag(flags, 'tag'),
        operation: readSingleFlag(flags, 'operation'),
        projectStage: readSingleFlag(flags, 'project-stage'),
        optimizationTarget: readSingleFlag(flags, 'optimization-target'),
        hardConstraints: readMultiFlag(flags, 'hard-constraint'),
        allowedTradeoffs: readMultiFlag(flags, 'allowed-tradeoff'),
        avoid: readMultiFlag(flags, 'avoid'),
        riskLevel: readSingleFlag(flags, 'risk-level'),
        scopeSize: readSingleFlag(flags, 'scope-size'),
        compatibilityRequirement: readSingleFlag(flags, 'compatibility-requirement'),
        interfaceSensitivity: readSingleFlag(flags, 'interface-sensitivity'),
        refactorTolerance: readSingleFlag(flags, 'refactor-tolerance'),
        migrationPhase: readSingleFlag(flags, 'migration-phase'),
        reviewGoal: readSingleFlag(flags, 'review-goal'),
      },
    };
  }

  if (command === 'prepare-adherence') {
    const { flags } = parseFlags(rest);
    const sessionPath = readSingleFlag(flags, 'session');
    if (!sessionPath) throw new Error('prepare-adherence requires --session <path>.');
    return {
      command,
      options: { sessionPath },
    };
  }

  if (command === 'status' || command === 'doctor') {
    const { positionals, flags } = parseFlags(rest);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error('status requires <project-root>.');
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: readSingleFlag(flags, 'plugin-root'),
      },
    };
  }

  if (command === 'explain') {
    const { flags } = parseFlags(rest);
    const sessionPath = readSingleFlag(flags, 'session');
    if (!sessionPath) throw new Error('explain requires --session <path>.');
    return {
      command,
      options: { sessionPath },
    };
  }

  if (command === 'complete') {
    const { flags } = parseFlags(rest, ['auto-unverified']);
    rejectRemovedFlags(flags, ['followed', 'ignored', 'ignored-reason', 'signal-confidence']);
    const sessionPath = readSingleFlag(flags, 'session');
    if (!sessionPath) throw new Error('complete requires --session <path>.');
    const adherenceFile = readSingleFlag(flags, 'adherence-file');
    const autoUnverified = readBooleanFlag(flags, 'auto-unverified');
    if (!adherenceFile && !autoUnverified) throw new Error('complete requires --adherence-file <path> or --auto-unverified.');
    return {
      command,
      options: {
        sessionPath,
        adherenceFile,
        autoUnverified,
      },
    };
  }

  if (command === 'prepare-governance-evolution') {
    const { positionals, flags } = parseFlags(rest);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error('prepare-governance-evolution requires <project-root>.');
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: readSingleFlag(flags, 'plugin-root'),
        artifactPath: readSingleFlag(flags, 'artifact-path'),
      },
    };
  }

  if (command === 'report-context-acquisition') {
    const { positionals, flags } = parseFlags(rest);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error('report-context-acquisition requires <project-root>.');
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: readSingleFlag(flags, 'plugin-root'),
        contextAcquisitionFile: readSingleFlag(flags, 'context-acquisition-file'),
        sessionPath: readSingleFlag(flags, 'session'),
      },
    };
  }

  if (command === 'report-governance-evolution') {
    const { positionals, flags } = parseFlags(rest);
    const projectRoot = positionals[0];
    if (!projectRoot) throw new Error('report-governance-evolution requires <project-root>.');
    return {
      command,
      options: {
        projectRoot,
        pluginRoot: readSingleFlag(flags, 'plugin-root'),
        proposalFile: readSingleFlag(flags, 'proposal-file'),
        sessionPath: readSingleFlag(flags, 'session'),
      },
    };
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseFlags(argv, booleanFlags = []) {
  const positionals = [];
  const flags = new Map();
  const booleanFlagSet = new Set(booleanFlags);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      if (booleanFlagSet.has(key)) {
        flags.set(key, ['true']);
        continue;
      }
      throw new Error(`Flag ${token} requires a value.`);
    }
    const values = flags.get(key) ?? [];
    values.push(next);
    flags.set(key, values);
    index += 1;
  }
  return { positionals, flags };
}

function readSingleFlag(flags, key) {
  return flags.get(key)?.[0];
}

function readMultiFlag(flags, key) {
  return flags.get(key) ?? [];
}

function readBooleanFlag(flags, key) {
  const value = readSingleFlag(flags, key);
  if (value === undefined) return false;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function rejectRemovedFlags(flags, removed) {
  for (const flag of removed) {
    if (flags.has(flag)) {
      throw new Error(`Flag --${flag} was removed by the ai-contract/v1 workflow. Use --task-model-file, --governance-graph-file, or --adherence-file as appropriate.`);
    }
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  let result;
  if (parsed.command === 'prepare-interpretation') result = await prepareInterpretation(parsed.options);
  else if (parsed.command === 'auto') result = await autoCodeTask(parsed.options);
  else if (parsed.command === 'status' || parsed.command === 'doctor') result = await getCodeStatus(parsed.options);
  else if (parsed.command === 'prepare-governance-evolution') result = await prepareGovernanceEvolution(parsed.options);
  else if (parsed.command === 'report-context-acquisition') result = await reportContextAcquisition(parsed.options);
  else if (parsed.command === 'report-governance-evolution') result = await reportGovernanceEvolution(parsed.options);
  else if (parsed.command === 'explain') result = await explainCodeSession(parsed.options);
  else if (parsed.command === 'prepare-relations') result = await prepareRelations(parsed.options);
  else if (parsed.command === 'prepare') result = await prepareCodeTask(parsed.options);
  else if (parsed.command === 'prepare-adherence') result = await prepareAdherenceEvaluation(parsed.options);
  else result = await completeCodeTask(parsed.options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
