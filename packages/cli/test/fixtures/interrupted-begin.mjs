import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname } from 'node:path';

const [phase, root, token] = process.argv.slice(2);
const rename = fs.renameSync;
fs.renameSync = (source, destination) => {
  const publication = basename(dirname(String(destination))) === 'tasks';
  if (publication && phase === 'before') process.exit(71);
  rename(source, destination);
  if (publication && phase === 'after') process.exit(72);
};
syncBuiltinESMExports();
const { runCli } = await import('../../src/cli.ts');
await runCli(['--json', 'task', 'begin', root, '--binding-token', token]);
throw new Error('The fixture did not interrupt Begin publication.');
