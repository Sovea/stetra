/** Targeted JSONC edits for Stetra-owned Hook groups in owner-controlled files. */
import {
  applyEdits,
  modify,
  parse,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser';

import type { HostAdapter } from '../adapters/definition.ts';
import { isStetraHookGroup, type HostHookFragment } from '../adapters/hooks.ts';
import { inputError } from '../errors.ts';

const EVENTS = ['SessionStart', 'Stop'] as const;

export function extractHostHookFragment(
  source: string,
  adapter: HostAdapter,
  path: string,
): HostHookFragment | null {
  const document = parseDocument(source, path);
  const hooks = record(document.hooks);
  const extracted = Object.fromEntries(EVENTS.map((event) => [
    event,
    array(hooks[event]).filter((entry) => isStetraHookGroup(entry, adapter)),
  ])) as HostHookFragment['hooks'];
  return EVENTS.every((event) => extracted[event].length === 0)
    ? null
    : { hooks: extracted };
}

export function upsertHostHookFragment(
  source: string,
  adapter: HostAdapter,
  desired: HostHookFragment,
  path: string,
): string {
  let output = source.trim() ? source : '{}\n';
  const formattingOptions = formatting(output);
  parseDocument(output, path);
  for (const event of EVENTS) {
    const document = parseDocument(output, path);
    const current = array(record(document.hooks)[event]);
    const ownedIndexes = current
      .map((entry, index) => isStetraHookGroup(entry, adapter) ? index : -1)
      .filter((index) => index >= 0);
    const desiredGroups = desired.hooks[event];
    if (desiredGroups.length !== 1) {
      throw new Error(`Generated ${adapter} ${event} fragment must contain exactly one group.`);
    }
    if (!ownedIndexes.length) {
      output = edit(output, ['hooks', event, -1], desiredGroups[0], formattingOptions, {
        isArrayInsertion: true,
      });
      continue;
    }
    output = edit(output, ['hooks', event, ownedIndexes[0]], desiredGroups[0], formattingOptions);
    for (const index of ownedIndexes.slice(1).sort((left, right) => right - left)) {
      output = edit(output, ['hooks', event, index], undefined, formattingOptions);
    }
  }
  return output.endsWith('\n') ? output : `${output}\n`;
}

function edit(
  source: string,
  path: Array<string | number>,
  value: unknown,
  formattingOptions: FormattingOptions,
  options: { isArrayInsertion?: boolean } = {},
): string {
  return applyEdits(source, modify(source, path, value, {
    formattingOptions,
    ...options,
  }));
}

function parseDocument(source: string, path: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError(`${path} must contain one valid JSON or JSONC object.`);
  }
  return value as Record<string, unknown>;
}

function formatting(source: string): FormattingOptions {
  return {
    insertSpaces: !/^\t/m.test(source),
    tabSize: 2,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
