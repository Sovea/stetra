import { Command } from 'commander';
import { z } from 'zod';

import {
  initializeProject,
  inspectProjectInstallation,
  type HostAdapter,
} from '../project/init.ts';
import { parseArtifact } from '../validation.ts';
import type { CommandEnvironment } from './shared.ts';
import { collectOption } from './shared.ts';

const AdapterListSchema = z.array(z.enum(['codex', 'claude']));

interface InitOptions {
  adapter: string[];
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
}

export function registerInitCommand(
  program: Command,
  environment: CommandEnvironment,
): void {
  program
    .command('init')
    .description('Install project-local host adapters managed by the CLI')
    .argument('[project-root]', 'project root', '.')
    .option(
      '-a, --adapter <host>',
      'host adapter to install (repeatable: codex or claude)',
      collectOption,
      [],
    )
    .option('--dry-run', 'plan managed artifact changes without writing')
    .option('--force', 'replace modified managed artifacts explicitly')
    .option('-y, --yes', 'accept documented non-interactive defaults')
    .action(async (
      projectRoot: string,
      options: InitOptions,
      command: Command,
    ) => {
      let adapters = parseArtifact(AdapterListSchema, options.adapter, 'init adapters');
      if (
        !adapters.length
        && !options.yes
        && environment.shouldPrompt(command)
        && inspectProjectInstallation(projectRoot).status === 'absent'
      ) {
        adapters = await environment.runtime.prompts.selectAdapters({
          choices: ['codex', 'claude'],
          defaults: ['codex', 'claude'],
          streams: {
            input: environment.runtime.input,
            output: environment.runtime.output,
          },
        });
      }
      const output = initializeProject({
        projectRoot,
        adapters: adapters as HostAdapter[],
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun),
      });
      environment.emit('init', output, command);
    });
}
