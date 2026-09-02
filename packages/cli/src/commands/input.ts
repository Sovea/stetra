import { Command } from 'commander';
import { z } from 'zod';

import { delegationPrepareDraft, delegationPrepareGuide } from '../adapters/templates.ts';
import { inputError } from '../errors.ts';
import { createOwnedInputToken, reserveOwnedInput } from '../host/owned-input.ts';
import { PrepareAuthoringDocumentSchema } from '../schemas/authoring.ts';
import { reserveProjectedHostInput } from '../workflow/delegation.ts';
import type { CommandEnvironment } from './shared.ts';

interface ReserveOptions {
  token?: string;
  task?: string;
  stage?: 'diagnose' | 'revise-verification' | 'handoff' | 'decide' | 'resolve';
  kind?: 'prepare';
}

export function registerInputCommands(
  program: Command,
  environment: CommandEnvironment,
): void {
  const input = program
    .command('input')
    .description('Manage transient one-shot Host input');

  input
    .command('reserve')
    .description('Reserve a Stetra-owned JSON input file outside task state')
    .argument('[project-root]', 'project root', '.')
    .option('--token <hex>', 'exact token projected by a Host Action')
    .option('--task <id>', 'task ID projected by a Host Action')
    .option('--stage <name>', 'input stage projected by a Host Action')
    .option('--kind <name>', 'initial input kind; currently prepare')
    .action((projectRoot: string, options: ReserveOptions, command: Command) => {
      if (options.kind) {
        if (options.kind !== 'prepare' || options.task || options.stage) {
          throw inputError('--kind prepare cannot be combined with --task or --stage.');
        }
        const token = options.token ?? createOwnedInputToken();
        const prepareRequestId = `prepare:${token}`;
        const document = delegationPrepareDraft();
        const reservation = reserveOwnedInput(
          projectRoot,
          token,
          document,
          delegationPrepareGuide(),
        );
        environment.emit('input reserve', {
          status: 'input-reserved',
          inputKind: 'prepare',
          prepareRequestId,
          ...reservation,
          submit: {
            argv: [
              'stetra', 'change', 'prepare', '.',
              '--prepare-request', prepareRequestId,
              '--input', reservation.path, '--json',
            ],
          },
          resume: {
            argv: [
              'stetra', 'change', 'resume', '.',
              '--prepare-request', prepareRequestId, '--json',
            ],
          },
        }, command);
        return;
      }
      if (options.task || options.stage) {
        if (!options.task || !options.stage || !options.token) {
          throw inputError('--task, --stage, and --token must be supplied together.');
        }
        environment.emit('input reserve', reserveProjectedHostInput({
          projectRoot,
          taskId: options.task,
          stage: options.stage,
          token: options.token,
        }), command);
        return;
      }
      environment.emit('input reserve', reserveOwnedInput(projectRoot, options.token), command);
    });

  input
    .command('schema')
    .description('Inspect the exact schema for an initial semantic input')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--kind <name>', 'initial input kind; currently prepare')
    .action((_projectRoot: string, options: { kind: string }, command: Command) => {
      if (options.kind !== 'prepare') {
        throw inputError('Unsupported initial input kind; use prepare.');
      }
      environment.emit('input schema', {
        status: 'input-schema',
        inputKind: 'prepare',
        inputSchema: z.toJSONSchema(PrepareAuthoringDocumentSchema, { reused: 'ref' }),
        stateWritten: false,
      }, command);
    });
}
