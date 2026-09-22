import { adapters, adapterRegistry } from '../adapters/registry.js';
import type { InstallationResult } from '../setup/installation.js';

export function printInstallation(result: InstallationResult, json: boolean): void {
  if (!process.stdout.isTTY || json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  const labels = Object.fromEntries(adapters.map(adapter => [adapter.id, adapter.label]));
  process.stdout.write(`Stetra ${result.status} for ${result.adapters.map(adapter => labels[adapter] ?? adapter).join(', ')}.\nProject: ${result.projectRoot}\n`);
  const changes = result.artifacts.filter(artifact => artifact.action !== 'unchanged');
  if (!changes.length) process.stdout.write('The project installation is current.\n');
  if (result.status === 'initialized' && changes.length) process.stdout.write(`Updated ${changes.length} project files or configuration sections.\n`);
  else for (const artifact of changes.filter(artifact => result.status !== 'blocked' || artifact.action === 'blocked')) {
    process.stdout.write(`  ${artifact.action}: ${artifact.path}${artifact.reason ? ` — ${artifact.reason}` : ''}\n`);
  }
  if (result.status === 'initialized') {
    process.stdout.write('Start a new Host session to load Stetra.\n');
    for (const adapter of Object.values(adapterRegistry)) if (result.adapters.includes(adapter.id)) {
      for (const hint of adapter.setupHints ?? []) process.stdout.write(`${hint}\n`);
    }
  }
}
