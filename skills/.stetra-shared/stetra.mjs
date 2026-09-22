import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const installedRoot = new URL('../../../', import.meta.url);
const installedRuntime = new URL('.stetra/runtime/cli.js', installedRoot);
const packagedRuntime = new URL('../../dist/cli.js', import.meta.url);
// A packaged plugin must use its own runtime even inside another Stetra project.
const installed = !existsSync(packagedRuntime) && existsSync(installedRuntime);
if (installed && !process.argv.some(argument => argument === '--project' || argument.startsWith('--project='))) {
  process.argv.push('--project', fileURLToPath(installedRoot));
}
await import((installed ? installedRuntime : packagedRuntime).href);
