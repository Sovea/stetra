import type {
  AgentInterpretation,
  HumanEvent,
  InterpretationBasis,
  RepositoryEvidence,
} from '../authority/types.ts';
import type { ProtocolEnvelope, ValidationIssue } from '../shared/protocol.ts';

export type VerifierRefRole = 'command-definition' | 'acceptance-surface';
export type AdoptionCriticality = 'material' | 'adoption-critical';
export type ChallengePolicy = 'required' | 'fact-triggered';
export type VerificationBaselineMode = 'task-start' | 'unknown';
export type HostPolicyCapability =
  | 'web-search'
  | 'network'
  | 'external-mutation'
  | 'fresh-context';

export interface DeveloperEventInput {
  content: string;
  provider?: string;
  nativeId?: string;
}

export interface RepositoryEvidenceInput {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  digest: string;
}

export interface CompactInterpretationBasis {
  developerEvent: boolean;
  repositoryEvidenceKeys: string[];
}

export interface MaterialSemanticFork {
  question: string;
  alternatives: string[];
  decisionImpact: string;
}

export interface TaskMeaningInput {
  desiredOutcome: string;
  constraints: string[];
  nonGoals: string[];
  focus: string[];
  unresolvedMaterialFork?: MaterialSemanticFork;
}

export type EvidenceObligationStrategyInput =
  | {
      kind: 'runtime-check';
      checkKeys: string[];
      expectedObservation: 'passed';
    }
  | {
      kind: 'repository-inspection';
      repositoryEvidenceKeys: string[];
    }
  | {
      kind: 'independent-challenge';
      policy: ChallengePolicy;
    }
  | {
      kind: 'human-review';
    };

export interface EvidenceObligationInput {
  key: string;
  statement: string;
  failureHypothesis: string;
  strategies: EvidenceObligationStrategyInput[];
}

export interface AdoptionConditionInput {
  key: string;
  statement: string;
  rationale: string;
  criticality: AdoptionCriticality;
  basis?: CompactInterpretationBasis;
  evidenceObligations: EvidenceObligationInput[];
}

export interface ObligationKeyReferenceInput {
  conditionKey: string;
  obligationKey: string;
}

export type VerificationBaselineInput =
  | {
      mode: 'task-start';
      rationale: string;
      obligationKeys: ObligationKeyReferenceInput[];
    }
  | {
      mode: 'unknown';
    };

export interface VerificationDefinitionInput {
  key: string;
  rationale: string;
  argv: string[];
  baseline: VerificationBaselineInput;
  commandDefinitionPaths: string[];
  acceptanceSurfacePaths: string[];
}

export interface HostPolicyRequirementInput {
  key: string;
  capability: HostPolicyCapability;
  requiredState: 'disabled' | 'enabled' | 'isolated';
  enforcementRequirement: 'required' | 'preferred';
  rationale: string;
  basis?: CompactInterpretationBasis;
}

export interface CompileDelegationInput extends ProtocolEnvelope {
  developerEvent: DeveloperEventInput;
  task: TaskMeaningInput;
  repositoryEvidence?: RepositoryEvidenceInput[];
  conditions: AdoptionConditionInput[];
  hostPolicyRequirements: HostPolicyRequirementInput[];
  delivery: {
    maxRepairAttempts: number;
  };
  checks?: VerificationDefinitionInput[];
  noCommandRationale?: string;
}

export interface VerificationRevisionInput extends ProtocolEnvelope {
  operation: 'revise-verification';
  priorContract: TaskContract;
  revision: {
    kind: 'execution-rebinding' | 'verification-plan';
    rationale: string;
    equivalenceClaim: string;
    checks?: VerificationDefinitionInput[];
    noCommandRationale?: string;
    humanAuthorization?: DeveloperEventInput;
  };
}

export interface VerifierRef {
  path: string;
  role: VerifierRefRole;
}

export interface LogicalVerifier {
  verifierId: string;
  key: string;
}

export interface VerificationDefinition {
  verifierId: string;
  definitionId: string;
  revision: number;
  supersedesDefinitionId?: string;
  key: string;
  rationale: string;
  argv: string[];
  baseline:
    | {
        mode: 'task-start';
        rationale: string;
        obligationIds: string[];
      }
    | { mode: 'unknown' };
  verifierRefs: VerifierRef[];
}

export type EvidenceObligationStrategy =
  | {
      kind: 'runtime-check';
      verifierIds: string[];
      expectedObservation: 'passed';
    }
  | {
      kind: 'repository-inspection';
      repositoryEvidenceIds: string[];
    }
  | {
      kind: 'independent-challenge';
      policy: ChallengePolicy;
    }
  | {
      kind: 'human-review';
    };

export interface EvidenceObligation {
  id: string;
  key: string;
  conditionId: string;
  statement: string;
  failureHypothesis: string;
  strategies: EvidenceObligationStrategy[];
}

export interface MaterializedInterpretation extends AgentInterpretation {}

export interface AdoptionCondition {
  id: string;
  key: string;
  statement: string;
  adoptionRationale: string;
  criticality: AdoptionCriticality;
  basis: InterpretationBasis;
  evidenceObligations: EvidenceObligation[];
}

export interface HostPolicyRequirement {
  id: string;
  key: string;
  capability: HostPolicyCapability;
  requiredState: 'disabled' | 'enabled' | 'isolated';
  enforcementRequirement: 'required' | 'preferred';
  rationale: string;
  basis: InterpretationBasis;
}

export interface DeliveryPlan {
  planId: string;
  maxRepairAttempts: number;
  lifecycle: readonly ['implement', 'collect', 'judge-evidence', 'resolve', 'handoff', 'decide'];
}

export type VerificationPlan =
  | {
      verificationPlanId: string;
      mode: 'checks';
      verifiers: LogicalVerifier[];
      definitions: VerificationDefinition[];
    }
  | {
      verificationPlanId: string;
      mode: 'no-command';
      rationale: string;
    };

export interface TaskContract extends ProtocolEnvelope {
  semanticContractId: string;
  verificationPlanId: string;
  effectiveContractId: string;
  authority: {
    developerEvent: HumanEvent;
    providerTrustBoundary: 'host-supplied-event-not-runtime-authenticated';
  };
  understanding: {
    desiredOutcome: MaterializedInterpretation;
    constraints: MaterializedInterpretation[];
    nonGoals: MaterializedInterpretation[];
    focus: MaterializedInterpretation[];
  };
  repositoryEvidence: RepositoryEvidence[];
  adoptionConditions: AdoptionCondition[];
  hostPolicyRequirements: HostPolicyRequirement[];
  plan: DeliveryPlan;
  authorization: {
    standingAuthorization: string;
    escalationBoundary: string[];
    focusPathsArePermissions: false;
  };
  verificationPlan: VerificationPlan;
}

export type DelegationCompileResult =
  | (ProtocolEnvelope & { status: 'delegation-compiled'; contract: TaskContract })
  | (ProtocolEnvelope & {
      status: 'semantic-decision-required';
      fork: MaterialSemanticFork;
      message: string;
    })
  | (ProtocolEnvelope & { status: 'verification-required'; message: string })
  | (ProtocolEnvelope & { status: 'authority-invalid'; issues: ValidationIssue[] });
