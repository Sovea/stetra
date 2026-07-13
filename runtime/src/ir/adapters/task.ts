import { stableHash } from '../../utils/hash.ts';
import type { ResolvedTaskOutput } from '../../types.ts';
import { GOVERNANCE_IR_VERSION, type FieldProvenanceIR, type TargetIR, type TaskIR } from '../types.ts';

export function taskToIR(resolved: ResolvedTaskOutput): TaskIR {
  const intent = resolved.task_intent;
  const context = resolved.context_profile;
  return {
    irVersion: GOVERNANCE_IR_VERSION,
    id: stableHash(['task-ir', resolved.task.description, intent, context]),
    workflow: intent.workflow,
    changeType: intent.change_type,
    operation: intent.operation,
    targetLayer: intent.target_layer,
    targets: buildTargets(intent.target_file, intent.changed_files),
    techStack: intent.tech_stack,
    tags: intent.tags,
    context,
    provenance: buildProvenance(resolved),
    unresolved: resolved.input_provenance.unresolved_fields,
    diagnostics: {
      clarificationRecommended: resolved.diagnostics.clarification_recommended,
      ambiguityReasons: resolved.diagnostics.ambiguity_reasons,
    },
  };
}

function buildTargets(targetFile: string | undefined, changedFiles: string[]): TargetIR[] {
  const targets: TargetIR[] = [];
  if (targetFile) targets.push({ path: targetFile, role: 'target' });
  for (const path of changedFiles) {
    if (path !== targetFile) targets.push({ path, role: 'changed' });
  }
  return targets;
}

function buildProvenance(resolved: ResolvedTaskOutput): FieldProvenanceIR[] {
  const fields = resolved.input_provenance.resolved_fields as Array<{ field?: string; source?: string; confidence?: number }>;
  return fields.map((field) => ({
    field: String(field.field ?? 'unknown'),
    source: String(field.source ?? 'unknown'),
    confidence: typeof field.confidence === 'number' ? field.confidence : 0,
  }));
}
