import type { CalibrationSlice, RcclCalibrationStats, RcclWorkflowCritiqueDocument, RcclWorkflowDiscoveryDocument } from '../types.ts';

const CANDIDATE_RCCL_SCHEMA = `
version: "1.0"
generated_at: <auto-filled-or-null>
git_ref: <auto-filled-or-null>

observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>

    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"

    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>
`.trim();

export function buildSynthesisPrompt(input: {
  scope: string;
  discovery: RcclWorkflowDiscoveryDocument;
  critique: RcclWorkflowCritiqueDocument;
  slices: CalibrationSlice[];
  contextMeta?: { raw: string } | null;
  stats: RcclCalibrationStats;
}): string {
  const lines: string[] = [];
  lines.push('# RCCL Calibration Workflow - Synthesize');
  lines.push('');
  lines.push('You are synthesizing reviewed discovery seeds into candidate RCCL observations.');
  lines.push('Use discovery for candidate material and critique for quality control.');
  lines.push('Produce only candidate RCCL YAML that the deterministic commit step can validate.');
  lines.push('');
  lines.push('## Output schema');
  lines.push('```yaml');
  lines.push(CANDIDATE_RCCL_SCHEMA);
  lines.push('```');
  lines.push('');
  lines.push('## Hard rules');
  lines.push('1. Return only candidate RCCL YAML. Do not add explanation before or after it.');
  lines.push('2. Include only observations that survived critique as keep or can be safely revised from critique feedback.');
  lines.push('3. Drop seeds with disposition drop unless there is a concrete critique reason that permits a narrower replacement.');
  lines.push('4. Every observation must include non-empty evidence copied from the provided windows.');
  lines.push('5. Evidence snippets must be verification anchors, not labels or paraphrases.');
  lines.push('6. Use provisional_id, scope_hint, source_slice_ids, and optional support_hint/traits.');
  lines.push('7. Do not include final RCCL fields: id, scope, support, verification, or lifecycle.');
  lines.push('8. semantic_key must stay stable across synonymous phrasings and repeated calibrations.');
  lines.push('9. Prefer 5 to 12 observations and skip weak or redundant signals.');
  lines.push('10. Set traits only when the reviewed evidence directly supports them; Runtime does not infer compatibility, migration, legacy, or anti-pattern semantics from prose.');
  lines.push('11. If the reviewed artifacts do not justify a verifiable observation, omit it instead of guessing.');
  lines.push('');
  appendContext(lines, input.contextMeta);
  lines.push('## Discovery artifact');
  lines.push('```yaml');
  lines.push(serializeArtifact(input.discovery));
  lines.push('```');
  lines.push('');
  lines.push('## Critique artifact');
  lines.push('```yaml');
  lines.push(serializeArtifact(input.critique));
  lines.push('```');
  lines.push('');
  appendSlices(lines, input.scope, input.stats, input.slices);
  return lines.join('\n');
}

function appendContext(lines: string[], contextMeta?: { raw: string } | null): void {
  if (!contextMeta?.raw) return;
  lines.push('## Repository context');
  lines.push('```yaml');
  lines.push(contextMeta.raw);
  lines.push('```');
  lines.push('');
}

function appendSlices(lines: string[], scope: string, stats: RcclCalibrationStats, slices: CalibrationSlice[]): void {
  lines.push(`## Scope: \`${scope}\``);
  lines.push(`Indexed files: ${stats.indexed_files}/${stats.total_files} | Selected slices: ${stats.selected_slices} | Windows: ${stats.windows}`);
  lines.push('');
  lines.push('## Calibration slices');
  lines.push('');
  for (const slice of slices) {
    lines.push(`### ${slice.id} (${slice.kind})`);
    lines.push(`Rationale: ${slice.rationale}`);
    lines.push(`Files: ${slice.files.join(', ')}`);
    for (const window of slice.windows) {
      lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
      lines.push('```');
      lines.push(window.snippet);
      lines.push('```');
    }
    lines.push('');
  }
}

function serializeArtifact(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
