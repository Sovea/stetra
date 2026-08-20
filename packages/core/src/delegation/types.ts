import type {
  AgentInterpretation,
  HumanEvent,
  InterpretationBasis,
  RepositoryEvidence,
} from '../authority/types.ts';
import type { ProtocolEnvelope, ValidationIssue } from '../shared/protocol.ts';

export type VerifierRefRole = 'command-definition' | 'acceptance-surface';
export type RepositorySelectorKind = 'file' | 'tree';
export type AdoptionCriticality = 'material' | 'adoption-critical';
export type ChallengePolicy = 'required' | 'fact-triggered';
export type VerificationBaselineMode = 'task-start' | 'unknown';
export type VerificationExpectedStatus = 'passed' | 'failed' | 'unavailable';
export type HostPolicyCapability =
  | 'web-search'
  | 'network'
  | 'external-mutation'
  | 'fresh-context';

export interface ExactHumanEventInput {
  content: string;
  provider?: string;
  nativeId?: string;
}

export interface DeveloperEventInput extends ExactHumanEventInput {
  key: string;
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
  developerEventKeys: string[];
  repositoryEvidenceKeys: string[];
}

export interface MaterialDecisionAlternative {
  key: string;
  statement: string;
  impact: string;
}

export interface MaterialDecisionForkInput {
  key: string;
  basis: CompactInterpretationBasis;
  question: string;
  alternatives: MaterialDecisionAlternative[];
  recommendation?: {
    alternativeKey: string;
    rationale: string;
  };
  resolution?: {
    humanEventKey: string;
    selectedAlternativeKey?: string;
    decisionInterpretation: string;
  };
}

export interface TaskMeaningInput {
  basis: CompactInterpretationBasis;
  desiredOutcome: string;
  constraints: string[];
  nonGoals: string[];
  focus: string[];
}

export type EvidenceObligationStrategyInput =
  | {
      kind: 'runtime-check';
      checkKeys: string[];
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
  falsification: EvidenceObligationFalsification;
  strategies: EvidenceObligationStrategyInput[];
}

export interface EvidenceObligationFalsification {
  failureHypothesis: string;
  scenario: string;
  supportingObservation: string;
  contradictingObservation: string;
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
      expectation: {
        baselineStatus: VerificationExpectedStatus;
        currentStatus: VerificationExpectedStatus;
      };
    }
  | {
      mode: 'unknown';
    };

export interface VerificationDefinitionInput {
  key: string;
  rationale: string;
  execution: {
    preparation: Array<{
      key: string;
      argv: string[];
    }>;
    assertion: {
      argv: string[];
    };
  };
  executionInputs: Array<{
    kind: RepositorySelectorKind;
    path: string;
  }>;
  baseline: VerificationBaselineInput;
  verifierSelectors: Array<{
    kind: RepositorySelectorKind;
    path: string;
    role: VerifierRefRole;
  }>;
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
  developerEvents: DeveloperEventInput[];
  task: TaskMeaningInput;
  materialDecisionForks: MaterialDecisionForkInput[];
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
    humanAuthorization?: ExactHumanEventInput;
  };
}

export interface VerifierRef {
  kind: RepositorySelectorKind;
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
  execution: {
    preparation: Array<{
      stepId: string;
      key: string;
      argv: string[];
    }>;
    assertion: {
      stepId: string;
      argv: string[];
    };
  };
  executionInputs: Array<{
    kind: RepositorySelectorKind;
    path: string;
  }>;
  baseline:
    | {
      mode: 'task-start';
        rationale: string;
        obligationIds: string[];
        expectation: {
          baselineStatus: VerificationExpectedStatus;
          currentStatus: VerificationExpectedStatus;
        };
      }
    | { mode: 'unknown' };
  verifierRefs: VerifierRef[];
}

export type EvidenceObligationStrategy =
  | {
      kind: 'runtime-check';
      verifierIds: string[];
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
  falsification: EvidenceObligationFalsification;
  strategies: EvidenceObligationStrategy[];
}

export interface MaterializedInterpretation extends AgentInterpretation {}

export interface MaterialDecisionFork {
  id: string;
  key: string;
  basis: InterpretationBasis;
  question: string;
  alternatives: MaterialDecisionAlternative[];
  recommendation?: {
    alternativeKey: string;
    rationale: string;
  };
  resolution: {
    humanEventId: string;
    selectedAlternativeKey?: string;
    decisionInterpretation: MaterializedInterpretation;
  };
}

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
    developerEvents: HumanEvent[];
    providerTrustBoundary: 'host-supplied-event-not-runtime-authenticated';
  };
  understanding: {
    desiredOutcome: MaterializedInterpretation;
    constraints: MaterializedInterpretation[];
    nonGoals: MaterializedInterpretation[];
    focus: MaterializedInterpretation[];
  };
  repositoryEvidence: RepositoryEvidence[];
  materialDecisions: MaterialDecisionFork[];
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
      forks: MaterialDecisionForkInput[];
      message: string;
    })
  | (ProtocolEnvelope & { status: 'verification-required'; message: string })
  | (ProtocolEnvelope & { status: 'authority-invalid'; issues: ValidationIssue[] });
