/** Stable command surface for the public binary. */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import {
  approveContext,
  commitCalibration,
  prepareCalibration,
  validateContext,
} from '@sovea/resonant-code-core/rccl';
import type { CalibrationContract } from '@sovea/resonant-code-core/rccl';

import {
  initializeProject,
  inspectProjectInstallation,
  type HostAdapter,
} from './project/init.ts';
import { PRODUCT_VERSION } from './version.ts';
import {
  completeCodeTask,
  createApprovedFeedbackProposal,
  explainCodeSession,
  getCodeStatus,
  inspectCodeFeedback,
  prepareCodeTask,
} from './workflow/change.mjs';
import { commitInit, prepareInit } from './workflow/bootstrap.mjs';

type JsonObject = Record<string, unknown>;

export interface CliExecution {
  output: unknown;
  json: boolean;
  exitCode: number;
}

interface ParsedFlags {
  positionals: string[];
  flags: Map<string, string[]>;
}

const require = createRequire(import.meta.url);
const BOOLEAN_FLAGS = new Set([
  'debug-artifacts',
  'dry-run',
  'force',
  'help',
  'json',
  'strict',
  'version',
]);

export async function runCli(argv: string[]): Promise<CliExecution> {
  const json = argv.includes('--json');
  const args = argv.filter((token) => token !== '--json');
  if (!args.length || args.includes('--help') || args[0] === 'help') {
    return { output: helpText(), json: false, exitCode: 0 };
  }
  if (args.includes('--version') || args[0] === 'version') {
    return { output: PRODUCT_VERSION, json: false, exitCode: 0 };
  }

  const [command, ...rest] = args;
  let output: unknown;
  if (command === 'init') output = runInit(rest);
  else if (command === 'bootstrap') output = runBootstrap(rest);
  else if (command === 'change') output = await runChange(rest);
  else if (command === 'context') output = runContext(rest);
  else if (command === 'feedback') output = runFeedback(rest);
  else if (command === 'status' || command === 'doctor') {
    output = await runStatus(command, rest);
  } else {
    throw new Error(`Unknown command: ${command}. Run \`resonant-code --help\`.`);
  }

  return {
    output,
    json,
    exitCode: resultExitCode(command, output),
  };
}

export function formatCliOutput(execution: CliExecution): string {
  if (execution.json) return `${JSON.stringify(execution.output, null, 2)}\n`;
  if (typeof execution.output === 'string') return `${execution.output}\n`;
  return `${formatHuman(execution.output)}\n`;
}

function runInit(argv: string[]) {
  const parsed = parseFlags(argv);
  assertAllowed(parsed.flags, ['adapter', 'force', 'dry-run']);
  assertPositionals(parsed.positionals, 1, 'init accepts at most one [project-root].');
  return initializeProject({
    projectRoot: parsed.positionals[0] ?? '.',
    adapters: multiple(parsed.flags, 'adapter') as HostAdapter[],
    force: present(parsed.flags, 'force'),
    dryRun: present(parsed.flags, 'dry-run'),
  });
}

function runBootstrap(argv: string[]) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) throw new Error('bootstrap requires prepare or commit.');
  const parsed = parseFlags(rest);
  assertPositionals(parsed.positionals, 1, `${subcommand} accepts at most one [project-root].`);
  const projectRoot = parsed.positionals[0] ?? '.';
  const builtinRoot = resolveBuiltinRoot();

  if (subcommand === 'prepare') {
    assertAllowed(parsed.flags, ['debug-artifacts']);
    return prepareInit({
      projectRoot,
      builtinRoot,
      debugArtifacts: present(parsed.flags, 'debug-artifacts'),
    });
  }
  if (subcommand === 'commit') {
    assertAllowed(parsed.flags, ['input', 'force', 'debug-artifacts']);
    const input = single(parsed.flags, 'input');
    if (!input) throw new Error('bootstrap commit requires --input <candidate.json|->.');
    return commitInit({
      projectRoot,
      builtinRoot,
      input,
      force: present(parsed.flags, 'force'),
      debugArtifacts: present(parsed.flags, 'debug-artifacts'),
    });
  }
  throw new Error(`Unknown bootstrap command: ${subcommand}.`);
}

