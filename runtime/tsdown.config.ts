export default {
  entry: ['./src/index.ts'],
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
    alwaysBundle: ['@resonant-code/rccl', '@resonant-code/rccl/runtime', 'yaml', 'ignore'],
  },
};
