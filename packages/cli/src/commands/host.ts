import type { Readable } from 'node:stream';

import { Command } from 'commander';
import { z } from 'zod';

import type { HostAdapter } from '../adapters/definition.ts';
import { inputError } from '../errors.ts';
import { handleHostHook, type HostHookEvent } from '../host/hook.ts';
import { parseArtifact } from '../validation.ts';
import type { CommandEnvironment } from './shared.ts';

const HostAdapterSchema = z.enum(['codex', 'claude']);
const HostHookEventSchema = z.enum(['session-start', 'stop']);
const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

export function registerHostCommands(program: Command, environment: CommandEnvironment): void {
  program.command('host')
    .description('Bridge a native Host lifecycle event to the embedded Stetra task layer')
    .command('hook')
    .requiredOption('--adapter <host>', 'codex or claude')
    .requiredOption('--event <event>', 'session-start or stop')
    .action(async (options: { adapter: string; event: string }, source: Command) => {
      const adapter: HostAdapter = parseArtifact(HostAdapterSchema, options.adapter, 'Host adapter');
      const event: HostHookEvent = parseArtifact(HostHookEventSchema, options.event, 'Host Hook event');
      const payload = await readHookPayload(environment.runtime.input);
      environment.emit('host hook', await handleHostHook({ adapter, event, payload }), source);
    });
}

async function readHookPayload(input: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += value.length;
    if (size > MAX_HOOK_INPUT_BYTES) throw inputError(`Host Hook input exceeds ${MAX_HOOK_INPUT_BYTES} bytes.`);
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw inputError('Host Hook input is not valid JSON.', error);
  }
}