async function runChange(argv: string[]) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) {
    throw new Error(
      'change requires prepare, complete, or explain.',
    );
  }

  if (subcommand === 'prepare') {
    const parsed = parseFlags(rest);
    assertAllowed(parsed.flags, [
      'task',
      'mode',
      'change-type',
      'target',
      'tech',
      'risk',
      'scope',
      'constraint',
      'uncertainty',
      'avoid',
      'relation-file',
      'selection-file',
      'guidance-byte-limit',
      'personal-overlay',
      'check-config',
    ]);
    assertPositionals(parsed.positionals, 1, `${subcommand} accepts at most one [project-root].`);
    const taskDescription = single(parsed.flags, 'task');
    if (!taskDescription) throw new Error(`change ${subcommand} requires --task "<description>".`);
    const options = {
      projectRoot: parsed.positionals[0] ?? '.',
      taskDescription,
      guidanceMode: single(parsed.flags, 'mode'),
      changeType: single(parsed.flags, 'change-type'),
      targets: multiple(parsed.flags, 'target'),
      techStack: multiple(parsed.flags, 'tech'),
      risk: single(parsed.flags, 'risk'),
      scope: single(parsed.flags, 'scope'),
      constraints: multiple(parsed.flags, 'constraint'),
      uncertainties: multiple(parsed.flags, 'uncertainty'),
      avoid: multiple(parsed.flags, 'avoid'),
      relationFile: single(parsed.flags, 'relation-file'),
      selectionFile: single(parsed.flags, 'selection-file'),
      guidanceByteLimit: single(parsed.flags, 'guidance-byte-limit'),
      personalOverlayPath: single(parsed.flags, 'personal-overlay'),
      checkConfigPath: single(parsed.flags, 'check-config'),
      builtinRoot: resolveBuiltinRoot(),
      productVersion: PRODUCT_VERSION,
    };
    return prepareCodeTask(options);
  }

  if (subcommand === 'complete') {
    const parsed = parseFlags(rest);
    assertAllowed(parsed.flags, ['session', 'evaluation-file']);
    assertPositionals(parsed.positionals, 0, 'change complete does not accept positional arguments.');
    const sessionPath = single(parsed.flags, 'session');
    if (!sessionPath) throw new Error('change complete requires --session <path>.');
    return completeCodeTask({
      sessionPath,
      evaluationFile: single(parsed.flags, 'evaluation-file'),
      productVersion: PRODUCT_VERSION,
    });
  }

  if (subcommand === 'explain') {
    const parsed = parseFlags(rest);
    assertAllowed(parsed.flags, ['session']);
    assertPositionals(parsed.positionals, 0, 'change explain does not accept positional arguments.');
    const sessionPath = single(parsed.flags, 'session');
    if (!sessionPath) throw new Error('change explain requires --session <path>.');
    return explainCodeSession({ sessionPath });
  }

  throw new Error(`Unknown change command: ${subcommand}.`);
}

function runContext(argv: string[]) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) {
    throw new Error('context requires prepare, commit, approve, validate, or refresh-stale.');
  }
  const parsed = parseFlags(rest);
  assertPositionals(parsed.positionals, 1, `${subcommand} accepts at most one [project-root].`);
  const projectRoot = resolve(parsed.positionals[0] ?? '.');

  if (subcommand === 'prepare') {
    assertAllowed(parsed.flags, ['evidence']);
    return prepareCalibration({
      projectRoot,
      evidenceSelections: multiple(parsed.flags, 'evidence').map(parseEvidenceSelection),
    });
  }
  if (subcommand === 'commit') {
    assertAllowed(parsed.flags, ['input', 'contract', 'rccl-path']);
    const input = single(parsed.flags, 'input');
    const contract = single(parsed.flags, 'contract');
    if (!input) throw new Error('context commit requires --input <proposal.yaml|proposal.json|->.');
    if (!contract) throw new Error('context commit requires --contract <prepare-output.json>.');
    if (input === '-' && contract === '-') {
      throw new Error('--input and --contract cannot both read stdin.');
    }
    return commitCalibration({
      projectRoot,
      contract: readContract(contract),
      proposal: readInput(input),
      rcclPath: single(parsed.flags, 'rccl-path'),
    });
  }
  if (subcommand === 'approve') {
    assertAllowed(parsed.flags, ['id', 'approved-by', 'rccl-path']);
    const approvedBy = single(parsed.flags, 'approved-by');
    const observationIds = multiple(parsed.flags, 'id');
    if (!approvedBy || !observationIds.length) {
      throw new Error('context approve requires --approved-by <reviewer> and at least one --id <observation-id>.');
    }
    return approveContext({
      projectRoot,
      observationIds,
      approvedBy,
      rcclPath: single(parsed.flags, 'rccl-path'),
    });
  }
  if (subcommand === 'validate' || subcommand === 'refresh-stale') {
    assertAllowed(parsed.flags, ['rccl-path']);
    return validateContext({
      projectRoot,
      rcclPath: single(parsed.flags, 'rccl-path'),
      write: subcommand === 'refresh-stale',
    });
  }
  throw new Error(`Unknown context command: ${subcommand}.`);
}

