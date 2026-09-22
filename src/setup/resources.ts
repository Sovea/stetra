import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { packageRoot } from '../package.js';
import { StetraError } from '../runtime/shared.js';
import type { HostAdapter } from '../adapters/types.js';
import type { InstallArtifact } from './artifacts.js';

export const skillNames = ['stetra-design', 'stetra-explore', 'stetra-explain'] as const;

export async function assertInstallerResources(): Promise<void> {
  try {
    for (const name of skillNames) await access(join(packageRoot, 'skills', name, 'SKILL.md'));
    await access(join(packageRoot, 'dist/cli.js'));
  } catch {
    throw new StetraError('invalid', 'Setup requires the full Stetra package. Run stetra init from an installed Stetra CLI or a built checkout; the project runtime does not include the installer.');
  }
}

async function source(path: string): Promise<string> {
  try { return await readFile(join(packageRoot, path), 'utf8'); }
  catch (error) {
    throw new StetraError('invalid', `Cannot read packaged resource ${path}. Run init from an installed Stetra package or a built checkout. ${error instanceof Error ? error.message : ''}`);
  }
}

async function resourceFiles(resource: string): Promise<Array<{ path: string; content: string }>> {
  const base = join(packageRoot, resource);
  const files: Array<{ path: string; content: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) files.push({ path: relative(base, path).split('\\').join('/'), content: await readFile(path, 'utf8') });
      else throw new StetraError('invalid', 'Packaged resources must be regular files or directories.');
    }
  }
  await visit(base);
  return files;
}

export async function sharedArtifacts(adapters: readonly HostAdapter[]): Promise<InstallArtifact[]> {
  const result: InstallArtifact[] = [];
  const runtime = new Set(['cli.js']);
  for (const adapter of adapters) for (const path of adapter.runtimeFiles ?? []) runtime.add(path);
  for (const path of runtime) result.push({ path: `.stetra/runtime/${path}`, kind: 'file', content: await source(`dist/${path}`) });
  result.push({ path: '.stetra/runtime/package.json', kind: 'file', content: '{"type":"module","private":true}\n' });
  result.push({
    path: '.stetra/.gitignore', kind: 'block', markers: { start: '# stetra:begin', end: '# stetra:end' },
    content: '# stetra:begin\n/runtime/\n/cache/\nstate.sqlite*\nindex.sqlite*\nmemory.lock/\nmemory/.tmp-*\n# stetra:end',
  });
  const files = await resourceFiles('skills');
  for (const directory of new Set(adapters.map(adapter => adapter.skillDirectory))) {
    for (const file of files) result.push({ path: `${directory}/${file.path}`, kind: 'file', content: file.content });
  }
  return result;
}
