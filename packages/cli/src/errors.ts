import type { z } from 'zod';

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
  submittedDocument: unknown;
  issues: CliIssue[];
  stateWritten: false;
}

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
  input: Omit<ProtocolInputCorrection, 'kind' | 'issues' | 'stateWritten'>,
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
      ...input,
      issues: normalized.issues,
      stateWritten: false,
    },
  });
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
