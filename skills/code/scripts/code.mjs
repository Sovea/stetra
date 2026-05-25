import { fileURLToPath } from 'node:url';

import {
  completeCodeTask,
  prepareAdherenceEvaluation,
  prepareCodeTask,
  prepareInterpretation,
  prepareRelations,
  prepareSemanticCandidates,
} from '../internal/workflow.mjs';

export {
  completeCodeTask,
  prepareAdherenceEvaluation,
  prepareCodeTask,
  prepareInterpretation,
  prepareRelations,
  prepareSemanticCandidates,
} from '../internal/workflow.mjs';

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error('Expected a command: prepare-interpretation, prepare-relations, prepare-semantic-candidates, prepare, prepare-adherence, or complete.');
  }

  if (command === 'prepare-interpretation' || command === 'prepare-relations' || command === 'prepare-semantic-candidates' || command === 'prepare') {
    const { positionals, flags } = parseFlags(rest);
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
        candidateFile: readSingleFlag(flags, 'candidate-file'),
        hostProposalFile: readSingleFlag(flags, 'host-proposal-file'),
        semanticProposalFile: readSingleFlag(flags, 'semantic-proposal-file'),
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

  if (command === 'complete') {
    const { flags } = parseFlags(rest);
    const sessionPath = readSingleFlag(flags, 'session');
    if (!sessionPath) throw new Error('complete requires --session <path>.');
    return {
      command,
      options: {
        sessionPath,
        followedDirectiveIds: readMultiFlag(flags, 'followed'),
        ignoredDirectiveIds: readMultiFlag(flags, 'ignored'),
        ignoredDirectiveReasons: readIgnoredReasonMap(readMultiFlag(flags, 'ignored-reason')),
        signalConfidence: readSingleFlag(flags, 'signal-confidence'),
        adherenceFile: readSingleFlag(flags, 'adherence-file'),
      },
    };
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
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
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

function readIgnoredReasonMap(values) {
  const result = {};
  for (const value of values) {
    const separator = value.indexOf(':');
    if (separator <= 0) {
      throw new Error(`Invalid --ignored-reason value "${value}"; expected <directive-id>:<reason>.`);
    }
    const directiveId = value.slice(0, separator);
    const reason = value.slice(separator + 1);
    if (!isIgnoredReason(reason)) {
      throw new Error(`Invalid ignored reason "${reason}" for ${directiveId}.`);
    }
    result[directiveId] = reason;
  }
  return result;
}

function isIgnoredReason(value) {
  return value === 'not-applicable'
    || value === 'conflicts-with-task'
    || value === 'too-broad'
    || value === 'repo-reality'
    || value === 'false-positive'
    || value === 'user-corrected'
    || value === 'other';
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  const result = parsed.command === 'prepare-interpretation'
    ? await prepareInterpretation(parsed.options)
    : parsed.command === 'prepare-relations'
      ? await prepareRelations(parsed.options)
      : parsed.command === 'prepare-semantic-candidates'
        ? await prepareSemanticCandidates(parsed.options)
        : parsed.command === 'prepare'
          ? await prepareCodeTask(parsed.options)
          : parsed.command === 'prepare-adherence'
            ? await prepareAdherenceEvaluation(parsed.options)
            : await completeCodeTask(parsed.options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
