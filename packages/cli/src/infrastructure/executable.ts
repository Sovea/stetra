import which from 'which';

export type ExecutableResolution =
  | {
      path: string;
      status: 'resolved';
    }
  | {
      error: NodeJS.ErrnoException;
      status: 'unavailable';
    };

/**
 * Resolve the requested executable with the same working-directory context in
 * which it will run. Resolution is synchronous so the temporary cwd alignment
 * cannot interleave with other JavaScript work in this process.
 */
export function resolveExecutable(
  file: string,
  cwd: string,
): ExecutableResolution {
  const originalCwd = process.cwd();
  const needsCwdAlignment = originalCwd !== cwd;
  try {
    if (needsCwdAlignment) process.chdir(cwd);
    const path = which.sync(file, { nothrow: true });
    return path
      ? { path, status: 'resolved' }
      : {
          error: executableNotFound(file),
          status: 'unavailable',
        };
  } catch (error) {
    return {
      error: normalizeSystemError(error),
      status: 'unavailable',
    };
  } finally {
    if (needsCwdAlignment && process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  }
}

function executableNotFound(file: string): NodeJS.ErrnoException {
  const error = new Error(
    `Executable "${file}" was not found in the configured command environment.`,
  ) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

function normalizeSystemError(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error
    ? error as NodeJS.ErrnoException
    : new Error(String(error));
}
