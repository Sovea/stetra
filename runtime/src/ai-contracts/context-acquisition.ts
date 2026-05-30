import type {
  ContextAcquisitionContractInput,
  ContextAcquisitionContractOutput,
} from './types.ts';

const CONTEXT_ACQUISITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requests: { type: 'array' },
  },
  required: ['requests'],
};

export function prepareContextAcquisitionContract(input: ContextAcquisitionContractInput): ContextAcquisitionContractOutput {
  const prompt = [
    'Acquire repository context needed before semantic governance graph generation.',
    'Use this only to request bounded file windows, changed files, tests, or calibration slices that materially affect Runtime guidance.',
    'Runtime/RCCL will decide whether the requested context becomes authoritative repository observation data.',
    'Return JSON only.',
    '',
    `Task description: ${input.task.description}`,
    `Target file: ${input.task.targetFile ?? '(none)'}`,
    `Changed files: ${input.task.changedFiles?.join(', ') || '(none)'}`,
  ].join('\n');
  const artifact = {
    suggestedPath: input.artifactPath,
    format: 'json' as const,
    usage: `Write bounded context-acquisition requests to ${input.artifactPath}; use them to drive calibrate-repo-context prepare-incremental before semantic graph compilation.`,
  };
  return {
    acquisitionPrompt: prompt,
    acquisitionSchema: JSON.stringify(CONTEXT_ACQUISITION_SCHEMA, null, 2),
    acquisitionArtifact: artifact,
    contract: {
      contractVersion: 'ai-contract/v2',
      kind: 'context-acquisition',
      schemaId: 'runtime.context-acquisition',
      schemaVersion: '2.0',
      prompt,
      schema: CONTEXT_ACQUISITION_SCHEMA,
      artifact,
      provenance: { owner: 'runtime', deterministic: true },
      cacheKeyMaterial: { task: input.task, schemaId: 'runtime.context-acquisition' },
    },
  };
}
