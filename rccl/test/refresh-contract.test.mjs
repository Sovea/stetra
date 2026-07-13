import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { commitRcclObservationRefresh } from '../src/commit-refresh.ts';
import { parseRccl } from '../src/io/parse-rccl.ts';
import { prepareIncrementalRccl } from '../src/prepare.ts';
import { validateRcclObservationRefreshPayload } from '../src/validate-refresh.ts';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

{
  const yaml = `
version: "1.0"
generated_at: null
git_ref: null
observations:
  - id: "obs-trait-check"
    semantic_key: "compat-boundary"
    category: "architecture"
    scope: "api"
    pattern: "API handlers preserve a compatibility boundary."
    confidence: 0.8
    adherence_quality: "inconsistent"
    evidence:
      - file: "api/handler.ts"
        line_range: [1, 1]
        snippet: "export const alpha = 1;"
    support:
      source_slices: ["manual"]
      file_count: 1
      cluster_count: 1
      scope_basis: "single-file"
    verification:
      evidence_status: "verified"
      evidence_verified_count: 1
      evidence_confidence: 0.8
      induction_status: "narrowly-supported"
      induction_confidence: 0.7
      checked_at: null
      disposition: "keep"
    traits:
      compatibility_boundary: "yes"
      unsupported: true
`;
  const result = parseRccl(yaml, { allowVerifiedFields: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('traits.compatibility_boundary: must be boolean')));
  assert.ok(result.errors.some((error) => error.includes('traits.unsupported: unsupported trait')));
}

{
  const prepared = prepareIncrementalRccl(projectRoot, {
    targetFiles: ['runtime/src/types.ts'],
    mode: 'changed-files',
  });
  assert.equal(prepared.contract?.contractVersion, 'ai-contract/v1');
  assert.equal(prepared.contract?.schemaVersion, '1.0');
  assert.equal(prepared.contract?.kind, 'rccl-observation-refresh');
  assert.equal(prepared.refreshArtifact?.format, 'yaml');
  assert.equal(prepared.candidateArtifact, undefined);
  assert.ok(prepared.metadata.stats.windows <= 24);
  assert.ok(prepared.metadata.limits.applied);
  assert.equal(prepared.metadata.limits.file_limit, 4);
  assert.equal(prepared.metadata.limits.window_limit, 24);
}

{
  const prepared = prepareIncrementalRccl(projectRoot, {
    targetFiles: [join(projectRoot, 'runtime', 'src', 'types.ts')],
    mode: 'changed-files',
  });
  assert.equal(prepared.mode, 'contracts-required');
  assert.ok(prepared.metadata.focus_files.includes('runtime/src/types.ts'));
  assert.ok(prepared.metadata.stats.windows <= 24);
}

{
  const prepared = prepareIncrementalRccl(projectRoot, {
    targetFiles: ['does/not/exist.ts'],
    mode: 'changed-files',
  });
  assert.ok(prepared.mode === 'full-refresh-recommended' || prepared.mode === 'verify-only');
  assert.equal(prepared.contract, undefined);
  assert.equal(prepared.metadata.stats.windows, 0);
}

{
  const yaml = `
version: "1.0"
generated_at: null
scope: "auto"
keep: []
revise: []
retire: []
new_observations: []
semantic_equivalence:
  - observation_ids: ["obs-one", "obs-two"]
    confidence: 0.8
    evidence_refs:
      - kind: "file"
        ref: "runtime/src/types.ts:1-2"
        file: "runtime/src/types.ts"
        line_range: [1, 2]
    reason: "same semantic meaning"
counterexamples:
  - observation_id: "obs-one"
    confidence: 0.8
    evidence_refs:
      - kind: "file"
        ref: "runtime/src/types.ts:1-2"
        file: "runtime/src/types.ts"
        line_range: [1, 2]
    reason: "narrows the observation"
`;
  const result = validateRcclObservationRefreshPayload(yaml);
  assert.equal(result.valid, true);
  assert.equal(result.document.semantic_equivalence.length, 1);
  assert.equal(result.document.counterexamples.length, 1);
  assert.equal(result.diagnostics.summary.accepted, 2);
}

{
  const yaml = `
version: "1.0"
generated_at: null
scope: "auto"
keep: []
revise: []
retire: []
new_observations:
  - provisional_id: "obs-compat-boundary"
    semantic_key: "compat-boundary"
    category: "architecture"
    scope_hint: "api"
    pattern: "API handlers preserve legacy response shape."
    confidence: 0.8
    adherence_quality: "inconsistent"
    evidence:
      - file: "api/handler.ts"
        line_range: [1, 2]
        snippet: "export function handler() {\\n  return legacyShape();\\n}"
    evidence_refs:
      - kind: "file"
        ref: "api/handler.ts:1-2"
        file: "api/handler.ts"
        line_range: [1, 2]
    counterexamples: []
    source_slice_ids: ["slice-1"]
    traits:
      compatibility_boundary: true
semantic_equivalence: []
counterexamples: []
`;
  const result = validateRcclObservationRefreshPayload(yaml);
  assert.equal(result.valid, true);
  assert.equal(result.document.new_observations[0].traits.compatibility_boundary, true);
}

