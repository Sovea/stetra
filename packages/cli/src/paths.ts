import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export function resolveBuiltinRoot(): string {
  const corePackageRoot = dirname(
    require.resolve('@sovea/resonant-code-core/package.json'),
  );
  const builtinRoot = join(corePackageRoot, 'assets', 'playbook');
  if (!existsSync(builtinRoot)) {
    throw new Error(
      `Built-in Playbook assets are missing from ${builtinRoot}. Reinstall @sovea/resonant-code-core.`,
    );
  }
  return builtinRoot;
}
