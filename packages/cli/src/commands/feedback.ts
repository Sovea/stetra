import { Command } from 'commander';

import {
  createApprovedFeedbackProposal,
  inspectCodeFeedback,
} from '../workflow/change.mjs';
import type { CommandEnvironment } from './shared.ts';
import { collectOption } from './shared.ts';

interface FeedbackInspectOptions {
  guidanceId: string[];
}

interface FeedbackProposeOptions {
  input: string;
}

export function registerFeedbackCommands(
  program: Command,
  environment: CommandEnvironment,
): void {
  const feedback = program
    .command('feedback')
    .description('Inspect evidence-backed aggregates and approve bounded proposals');

  feedback
    .command('inspect')
    .description('Inspect Runtime-owned fact aggregates')
    .argument('[project-root]', 'project root', '.')
    .option('--guidance-id <id>', 'filter by delivered guidance ID', collectOption, [])
    .action((
      projectRoot: string,
      options: FeedbackInspectOptions,
      command: Command,
    ) => {
      environment.emit('feedback inspect', inspectCodeFeedback({
        projectRoot,
        guidanceIds: options.guidanceId,
      }), command);
    });

  feedback
    .command('propose')
    .description('Persist a separately approved policy change proposal')
    .argument('[project-root]', 'project root', '.')
    .requiredOption('--input <approved-proposal.json>', 'approved proposal input')
    .action((
      projectRoot: string,
      options: FeedbackProposeOptions,
      command: Command,
    ) => {
      environment.emit('feedback propose', createApprovedFeedbackProposal({
        projectRoot,
        inputFile: options.input,
      }), command);
    });
}
