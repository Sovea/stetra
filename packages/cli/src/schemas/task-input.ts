/** Public input discovery uses the same schemas as command validation. */
import { z } from 'zod';
import { TaskBeginDocumentSchema, TaskDecisionDocumentSchema, TaskHandoffDocumentSchema } from './task.ts';

export const taskInputSchemas = {
  begin: TaskBeginDocumentSchema,
  handoff: TaskHandoffDocumentSchema,
  decide: TaskDecisionDocumentSchema,
};

export const taskInputExamples = {
  begin: {
    humanEvent: { content: 'Implement the exact developer request.' },
    interpretation: { desiredOutcome: 'Describe the observable outcome.', constraints: [], nonGoals: [] },
    assurance: { mode: 'routine' },
    verification: { mode: 'checks', checks: [{ key: 'test', argv: ['npm', 'test'] }] },
  },
  handoff: {
    actualChange: {
      behavior: 'Explain the actual changed behavior.',
      mechanism: ['Explain how the implementation produces that behavior.'],
    },
    recommendation: { action: 'accept', rationale: 'Explain why the current evidence supports this advice.' },
  },
  decide: {
    humanEvent: { content: 'The exact later developer decision.' },
    action: 'accepted',
    reason: 'Explain the decision expressed by that developer message.',
  },
} satisfies { [K in keyof typeof taskInputSchemas]: z.input<(typeof taskInputSchemas)[K]> };

export function taskInputExample(stage: keyof typeof taskInputSchemas): string {
  const example = taskInputExamples[stage];
  taskInputSchemas[stage].parse(example);
  return JSON.stringify(example, null, 2);
}

export function describeTaskInput(stage: keyof typeof taskInputSchemas) {
  return {
    status: 'input-schema',
    stage,
    inputSchema: z.toJSONSchema(taskInputSchemas[stage], { io: 'input' }),
    example: JSON.parse(taskInputExample(stage)) as unknown,
    guidance: [
      'Examples illustrate input shape. Author the actual task semantics and repository-specific checks.',
      'Runtime additionally validates current task state, evidence references, and structural evidence ceilings.',
      ...(stage === 'handoff' ? [
        'Routine tasks omit concernFindings. Consequential findings reference only concern keys declared at Begin.',
      ] : []),
      'Human text is relayed exactly as unattested input. A decision requires a new developer message.',
    ],
  };
}
