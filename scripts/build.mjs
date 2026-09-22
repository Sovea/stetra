import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const common = {
  bundle: true,
  platform: 'node', mainFields: ['module', 'main'], target: 'node24',
  format: 'esm', sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};
await build({
  ...common, entryPoints: ['src/cli/main.ts'], outfile: 'dist/cli.js',
  external: ['./init-ui.js'],
});
// Setup loads Ink on demand. Its optional developer tools stay in a lazy chunk,
// while the project Runtime only needs the standalone CLI bundle.
await build({
  ...common, entryPoints: ['src/cli/init-ui.tsx'], outdir: 'dist', splitting: true,
  chunkNames: 'chunks/[name]-[hash]', external: ['react-devtools-core'],
});
await build({ entryPoints: ['src/adapters/pi/extension.ts'], outfile: 'dist/pi.js', bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: true });
