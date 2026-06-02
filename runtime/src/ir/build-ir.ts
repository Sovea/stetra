import { resolveCompileTask } from '../compile-input.ts';
import { loadOrVerifyCompileSources } from '../load/compile-sources.ts';
import type { CompileInput } from '../types.ts';
import type { CompileSources } from '../load/compile-sources.ts';
import { feedbackToIR } from './adapters/feedback.ts';
import { directivesToIR } from './adapters/playbook.ts';
import { observationsToIR } from './adapters/rccl.ts';
import { taskToIR } from './adapters/task.ts';
import { buildIRFingerprints } from './fingerprint.ts';
import { stableHash } from '../utils/hash.ts';
import { GOVERNANCE_IR_VERSION } from './types.ts';
import type { GovernanceIRBundle } from './types.ts';

export async function buildGovernanceIR(input: CompileInput, sources?: CompileSources): Promise<GovernanceIRBundle> {
  const resolvedTask = resolveCompileTask(input);

  const loadedSources = sources?.rcclVerificationSummary
    ? sources
    : await loadOrVerifyCompileSources({ ...input, resolvedTask }, sources);

  const bundleWithoutFingerprints: Omit<GovernanceIRBundle, 'fingerprints'> = {
    irVersion: GOVERNANCE_IR_VERSION,
    task: taskToIR(resolvedTask),
    directives: directivesToIR(loadedSources.allDirectives, loadedSources.local),
    observations: observationsToIR(loadedSources.rccl?.observations ?? [], input.rcclPath),
    feedback: feedbackToIR(input.lockfilePath),
    hostProposals: input.hostProposals ?? [],
    sourceManifest: {
      builtinRoot: input.builtinRoot,
      selectedLayers: loadedSources.selectedLayerIds,
      localAugmentPath: input.localAugmentPath,
      rcclPath: input.rcclPath,
      lockfilePath: input.lockfilePath,
      projectRoot: input.projectRoot,
      sources: [
        {
          kind: 'builtin-playbook',
          id: 'builtin-root',
          path: input.builtinRoot,
          fingerprint: stableHash(loadedSources.selectedLayerIds),
        },
        ...(input.localAugmentPath ? [{ kind: 'local-playbook' as const, id: 'local-augment', path: input.localAugmentPath }] : []),
        ...(loadedSources.rccl ? [{
          kind: 'rccl' as const,
          id: loadedSources.rccl.git_ref ?? 'rccl',
          path: input.rcclPath,
          version: loadedSources.rccl.version,
          fingerprint: stableHash(loadedSources.rccl.observations.map((observation) => observation.lifecycle?.content_fingerprint ?? observation.id)),
        }] : []),
        ...(input.lockfilePath ? [{ kind: 'lockfile' as const, id: 'playbook.lock', path: input.lockfilePath }] : []),
        ...(input.hostProposals ?? []).map((proposal) => ({
          kind: 'host-proposal' as const,
          id: proposal.source.id,
          path: proposal.source.path,
          fingerprint: stableHash([proposal.kind, proposal.source.id, proposal.payload]),
        })),
      ],
    },
  };

  return {
    ...bundleWithoutFingerprints,
    fingerprints: buildIRFingerprints(bundleWithoutFingerprints),
  };
}
