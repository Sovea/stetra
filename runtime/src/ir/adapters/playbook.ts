import { getDirectiveLayerRank } from '../../select/activation-plan.ts';
import type { Directive, LocalPlaybook } from '../../types.ts';
import { GOVERNANCE_IR_VERSION, type DirectiveIR, type DirectivePriorityIR, type DirectiveTraitsIR } from '../types.ts';

const WEIGHT_RANKS = { low: 0, normal: 1, high: 2, critical: 3 } as const;
const PRESCRIPTION_RANKS = { should: 0, must: 1 } as const;

export function directivesToIR(directives: Directive[], local: LocalPlaybook | null): DirectiveIR[] {
  const overrideById = new Map(local?.overrides.map((item) => [item.supersedes, item]) ?? []);
  const augmentById = new Map(local?.augments.map((item) => [item.id, item]) ?? []);
  const suppressById = new Map(local?.suppresses.map((item) => [item.id, item]) ?? []);
  return directives.map((directive) => {
    const override = overrideById.get(directive.id);
    const augment = augmentById.get(directive.id);
    const suppression = suppressById.get(directive.id);
    const prescription = override?.prescription ?? directive.prescription;
    const weight = override?.weight ?? directive.weight;
    return {
      irVersion: GOVERNANCE_IR_VERSION,
      id: directive.id,
      semanticKey: toSemanticKey(directive.id),
      source: {
        kind: directive.source.kind === 'local-addition' ? 'local-playbook' : 'builtin-playbook',
        id: directive.source.layerId,
        path: directive.source.filePath,
      },
      layer: {
        id: directive.source.layerId,
        rank: getDirectiveLayerRank(directive.source.layerId),
      },
      scope: { path: directive.scope.path },
      kind: directive.type,
      prescription,
      weight,
      priority: buildPriority(directive.source.layerId, prescription, weight, Boolean(override)),
      body: {
        description: directive.description,
        rationale: override?.rationale ?? directive.rationale,
        exceptions: override?.exceptions ?? directive.exceptions ?? [],
        examples: augment ? [...directive.examples, ...augment.examples] : directive.examples,
      },
      traits: buildTraits(directive),
      local: {
        overrideApplied: Boolean(override),
        augmentApplied: Boolean(augment),
        suppressed: Boolean(suppression),
        suppressionReason: suppression?.reason,
      },
    } satisfies DirectiveIR;
  });
}

function buildPriority(
  layerId: string,
  prescription: Directive['prescription'],
  weight: Directive['weight'],
  overrideApplied: boolean,
): DirectivePriorityIR {
  return {
    layerRank: getDirectiveLayerRank(layerId),
    prescriptionRank: PRESCRIPTION_RANKS[prescription],
    weightRank: WEIGHT_RANKS[weight],
    localOverrideRank: overrideApplied ? 1 : 0,
  };
}

function buildTraits(directive: Directive): DirectiveTraitsIR {
  const explicit = directive.traits ?? {};
  return {
    rcclImmune: directive.rccl_immune === true,
    safetyCritical: explicit.safety_critical === true,
    broadScope: explicit.broad_scope === true,
    compatibilitySensitive: explicit.compatibility_sensitive === true,
    migrationSensitive: explicit.migration_sensitive === true,
  };
}

function toSemanticKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