function runFeedback(argv: string[]) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) throw new Error('feedback requires inspect or propose.');
  const parsed = parseFlags(rest);
  assertPositionals(parsed.positionals, 1, `${subcommand} accepts at most one [project-root].`);
  const projectRoot = parsed.positionals[0] ?? '.';
  if (subcommand === 'inspect') {
    assertAllowed(parsed.flags, ['guidance-id']);
    return inspectCodeFeedback({
      projectRoot,
      guidanceIds: multiple(parsed.flags, 'guidance-id'),
    });
  }
  if (subcommand === 'propose') {
    assertAllowed(parsed.flags, ['input']);
    const inputFile = single(parsed.flags, 'input');
    if (!inputFile) throw new Error('feedback propose requires --input <approved-proposal.json>.');
    return createApprovedFeedbackProposal({ projectRoot, inputFile });
  }
  throw new Error(`Unknown feedback command: ${subcommand}.`);
}

async function runStatus(command: 'status' | 'doctor', argv: string[]) {
  const parsed = parseFlags(argv);
  assertAllowed(parsed.flags, [
    'personal-overlay',
    'check-config',
    ...(command === 'doctor' ? ['strict'] : []),
  ]);
  assertPositionals(parsed.positionals, 1, `${command} accepts at most one [project-root].`);
  const projectRoot = resolve(parsed.positionals[0] ?? '.');
  const harness = await getCodeStatus({
    projectRoot,
    personalOverlayPath: single(parsed.flags, 'personal-overlay'),
    checkConfigPath: single(parsed.flags, 'check-config'),
    builtinRoot: resolveBuiltinRoot(),
    productVersion: PRODUCT_VERSION,
  });
  const installation = inspectProjectInstallation(projectRoot);
  const nextActions = [...harness.readiness.nextActions];
  if (installation.status === 'absent') {
    nextActions.unshift({
      code: 'cli-adapters-absent',
      message: 'Run `resonant-code init .` to install project-local host adapters.',
    });
  } else if (installation.status !== 'current') {
    nextActions.unshift({
      code: 'cli-installation-drifted',
      message: 'Run `resonant-code init .` to refresh adapter/version drift; use --force only for managed artifacts you intend to replace.',
    });
  }
  const readinessStatus = harness.status === 'blocked'
    ? 'blocked'
    : nextActions.length
      ? 'needs-attention'
      : 'ready';
  const strict = command === 'doctor' && present(parsed.flags, 'strict');
  const passed = harness.status !== 'blocked' && (!strict || readinessStatus === 'ready');

  return {
    status: passed ? 'ok' : 'blocked',
    schemaVersion: harness.schemaVersion,
    command,
    strict,
    version: PRODUCT_VERSION,
    readiness: {
      status: readinessStatus,
      nextActions,
    },
    installation,
    sources: harness.sources,
    controlPlane: harness.controlPlane,
    paths: harness.paths,
  };
}

function resolveBuiltinRoot(): string {
  const corePackageRoot = dirname(
    require.resolve('@sovea/resonant-code-core/package.json'),
  );
  const builtinRoot = join(corePackageRoot, 'assets', 'playbook');
  if (!existsSync(builtinRoot)) {
    throw new Error(
      `Built-in Playbook assets are missing from ${builtinRoot}. Reinstall @sovea/resonant-code-core.`,
    );
  }
  return builtinRoot;
}

