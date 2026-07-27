#!/usr/bin/env node

/** Public executable entrypoint; command behavior lives behind main.ts. */
import { normalizeCliError } from './errors.ts';
import {
  formatCliError,
  formatCliOutput,
  runCli,
} from './cli.ts';

const jsonRequested = process.argv.includes('--json');
const colorEnabled = Boolean(process.stderr.isTTY)
  && process.env.NO_COLOR === undefined
  && !process.argv.includes('--no-color');

runCli(process.argv.slice(2))
  .then((execution) => {
    process.stdout.write(formatCliOutput(execution));
    process.exitCode = execution.exitCode;
  })
  .catch((error) => {
    const normalized = normalizeCliError(error);
    process.stderr.write(formatCliError(
      normalized,
      jsonRequested,
      colorEnabled && !jsonRequested,
    ));
    process.exitCode = normalized.exitCode;
  });
