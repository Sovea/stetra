import type { HostAdapter } from '../types.js';

export const pi = {
  id: 'pi',
  label: 'pi',
  skillDirectory: '.agents/skills',
  runtimeFiles: ['pi.js'],
  artifacts() {
    return [{
      path: '.pi/extensions/stetra.js', kind: 'file',
      content: `import { fileURLToPath } from 'node:url';
import { activate } from '../../.stetra/runtime/pi.js';
export default function stetra(pi) {
  return activate(pi, {
    cliPath: fileURLToPath(new URL('../../.stetra/runtime/cli.js', import.meta.url)),
    projectRoot: fileURLToPath(new URL('../../', import.meta.url)),
  });
}
`,
    }];
  },
} as const satisfies HostAdapter;
