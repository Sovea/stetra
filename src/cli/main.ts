#!/usr/bin/env node
import { Argument, Command, CommanderError, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { operationNames, requestSchema, type OperationName } from '../runtime/operations.js';
import { Workspace, errorDetails, projectPath } from '../runtime/workspace.js';
import { contextInstructions } from '../runtime/context.js';
import { safeSessionStart } from '../adapters/shared/session-start.js';
import { initializeProject, installedAdapters } from '../setup/init.js';
import { assertInstallerResources } from '../setup/resources.js';
import { printInstallation } from './installation-output.js';
import { StetraError } from '../runtime/shared.js';
import { sessionKeySchema, type SessionKey } from '../runtime/context/types.js';

const cliPath = fileURLToPath(import.meta.url);

async function inputText(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_048_576) throw new StetraError('invalid', 'JSON input exceeds 1 MiB.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function rootFor(command: Command): string { return projectPath(resolve(command.optsWithGlobals().project ?? process.cwd())); }

async function main(): Promise<void> {
  const program = new Command()
    .name('stetra')
    .description('Keep developer understanding and decisions connected to the coding work.')
    .option('--project <directory>', 'Project directory (defaults to the current directory)')
    .exitOverride()
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({ outputError: () => undefined });

  program.command('init')
    .description('Choose integrations interactively and set up this project')
    .option('--dry-run', 'Preview installation changes without writing files')
    .option('--force', 'Replace modified artifacts already managed by Stetra')
    .option('-y, --yes', 'Refresh saved integration choices without opening the selector')
    .option('--json', 'Print the setup result as JSON; selection remains interactive')
    .action(async (options: { dryRun?: boolean; force?: boolean; yes?: boolean; json?: boolean }, command: Command) => {
      await assertInstallerResources();
      const root = rootFor(command);
      const installed = installedAdapters(root);
      let selected = installed;
      if (options.yes) {
        if (!installed.length) throw new StetraError('invalid', 'This project has no saved integration selection. Run stetra init in an interactive terminal first.');
      } else {
        if (!process.stdin.isTTY || !process.stderr.isTTY || process.env.CI) {
          throw new StetraError('invalid', 'Run stetra init in an interactive terminal to choose integrations. For an initialized project, use --yes to refresh the saved choices.');
        }
        const { selectHosts } = await import('./init-ui.js');
        const choices = await selectHosts({ projectRoot: root, installed });
        if (choices === null) {
          process.stderr.write('Stetra initialization cancelled. No files were changed.\n');
          process.exitCode = 130;
          return;
        }
        selected = choices;
      }
      const result = await initializeProject(root, { adapters: selected, dryRun: options.dryRun, force: options.force });
      printInstallation(result, Boolean(options.json));
      if (result.status === 'blocked') process.exitCode = 2;
    });

  program.command('hook')
    .description('Read a Host session event from stdin and return context')
    .addOption(new Option('--host <host>', 'Host that emitted this event').choices(['codex', 'claude']).default('codex'))
    .action(async (options: { host: 'codex' | 'claude' }, command: Command) => {
      try {
        const project = command.optsWithGlobals().project;
        print(await safeSessionStart(JSON.parse(await inputText()), cliPath, project ? resolve(project) : undefined, options.host));
      } catch (error) { process.stderr.write(`Stetra hook: ${errorDetails(error).message}\n`); print({}); }
    });

  const collect = (value: string, previous: string[] = []) => [...previous, value];
  program.command('context')
    .description('Find and load current knowledge for this conversation')
    .option('--query <text>', 'Search for relevant knowledge')
    .option('--path <path>', 'Project file or directory scope; repeat for multiple paths', collect)
    .option('--memory <uuid>', 'Select known knowledge IDs; repeat for multiple items', collect)
    .option('--instructions', 'Return bounded Host guidance and knowledge as JSON')
    .addOption(new Option('--host <host>', 'Host namespace for a native session').choices(['codex', 'claude', 'pi', 'agents']))
    .option('--session <id>', 'Native Host session identity (requires --host)')
    .option('--reset', 'Clear this session selection; combine with selectors to replace it')
    .action(async (options: { query?: string; path?: string[]; memory?: string[]; instructions?: boolean; host?: SessionKey['host']; session?: string; reset?: boolean }, command: Command) => {
      const root = rootFor(command);
      const session = options.host !== undefined || options.session !== undefined ? sessionKeySchema.parse({ host: options.host, sessionId: options.session }) : undefined;
      const selection = { query: options.query, paths: options.path, ids: options.memory, reset: options.reset };
      if (options.instructions) { print(await contextInstructions(root, cliPath, session, selection)); return; }
      print(await new Workspace(root).context({ ...selection, session }));
    });

  program.command('schema')
    .description('Print the JSON Schema for a request domain')
    .addArgument(new Argument('<domain>', 'Operation domain').choices([...operationNames]))
    .option('--action <action>', 'Describe one action instead of the entire domain')
    .action((name: OperationName, options: { action?: string }) => { print(z.toJSONSchema(requestSchema(name, options.action), { io: 'input' })); });

  program.command('call')
    .description('Read or maintain shared knowledge with a JSON request')
    .addArgument(new Argument('<domain>', 'Operation domain').choices([...operationNames]))
    .requiredOption('--input <file>', 'JSON request file, or - to read stdin')
    .action(async (name: OperationName, options: { input: string }, command: Command) => {
      const root = rootFor(command);
      const text = options.input === '-' ? await inputText() : await readFile(options.input, 'utf8');
      if (Buffer.byteLength(text) > 1_048_576) throw new StetraError('invalid', 'JSON input exceeds 1 MiB.');
      const workspace = new Workspace(root);
      print(await workspace.execute(name, JSON.parse(text)));
    });

  // Explicit user arguments also work when a project Hook loads this CLI from node -e.
  if (process.argv.length === 2) { program.outputHelp(); return; }
  await program.parseAsync(process.argv.slice(2), { from: 'user' });
}

main().catch(error => {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) return;
    process.stderr.write(`${JSON.stringify({ error: { code: 'invalid', message: error.message } })}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  process.stderr.write(`${JSON.stringify({ error: errorDetails(error) })}\n`);
  process.exitCode = 1;
});