function parseFlags(argv: string[]): ParsedFlags {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!key) throw new Error('Invalid empty flag.');
    if (BOOLEAN_FLAGS.has(key)) {
      flags.set(key, ['true']);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Flag --${key} requires a value.`);
    }
    const values = flags.get(key) ?? [];
    values.push(value);
    flags.set(key, values);
    index += 1;
  }
  return { positionals, flags };
}

function assertAllowed(flags: Map<string, string[]>, allowed: string[]): void {
  for (const key of flags.keys()) {
    if (!allowed.includes(key)) throw new Error(`Unknown flag --${key}.`);
  }
}

function assertPositionals(positionals: string[], maximum: number, message: string): void {
  if (positionals.length > maximum) throw new Error(message);
}

function single(flags: Map<string, string[]>, key: string): string | undefined {
  const values = flags.get(key) ?? [];
  if (values.length > 1) throw new Error(`Flag --${key} may only be provided once.`);
  return values[0];
}

function multiple(flags: Map<string, string[]>, key: string): string[] {
  return flags.get(key) ?? [];
}

function present(flags: Map<string, string[]>, key: string): boolean {
  return flags.has(key);
}

function parseEvidenceSelection(value: string) {
  const match = /^(.*):([1-9]\d*)-([1-9]\d*)$/.exec(value);
  if (!match?.[1]) {
    throw new Error(`Invalid --evidence ${value}; expected <repository-file>:<start>-<end>.`);
  }
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (end < start) {
    throw new Error(`Invalid --evidence ${value}; end must be greater than or equal to start.`);
  }
  return { file: match[1], lineRange: [start, end] as [number, number] };
}

function readInput(path: string): string {
  return path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8');
}

function readContract(path: string): CalibrationContract {
  const text = readInput(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('--contract must name the JSON output written by context prepare.');
  }
  return (isRecord(parsed) && parsed.contract ? parsed.contract : parsed) as CalibrationContract;
}

function resultExitCode(command: string, output: unknown): number {
  if (!isRecord(output)) return 0;
  if (command === 'init' && output.status === 'blocked') return 2;
  if (command === 'bootstrap' && output.status === 'exists') return 2;
  if (command === 'doctor' && output.status === 'blocked') return 2;
  return 0;
}

function formatHuman(output: unknown): string {
  if (!isRecord(output)) return String(output);
  const lines = [`status: ${String(output.status ?? 'ok')}`];
  if (typeof output.version === 'string') lines.push(`version: ${output.version}`);
  if (typeof output.decisionId === 'string') lines.push(`decision: ${output.decisionId}`);
  if (typeof output.evaluationId === 'string') lines.push(`evaluation: ${output.evaluationId}`);
  if (typeof output.sessionPath === 'string') lines.push(`session: ${output.sessionPath}`);
  if (Array.isArray(output.adapters)) {
    lines.push(`adapters: ${output.adapters.join(', ') || 'none'}`);
  }
  if (isRecord(output.counts)) {
    const summary = Object.entries(output.counts)
      .filter(([, count]) => Number(count) > 0)
      .map(([action, count]) => `${action}=${String(count)}`)
      .join(', ');
    if (summary) lines.push(`artifacts: ${summary}`);
  }
  if (Array.isArray(output.artifacts)) {
    for (const artifact of output.artifacts) {
      if (!isRecord(artifact) || artifact.action !== 'blocked') continue;
      lines.push(`- blocked ${String(artifact.path)}: ${String(artifact.reason ?? 'managed content changed')}`);
    }
  }
  if (isRecord(output.readiness)) {
    lines.push(`readiness: ${String(output.readiness.status ?? 'unknown')}`);
    if (Array.isArray(output.readiness.nextActions)) {
      for (const action of output.readiness.nextActions) {
        if (isRecord(action)) lines.push(`- ${String(action.message ?? action.code)}`);
      }
    }
  }
  if (isRecord(output.guidance)) {
    for (const section of ['required', 'tensions', 'avoid', 'consider']) {
      const items = output.guidance[section];
      if (!Array.isArray(items) || !items.length) continue;
      lines.push(`${section}:`);
      for (const item of items) {
        if (!isRecord(item)) continue;
        const text = item.instruction ?? item.resolution ?? item.description ?? item.id;
        lines.push(`- [${String(item.id ?? section)}] ${String(text)}`);
      }
    }
  }
  if (Array.isArray(output.reasons)) {
    for (const reason of output.reasons) lines.push(`- ${String(reason)}`);
  }
  if (Array.isArray(output.selectableConsider)) {
    lines.push(`selectable optional guidance: ${output.selectableConsider.length}`);
    lines.push('Use --json to inspect selectable IDs and candidate details.');
  }
  if (typeof output.message === 'string') lines.push(output.message);
  if (typeof output.nextStep === 'string') lines.push(`next: ${output.nextStep}`);
  if ('contract' in output || 'document' in output || 'evaluation' in output) {
    lines.push('Use --json for the complete machine-readable artifact.');
  }
  return lines.join('\n');
}

function helpText(): string {
  return `resonant-code ${PRODUCT_VERSION}

CLI-first control plane for the resonant-code change harness.

Usage:
  resonant-code init [project-root] [--adapter codex] [--adapter claude] [--dry-run] [--force]
  resonant-code status [project-root] [--json]
  resonant-code doctor [project-root] [--strict] [--json]

  resonant-code bootstrap prepare [project-root] [--json]
  resonant-code bootstrap commit [project-root] --input <candidate.json|-> [--force] [--json]

  resonant-code change prepare [project-root] --task <description> [task flags] [--json]
  resonant-code change complete --session <path> [--evaluation-file <path>] [--json]
  resonant-code change explain --session <path> [--json]

  resonant-code context prepare [project-root] --evidence <file:start-end> [--json]
  resonant-code context commit [project-root] --contract <prepare.json> --input <proposal> [--json]
  resonant-code context approve [project-root] --id <observation-id> --approved-by <reviewer> [--json]
  resonant-code context validate [project-root] [--json]
  resonant-code context refresh-stale [project-root] [--json]

  resonant-code feedback inspect [project-root] [--guidance-id <id>] [--json]
  resonant-code feedback propose [project-root] --input <approved-proposal.json> [--json]

The CLI does not call an LLM. Host agents own semantic judgment; Runtime and
RCCL validate the bounded inputs that can affect deterministic decisions.

On a new project, init installs both adapters when --adapter is omitted. On an
initialized project, omitting --adapter retains the manifest's adapter set.`;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
