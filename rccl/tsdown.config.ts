export default {
  entry: ['./src/index.ts', './src/runtime.ts'],
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
};