{
  const root = join(tmpdir(), `resonant-code-rccl-refresh-${Date.now()}`);
  mkdirSync(join(root, '.resonant-code'), { recursive: true });
  writeFileSync(join(root, 'sample.ts'), [
    'export const alpha = 1;',
    'export const beta = 2;',
    'export const gamma = alpha + beta;',
  ].join('\n'), 'utf-8');
  writeFileSync(join(root, '.resonant-code', 'rccl.yaml'), `
version: "1.0"
generated_at: null
git_ref: null
observations:
  - id: "obs-one"
    semantic_key: "shared-export-constant"
    category: "pattern"
    scope: "sample.ts"
    pattern: "Exported constants are used for shared values."
    confidence: 0.9
    adherence_quality: "good"
    evidence:
      - file: "sample.ts"
        line_range: [1, 1]
        snippet: "export const alpha = 1;"
    support:
      source_slices: ["manual"]
      file_count: 1
      cluster_count: 1
      scope_basis: "single-file"
    verification:
      evidence_status: "verified"
      evidence_verified_count: 1
      evidence_confidence: 0.9
      induction_status: "well-supported"
      induction_confidence: 0.9
      checked_at: null
      disposition: "keep"
    lifecycle:
      first_seen_git_ref: null
      last_seen_git_ref: null
      last_verified_at: null
      content_fingerprint: "one"
      status: "active"
  - id: "obs-two"
    semantic_key: "shared-export-constant"
    category: "pattern"
    scope: "sample.ts"
    pattern: "Shared values are represented as exported constants."
    confidence: 0.8
    adherence_quality: "good"
    evidence:
      - file: "sample.ts"
        line_range: [2, 2]
        snippet: "export const beta = 2;"
    support:
      source_slices: ["manual"]
      file_count: 1
      cluster_count: 1
      scope_basis: "single-file"
    verification:
      evidence_status: "verified"
      evidence_verified_count: 1
      evidence_confidence: 0.8
      induction_status: "well-supported"
      induction_confidence: 0.8
      checked_at: null
      disposition: "keep"
    lifecycle:
      first_seen_git_ref: null
      last_seen_git_ref: null
      last_verified_at: null
      content_fingerprint: "two"
      status: "active"
  - id: "obs-three"
    semantic_key: "derived-export-expression"
    category: "architecture"
    scope: "sample.ts"
    pattern: "Derived exported expressions are allowed in this file."
    confidence: 0.8
    adherence_quality: "good"
    evidence:
      - file: "sample.ts"
        line_range: [3, 3]
        snippet: "export const gamma = alpha + beta;"
    support:
      source_slices: ["manual"]
      file_count: 1
      cluster_count: 1
      scope_basis: "single-file"
    verification:
      evidence_status: "verified"
      evidence_verified_count: 1
      evidence_confidence: 0.8
      induction_status: "well-supported"
      induction_confidence: 0.8
      checked_at: null
      disposition: "keep"
    lifecycle:
      first_seen_git_ref: null
      last_seen_git_ref: null
      last_verified_at: null
      content_fingerprint: "three"
      status: "active"
`, 'utf-8');

  const refresh = `
version: "1.0"
generated_at: null
scope: "sample.ts"
keep: ["obs-one", "obs-two", "obs-three"]
revise: []
retire: []
new_observations: []
semantic_equivalence:
  - observation_ids: ["obs-one", "obs-two"]
    confidence: 0.8
    evidence_refs:
      - kind: "file"
        ref: "sample.ts:1-2"
        file: "sample.ts"
        line_range: [1, 2]
    reason: "same exported constant convention"
  - observation_ids: ["obs-one", "obs-three"]
    confidence: 0.9
    evidence_refs:
      - kind: "file"
        ref: "sample.ts:1-3"
        file: "sample.ts"
        line_range: [1, 3]
    reason: "invalid cross-category equivalence should be rejected"
counterexamples:
  - observation_id: "obs-one"
    confidence: 0.9
    evidence_refs:
      - kind: "file"
        ref: "sample.ts:3-3"
        file: "sample.ts"
        line_range: [3, 3]
    reason: "usage line narrows this from a broad module rule"
  - observation_id: "obs-three"
    confidence: 0.95
    evidence_refs:
      - kind: "rccl-evidence"
        ref: "sample.ts:3-3"
        file: "sample.ts"
        line_range: [3, 3]
      - kind: "file"
        ref: "missing.ts:1-1"
        file: "missing.ts"
        line_range: [1, 1]
    reason: "unverified independent evidence should be rejected"
`;
  const committed = commitRcclObservationRefresh(root, refresh);
  assert.equal(committed.status, 'committed');
  assert.equal(committed.refresh_summary.semantic_equivalence[0].status, 'applied');
  assert.deepEqual(committed.refresh_summary.semantic_equivalence[0].superseded_ids, ['obs-two']);
  assert.equal(committed.refresh_summary.semantic_equivalence[1].status, 'rejected');
  assert.match(committed.refresh_summary.semantic_equivalence[1].reason, /different RCCL categories/);
  const appliedCounterexample = committed.refresh_summary.counterexamples.find((entry) => entry.observation_id === 'obs-one');
  assert.ok(appliedCounterexample);
  assert.equal(appliedCounterexample.status, 'applied');
  assert.equal(appliedCounterexample.action, 'reduced-confidence');
  const rejectedCounterexample = committed.refresh_summary.counterexamples.find((entry) => entry.observation_id === 'obs-three');
  assert.ok(rejectedCounterexample);
  assert.equal(rejectedCounterexample.status, 'rejected');
  assert.match(rejectedCounterexample.reason, /verified evidence only restates/);
  assert.equal(committed.result.verification_summary.reduced_confidence_count, 1);
  assert.equal(committed.result.verification_summary.demoted_count, 0);
  assert.equal(committed.result.stats.superseded, 1);

  rmSync(root, { recursive: true, force: true });
}
