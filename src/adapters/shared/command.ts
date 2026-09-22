// Hooks run in the session cwd, which can be a subdirectory. Locate the exact
// installed adapter in an ancestor without embedding a machine-specific path.
export function hookCommand(skillDirectory: string, host: 'codex' | 'claude'): string {
  const launcher = `${skillDirectory}/stetra-explore/scripts/stetra.mjs`;
  const code = `const fs=require('node:fs'),path=require('node:path'),url=require('node:url');let root=process.cwd();while(!fs.existsSync(path.join(root,'${launcher}'))){const parent=path.dirname(root);if(parent===root)throw new Error('Stetra adapter missing; run stetra init in the project.');root=parent;}const entry=path.join(root,'${launcher}');process.argv=[process.execPath,entry,'hook','--host','${host}'];import(url.pathToFileURL(entry).href).catch(error=>{console.error(error);process.exitCode=1;});`;
  return `node -e "${code}"`;
}
