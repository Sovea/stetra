import { evaluateGuidance } from '../src/feedback.ts';

const lockfilePath = process.argv[2];
const taskIntent = { workflow: 'code', change_type: 'feature', operation: 'modify', target_layer: 'unknown', tech_stack: [], changed_files: [], tags: [] } as const;
const ego = { taskIntent, guidance: { must_follow: [{ id: 'd1', statement: 'directive', rationale: 'reason', prescription: 'must' as const, exceptions: [], examples: [], execution_mode: 'enforce' as const }], avoid: [], context_tensions: [], ambient: [] } };
evaluateGuidance({
  ego,
  lockfilePath,
  packet: {
    version: '1', status: 'compiled', task: { workflow: 'code', change_type: 'feature', operation: 'modify', input: { description: 'concurrent feedback' } },
    interpretation: { input_provenance: { interpretation_mode: 'deterministic-only' }, resolved: { task_intent: taskIntent, context_profile: {} } },
    governance: { ego, trace: {}, semantic_merge: { directive_modes: [{ directive_id: 'd1', execution_mode: 'enforce' }], context_tensions: [], relations: [], observation_links: [], observation_states: [] } },
  } as any,
});
