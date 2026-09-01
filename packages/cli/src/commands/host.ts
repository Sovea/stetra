import { Command } from 'commander';
import type { Readable } from 'node:stream';
import { z } from 'zod';

import { handleHostHook, type HostHookEvent } from '../host/hook-gateway.ts';
import { beginHostSession } from '../host/session-bridge.ts';
import { inputError } from '../errors.ts';
import { parseArtifact } from '../validation.ts';
import type { HostAdapter } from '../adapters/definition.ts';
import type { CommandEnvironment } from './shared.ts';

const HostAdapterSchema = z.enum(['codex', 'claude']);
const HostHookEventSchema = z.enum(['session-start', 'stop']);
const HOST_HOOK_INPUT_MAX_BYTES = 1024 * 1024;

interface BeginOptions {
  adapter: string;
  bindingToken: string;
}

interface HookOptions {
  adapter: string;
  event: string;
}

export function registerHostCommands(
  program: Command,
  environment: CommandEnvironment,
): void {
  const host = program
    .command('host')
    .description('Bridge exact Host lifecycle events to one Stetra task');

  host
    .command('begin')
    .description('Consume one Host-session binding token and reserve Prepare input')
    .argument('[project-root]', 'Stetra project root', '.')
    .requiredOption('--adapter <host>', 'Host adapter: codex or claude')
    .requiredOption('--binding-token <token>', 'one-time token projected by SessionStart')
    .action((projectRoot: string, options: BeginOptions, command: Command) => {
      const adapter = parseArtifact(HostAdapterSchema, options.adapter, 'Host adapter');
      const prepared = beginHostSession({
        projectRoot,
        adapter,
        bindingToken: options.bindingToken,
      });
      environment.emit('host begin', {
        status: 'host-session-bound',
        adapter,
        prepareRequestId: prepared.prepareRequestId,
        taskId: prepared.taskId,
        reservation: prepared.reservation,
        submit: prepared.submit,
        resume: prepared.resume,
      }, command);
    });

  host
    .command('hook')
    .description('Consume one Host-native lifecycle Hook event from stdin')
    .requiredOption('--adapter <host>', 'Host adapter: codex or claude')
    .requiredOption('--event <event>', 'session-start or stop')
    .action(async (options: HookOptions, command: Command) => {
      const adapter: HostAdapter = parseArtifact(HostAdapterSchema, options.adapter, 'Host adapter');
      const event: HostHookEvent = parseArtifact(HostHookEventSchema, options.event, 'Host Hook event');
      const payload = await readHookPayload(environment.runtime.input);
      const result = await handleHostHook({ adapter, event, payload });
      environment.emit('host hook', result.wireOutput, command);
    });
}

async function readHookPayload(input: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > HOST_HOOK_INPUT_MAX_BYTES) {
      throw inputError(`Host Hook input exceeds ${HOST_HOOK_INPUT_MAX_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw inputError('Host Hook input is not valid JSON.', error);
  }
}
