#!/usr/bin/env node

/** Public executable entrypoint; command behavior lives in cli.ts. */
import { formatCliOutput, runCli } from './cli.ts';

const jsonRequested = process.argv.includes('--json');

runCli(process.argv.slice(2))
  .then((execution) => {
    process.stdout.write(formatCliOutput(execution));
    process.exitCode = execution.exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      jsonRequested
        ? `${JSON.stringify({ status: 'error', message }, null, 2)}\n`
        : `error: ${message}\n`,
    );
    process.exitCode = 1;
  });
