/** Build the public CLI while keeping the separately published Core external. */
export default {
  entry: ['./src/index.ts', './src/host.ts'],
  format: 'esm',
  outDir: 'dist',
  platform: 'node',
  target: 'node22',
  clean: true,
  dts: true,
  sourcemap: false,
  fixedExtension: true,
  tsconfig: './tsconfig.json',
  hash: false,
  deps: {
    neverBundle: [/^@sovea\/stetra-core(?:\/.*)?$/],
    onlyBundle: false,
  },
};
