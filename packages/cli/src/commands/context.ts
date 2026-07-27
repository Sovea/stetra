import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  approveContext,
  commitCalibration,
  prepareCalibration,
  validateContext,
} from '@sovea/resonant-code-core/rccl';
import type { CalibrationContract } from '@sovea/resonant-code-core/rccl';
import { Command } from 'commander';
import { z } from 'zod';

import { inputError, usageError } from '../errors.ts';
import { parseArtifact } from '../validation.ts';
import type { CommandEnvironment } from './shared.ts';
import { collectOption } from './shared.ts';

const ContractEnvelopeSchema = z.union([
  z.object({ contract: z.unknown() }).passthrough().transform((value) => value.contract),
  z.unknown(),
]);

interface ContextPrepareOptions {
  evidence: string[];
}

interface ContextCommitOptions {
  contract: string;
  input: string;
  rcclPath?: string;
}

interface ContextApproveOptions {
  approvedBy: string;
  fingerprint: string[];
  id: string[];
  rcclPath?: string;
}

interface ContextPathOptions {
  rcclPath?: string;
}

export function registerContextCommands(
  program: Command,
  environment: CommandEnvironment,
): void {
  const context = program
    .command('context')
    .description('Prepare, commit, review, and refresh RCCL observations');

  context
    .command('prepare')
    .description('Create an exact evidence-window calibration contract')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--evidence <file:start-end>', 'exact repository evidence window', collectOption, [])
    .action((
      projectRoot: string,
      options: ContextPrepareOptions,
      command: Command,
    ) => {
      environment.emit('context prepare', prepareCalibration({
        projectRoot: resolve(projectRoot),
        evidenceSelections: options.evidence.map(parseEvidenceSelection),
      }), command);
    });

  context
    .command('commit')
    .description('Validate a host proposal against its prepare contract')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--contract <prepare.json>', 'prepare output or contract JSON')
    .requiredOption('--input <proposal.yaml|proposal.json|->', 'host proposal')
    .option('--rccl-path <path>', 'RCCL document path')
    .action((
      projectRoot: string,
      options: ContextCommitOptions,
      command: Command,
    ) => {
      if (options.input === '-' && options.contract === '-') {
        throw usageError('--input and --contract cannot both read stdin.');
      }
      environment.emit('context commit', commitCalibration({
        projectRoot: resolve(projectRoot),
        contract: readContract(options.contract),
        proposal: readInput(options.input),
        rcclPath: options.rcclPath,
      }), command);
    });

  context
    .command('approve')
    .description('Record independent human approval provenance')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--id <observation-id>', 'observation to approve (repeatable)', collectOption, [])
    .requiredOption(
      '--fingerprint <observation-id=content-fingerprint>',
      'reviewed observation fingerprint (repeatable)',
      collectOption,
      [],
    )
    .requiredOption('--approved-by <reviewer>', 'reviewer identity')
    .option('--rccl-path <path>', 'RCCL document path')
    .action((
      projectRoot: string,
      options: ContextApproveOptions,
      command: Command,
    ) => {
      const resolvedProjectRoot = resolve(projectRoot);
      assertApprovalFingerprints({
        projectRoot: resolvedProjectRoot,
        observationIds: options.id,
        fingerprintOptions: options.fingerprint,
        rcclPath: options.rcclPath,
      });
      environment.emit('context approve', approveContext({
        projectRoot: resolvedProjectRoot,
        observationIds: options.id,
        approvedBy: options.approvedBy,
        rcclPath: options.rcclPath,
      }), command);
    });

  registerValidationCommand(context, environment, 'validate', false);
  registerValidationCommand(context, environment, 'refresh-stale', true);
}

function assertApprovalFingerprints(input: {
  projectRoot: string;
  observationIds: string[];
  fingerprintOptions: string[];
  rcclPath?: string;
}): void {
  const expectedById = new Map<string, string>();
  for (const value of input.fingerprintOptions) {
    const separator = value.indexOf('=');
    const id = separator > 0 ? value.slice(0, separator).trim() : '';
    const fingerprint = separator > 0 ? value.slice(separator + 1).trim() : '';
    if (!id || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw usageError(
        `Invalid --fingerprint ${value}; expected <observation-id>=<64-character-content-fingerprint>.`,
      );
    }
    if (expectedById.has(id)) {
      throw usageError(`Duplicate --fingerprint for observation ${id}.`);
    }
    expectedById.set(id, fingerprint);
  }

  const requestedIds = [...new Set(input.observationIds)].sort();
  const expectedIds = [...expectedById.keys()].sort();
  if (
    requestedIds.length !== expectedIds.length
    || requestedIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw usageError(
      'Every --id must have exactly one matching --fingerprint and no extra fingerprints may be supplied.',
    );
  }

  const current = validateContext({
    projectRoot: input.projectRoot,
    rcclPath: input.rcclPath,
    write: false,
  });
  if (current.status !== 'valid' || !current.document) {
    throw inputError(
      `Cannot approve RCCL observations while context status is ${current.status}.`,
    );
  }
  const observationById = new Map(
    current.document.observations.map((observation) => [
      observation.id,
      observation,
    ]),
  );
  for (const id of requestedIds) {
    const observation = observationById.get(id);
    if (!observation) {
      throw inputError(`Observation ${id} does not exist in the current RCCL document.`);
    }
    const expected = expectedById.get(id);
    if (observation.lifecycle.contentFingerprint !== expected) {
      throw inputError(
        `Observation ${id} changed after review; expected fingerprint ${expected}, current fingerprint is ${observation.lifecycle.contentFingerprint}.`,
      );
    }
  }
}

function registerValidationCommand(
  parent: Command,
  environment: CommandEnvironment,
  name: 'refresh-stale' | 'validate',
  write: boolean,
): void {
  parent
    .command(name)
    .description(write
      ? 'Reverify evidence and persist current lifecycle state'
      : 'Validate RCCL structure and current evidence')
    .argument('[project-root]', 'project root', '.')
    .option('--rccl-path <path>', 'RCCL document path')
    .action((
      projectRoot: string,
      options: ContextPathOptions,
      command: Command,
    ) => {
      environment.emit(`context ${name}`, validateContext({
        projectRoot: resolve(projectRoot),
        rcclPath: options.rcclPath,
        write,
      }), command);
    });
}

function parseEvidenceSelection(value: string) {
  const match = /^(.*):([1-9]\d*)-([1-9]\d*)$/.exec(value);
  if (!match?.[1]) {
    throw usageError(
      `Invalid --evidence ${value}; expected <repository-file>:<start>-<end>.`,
    );
  }
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (end < start) {
    throw usageError(
      `Invalid --evidence ${value}; end must be greater than or equal to start.`,
    );
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
  } catch (error) {
    throw inputError(
      '--contract must name the JSON output written by context prepare.',
      error,
    );
  }
  return parseArtifact(
    ContractEnvelopeSchema,
    parsed,
    'context prepare contract',
  ) as CalibrationContract;
}
