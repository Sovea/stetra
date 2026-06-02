export default {
  entry: ['./src/index.ts'],
  format: 'esm',
  outDir: 'dist',
  platform: 'node',
  target: 'node22',
  clean: true,
  dts: false,
  sourcemap: false,
  fixedExtension: true,
  tsconfig: './tsconfig.json',
  hash: false,
};
