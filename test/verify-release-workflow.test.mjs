import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/publish.yml'),
  'utf8',
);

assert.match(workflow, /^\s*release:\s*$[\s\S]*?types: \[published\]/m);
assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|workflow_dispatch):\s*$/m);
assert.match(workflow, /^permissions: \{\}\s*$/m);
assert.match(workflow, /^\s*environment: npm\s*$/m);
assert.match(workflow, /^\s*contents: read\s*$/m);
assert.match(workflow, /^\s*id-token: write\s*$/m);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /package-manager-cache: false/);
assert.match(workflow, /refs\/remotes\/origin\/main/);
assert.match(workflow, /scripts\/release-contract\.mjs/);
assert.match(
  workflow,
  /if: steps\.release\.outputs\.prepare_version == 'true'/,
);
assert.match(workflow, /scripts\/prepare-release-version\.mjs/);
assert.match(workflow, /steps\.release\.outputs\.source_version/);
assert.match(workflow, /git diff --cached --quiet/);
assert.match(workflow, /git ls-files --others --exclude-standard/);
for (const path of [
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/cli/src/version.ts',
]) {
  assert.match(workflow, new RegExp(path.replaceAll('.', '\\.')));
}
assert.match(workflow, /scripts\/publish-release\.mjs/);
assert.match(workflow, /npm audit signatures/);
assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
assert.deepEqual(
  [...workflow.matchAll(/^\s+([a-z-]+): write\s*$/gm)].map((match) => match[1]),
  ['id-token'],
  'OIDC token minting must be the workflow\'s only write permission.',
);

for (const action of ['actions/checkout', 'actions/setup-node', 'pnpm/action-setup']) {
  assert.match(
    workflow,
    new RegExp(`uses: ${action}@[a-f0-9]{40}`),
    `${action} must be pinned to a full commit SHA.`,
  );
}

const verifyIndex = workflow.indexOf('Verify source and dependency audit');
const prepareIndex = workflow.indexOf('Prepare tag-driven prerelease version');
const packIndex = workflow.indexOf('Pack exact release artifacts');
assert.ok(
  verifyIndex < prepareIndex && prepareIndex < packIndex,
  'source verification must precede transient version preparation and packing.',
);
