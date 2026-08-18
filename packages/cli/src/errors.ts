import type { z } from 'zod';

import { stableFingerprint } from './protocol.ts';

export type CliErrorCode =
  | 'INVALID_INPUT'
  | 'PROMPT_CANCELLED'
  | 'UNEXPECTED_ERROR'
  | 'USAGE_ERROR';

export interface CliIssue {
  code?: string;
  path: string;
  message: string;
  remediation?: string;
}

export interface ProtocolInputCorrection {
  kind: 'correct-protocol-input';
  label: string;
  source: { transport: 'stdin' } | { transport: 'file'; path: string };
  submittedInput: {
    fingerprint: string;
    preview: ProtocolValuePreview;
  };
  issueContexts: Array<{
    path: string;
    value: ProtocolValuePreview;
    parent?: {
      path: string;
      preview: ProtocolValuePreview;
    };
  }>;
  issues: CliIssue[];
  stateWritten: false;
}

export type ProtocolValuePreview =
  | { kind: 'missing' }
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string; length: number; truncated: boolean }
  | { kind: 'array'; length: number }
  | { kind: 'object'; keys: string[]; omittedKeyCount: number };

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly issues?: CliIssue[];
  readonly inputCorrection?: ProtocolInputCorrection;

  constructor(
    code: CliErrorCode,
    message: string,
    exitCode: number,
    options: {
      cause?: unknown;
      issues?: CliIssue[];
      inputCorrection?: ProtocolInputCorrection;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.issues = options.issues;
    this.inputCorrection = options.inputCorrection;
  }
}

export function attachProtocolInputCorrection(
  error: unknown,
  input: {
    label: string;
    source: ProtocolInputCorrection['source'];
    submittedDocument: unknown;
  },
): CliError {
  const normalized = normalizeCliError(error);
  if (normalized.code !== 'INVALID_INPUT' || !normalized.issues?.length) {
    return normalized;
  }
  return new CliError(normalized.code, normalized.message, normalized.exitCode, {
    cause: normalized,
    issues: normalized.issues,
    inputCorrection: {
      kind: 'correct-protocol-input',
      label: input.label,
      source: input.source,
      submittedInput: {
        fingerprint: stableFingerprint(input.submittedDocument),
        preview: previewValue(input.submittedDocument),
      },
      issueContexts: normalized.issues.map((issue) => issueContext(
        input.submittedDocument,
        issue.path,
      )),
      issues: normalized.issues,
      stateWritten: false,
    },
  });
}

const MAX_PREVIEW_STRING_LENGTH = 256;
const MAX_PREVIEW_OBJECT_KEYS = 24;

function previewValue(value: unknown, exists = true): ProtocolValuePreview {
  if (!exists) return { kind: 'missing' };
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'string') {
    return {
      kind: 'string',
      value: value.slice(0, MAX_PREVIEW_STRING_LENGTH),
      length: value.length,
      truncated: value.length > MAX_PREVIEW_STRING_LENGTH,
    };
  }
  if (Array.isArray(value)) return { kind: 'array', length: value.length };
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return {
      kind: 'object',
      keys: keys.slice(0, MAX_PREVIEW_OBJECT_KEYS),
      omittedKeyCount: Math.max(0, keys.length - MAX_PREVIEW_OBJECT_KEYS),
    };
  }
  return { kind: 'missing' };
}

function issueContext(document: unknown, path: string): ProtocolInputCorrection['issueContexts'][number] {
  const segments = parseIssuePath(path);
  const located = locateValue(document, segments);
  if (!segments.length) return { path, value: previewValue(located.value, located.exists) };
  const parentSegments = segments.slice(0, -1);
  const parent = locateValue(document, parentSegments);
  return {
    path,
    value: previewValue(located.value, located.exists),
    parent: {
      path: formatSegments(parentSegments),
      preview: previewValue(parent.value, parent.exists),
    },
  };
}

function parseIssuePath(path: string): Array<string | number> {
  if (path === '$' || path === '') return [];
  const segments: Array<string | number> = [];
  for (const match of path.matchAll(/(?:^|\.)([^.[\]]+)|\[(\d+)\]/g)) {
    if (match[1] !== undefined) segments.push(match[1]);
    else if (match[2] !== undefined) segments.push(Number(match[2]));
  }
  return segments;
}

function locateValue(
  document: unknown,
  segments: Array<string | number>,
): { exists: boolean; value: unknown } {
  let value = document;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(value) || segment >= value.length) return { exists: false, value: undefined };
      value = value[segment];
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return { exists: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return { exists: true, value };
}

function formatSegments(segments: Array<string | number>): string {
  if (!segments.length) return '$';
  return segments.reduce<string>((formatted, segment) =>
    typeof segment === 'number'
      ? `${formatted}[${segment}]`
      : formatted ? `${formatted}.${segment}` : segment, '');
}

export function usageError(message: string, cause?: unknown): CliError {
  return new CliError('USAGE_ERROR', message, 2, { cause });
}

export function inputError(
  message: string,
  cause?: unknown,
  issues?: CliIssue[],
): CliError {
  return new CliError('INVALID_INPUT', message, 2, { cause, issues });
}

export function validationError(
  label: string,
  error: z.ZodError,
): CliError {
  const issues = error.issues.map((issue) => ({
    code: `schema-${issue.code}`,
    path: formatIssuePath(issue.path),
    message: issue.message,
    remediation: 'Use the exact generated artifact shape and field names.',
  }));
  const details = issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  return new CliError(
    'INVALID_INPUT',
    `${label} is invalid${details ? `: ${details}` : '.'}`,
    2,
    { cause: error, issues },
  );
}

export function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (isPromptCancellation(error)) {
    return new CliError(
      'PROMPT_CANCELLED',
      'Interactive input was cancelled.',
      130,
      { cause: error },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('UNEXPECTED_ERROR', message, 1, { cause: error });
}

function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'ExitPromptError' || error.name === 'AbortPromptError');
}

function formatIssuePath(path: PropertyKey[]): string {
  if (!path.length) return '$';
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    const value = String(segment);
    return formatted ? `${formatted}.${value}` : value;
  }, '');
}
