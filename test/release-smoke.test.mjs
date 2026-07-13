import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'resonant-code-release-'));
try {
  const plugin = join(temporary, 'plugin');
  const project = join(temporary, 'project');
  mkdirSync(plugin, { recursive: true });
  mkdirSync(join(project, '.resonant-code'), { recursive: true });
  cpSync(join(workspace, '.codex-plugin'), join(plugin, '.codex-plugin'), { recursive: true });
  cpSync(join(workspace, 'playbook'), join(plugin, 'playbook'), { recursive: true });
  cpSync(join(workspace, 'runtime', 'dist'), join(plugin, 'runtime', 'dist'), { recursive: true });
  cpSync(join(workspace, 'rccl', 'dist'), join(plugin, 'rccl', 'dist'), { recursive: true });
  cpSync(join(workspace, 'skills'), join(plugin, 'skills'), { recursive: true });

  writeFileSync(join(project, 'example.ts'), 'export const answer = 42;\n', 'utf8');
  writeFileSync(join(project, '.resonant-code', 'rccl.yaml'), `version: "1.0"
generated_at: "2026-01-01T00:00:00.000Z"
git_ref: null
observations:
  - id: obs-export-style
    semantic_key: export-style
    category: style
    scope: "**/*.ts"
    pattern: Named exports are used in TypeScript modules.
    confidence: 0.9
    adherence_quality: good
    evidence:
      - file: example.ts
        line_range: [1, 1]
        snippet: "export const answer = 42;"
    support:
      source_slices: [slice-example]
      file_count: 1
      cluster_count: 1
      scope_basis: single-file
    verification:
      evidence_status: verified
      evidence_verified_count: 1
      evidence_confidence: 0.9
      induction_status: well-supported
      induction_confidence: 0.9
      checked_at: "2026-01-01T00:00:00.000Z"
      disposition: keep
    lifecycle:
      first_seen_git_ref: null
      last_seen_git_ref: null
      last_verified_at: "2026-01-01T00:00:00.000Z"
      content_fingerprint: smoke-observation
      status: active
    traits: {}
`, 'utf8');

  const runtime = await import(pathToFileURL(join(plugin, 'runtime', 'dist', 'index.mjs')).href);
  assert.deepEqual(Object.keys(runtime).sort(), ['compile', 'evaluateGuidance', 'planGuidance']);
  const result = await runtime.compile({
    builtinRoot: join(plugin, 'playbook'),
    rcclPath: join(project, '.resonant-code', 'rccl.yaml'),
    projectRoot: project,
    task: {
      description: 'Add an exported feature',
      workflow: 'code',
      changeType: 'feature',
      operation: 'modify',
      targetFile: 'example.ts',
      changedFiles: ['example.ts'],
      techStack: ['typescript'],
    },
  });
  assert.equal(result.packet.version, '1');
  assert.equal(result.packet.status, 'compiled');
  assert.equal(result.packet.task.change_type, 'feature');
  assert.ok(result.trace.activation.selected_layers.includes('builtin/task-types/feature'));
  assert.ok(result.packet.fingerprints.bundle);
  assert.ok(result.postCompileContractRequests.some((request) => request.kind === 'adherence-evidence'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
