/** Internal source models used by the Runtime hard kernel. */
export type Prescription = 'must' | 'should';
export type Weight = 'low' | 'normal' | 'high' | 'critical';
export type DirectiveType = 'constraint' | 'preference' | 'convention' | 'architecture' | 'anti-pattern';
export type ExecutionMode = 'enforce' | 'deviation-noted' | 'ambient' | 'suppress';

export interface DirectiveExampleSide {
  code: string;
}

export interface DirectiveExample {
  avoid?: DirectiveExampleSide;
  good?: DirectiveExampleSide;
  note: string;
}

export interface DirectiveScope {
  path: string;
}

export interface DirectiveTraits {
  safety_critical?: boolean;
  broad_scope?: boolean;
  compatibility_sensitive?: boolean;
  migration_sensitive?: boolean;
}

export interface Directive {
  id: string;
  type: DirectiveType;
  layer: string;
  scope: DirectiveScope;
  prescription: Prescription;
  weight: Weight;
  description: string;
  rationale: string;
  exceptions?: string[];
  examples: DirectiveExample[];
  rccl_immune?: boolean;
  traits?: DirectiveTraits;
  source: {
    kind: 'builtin' | 'local-addition';
    layerId: string;
    filePath: string;
  };
}

export interface LocalOverride {
  supersedes: string;
  scope?: DirectiveScope;
  prescription?: Prescription;
  weight?: Weight;
  rationale?: string;
  exceptions?: string[];
}

export interface LocalAugment {
  id: string;
  examples: DirectiveExample[];
}

export interface LocalSuppress {
  id: string;
  reason: string;
}

export interface LocalPlaybook {
  version: string;
  meta: {
    name?: string;
    extends: string[];
  };
  overrides: LocalOverride[];
  augments: LocalAugment[];
  suppresses: LocalSuppress[];
  additions: Directive[];
}
