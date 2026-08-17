import pc from 'picocolors';

import type { CliError } from '../errors.ts';
import { formatHumanResult } from './human.ts';

export interface CliExecution {
  output: unknown;
  json: boolean;
  exitCode: number;
  command: string;
  color: boolean;
}

export function formatCliOutput(execution: CliExecution): string {
  if (execution.json) return `${JSON.stringify(actionFirst(execution.output), null, 2)}\n`;
  if (typeof execution.output === 'string') return `${execution.output}\n`;
  return `${formatHumanResult(
    execution.command,
    execution.output,
    pc.createColors(execution.color),
  )}\n`;
}

function actionFirst(output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || !Object.prototype.hasOwnProperty.call(output, 'hostAction')) {
    return output;
  }
  const { hostAction, ...details } = output as Record<string, unknown>;
  return { hostAction, ...details };
}

export function formatCliError(error: CliError, json: boolean, color: boolean): string {
  if (json) {
    return `${JSON.stringify({
      status: 'error',
      code: error.code,
      message: error.message,
      ...(error.issues?.length ? { issues: error.issues } : {}),
      ...(error.inputCorrection ? { inputCorrection: error.inputCorrection } : {}),
    }, null, 2)}\n`;
  }
  const colors = pc.createColors(color);
  return `${colors.red(colors.bold('error'))}: ${error.message}\n`;
}
