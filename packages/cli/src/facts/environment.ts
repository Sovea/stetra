import type { ExecutionEnvironment, VerificationDefinition } from '@sovea/stetra-core';

import { resolveExecutable } from '../infrastructure/executable.ts';

export function collectExecutionEnvironment(
  projectRoot: string,
  definitions: VerificationDefinition[],
): ExecutionEnvironment {
  const commands = [...new Set(definitions.flatMap((definition) => [
    ...definition.execution.preparation.map((step) => step.argv[0]),
    definition.execution.assertion.argv[0],
  ]))]
    .sort((left, right) => left.localeCompare(right));
  return {
    platform: process.platform,
    architecture: process.arch,
    executables: commands.map((command) => {
      const resolution = resolveExecutable(command, projectRoot);
      return {
        command,
        resolvedPath: resolution.status === 'resolved' ? resolution.path : null,
      };
    }),
  };
}
