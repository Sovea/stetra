import { spawnSync } from 'node:child_process';

export const PROCESS_TERMINATION_GRACE_MS = 1_000;
export const PROCESS_OUTPUT_DRAIN_MS = 1_000;

type TerminationSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export function ownsDetachedProcessGroup(): boolean {
  return process.platform !== 'win32';
}

/**
 * Signal the complete process tree owned by one frozen command.
 *
 * POSIX children are spawned as their own process group, so a negative PID is
 * an exact kernel-owned group target. Windows has no equivalent Node API;
 * taskkill /T /F is the platform's deterministic tree termination operation;
 * Windows does not expose POSIX-style graceful process-group signaling.
 */
export function signalOwnedProcessTree(
  pid: number,
  signal: TerminationSignal,
): boolean {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'taskkill.exe',
      ['/pid', String(pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true },
    );
    return result.status === 0;
  }

  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    return false;
  }
}

export function ownedProcessGroupExists(pid: number): boolean | undefined {
  if (process.platform === 'win32') return undefined;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return undefined;
  }
}

export function forwardTerminationSignals(
  pid: number,
): () => void {
  const remove = () => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  };
  const forward = (signal: 'SIGINT' | 'SIGTERM') => {
    // Remove both listeners before the task-store handler re-signals this
    // process. The second delivery must retain the platform default behavior.
    remove();
    signalOwnedProcessTree(pid, signal);
  };
  const onSigint = () => forward('SIGINT');
  const onSigterm = () => forward('SIGTERM');
  process.prependListener('SIGINT', onSigint);
  process.prependListener('SIGTERM', onSigterm);
  return remove;
}
