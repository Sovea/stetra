import type { AgentInterpretation, HumanEvent } from '../authority/types.ts';
import type { ProtocolEnvelope, ValidationIssue } from '../shared/protocol.ts';

export type RepositorySelectorKind = 'file' | 'tree';
export type VerifierRefRole = 'command-definition' | 'acceptance-surface';

export interface ExactHumanEventInput {
  content: string;
}

export interface TaskInterpretationInput {
  desiredOutcome: string;
  constraints: string[];
  nonGoals: string[];
}

export interface RepositorySelector {
  kind: RepositorySelectorKind;
  path: string;
}

export interface CheckDefinitionInput {
  key: string;
  argv: string[];
  rationale?: string;
  preparation?: Array<{
    key: string;
    argv: string[];
  }>;
  executionInputs?: RepositorySelector[];
  verifierSelectors?: Array<RepositorySelector & { role: VerifierRefRole }>;
}

export type VerificationInput =
  | {
      mode: 'checks';
      checks: CheckDefinitionInput[];
    }
  | {
      mode: 'no-command';
      rationale: string;
    };

export type ConcernEvidenceRequirementInput =
  | { kind: 'check'; checkKey: string }
  | { kind: 'human-review'; question: string };

export interface AdoptionConcernInput {
  key: string;
  statement: string;
  adoptionImpact: string;
  evidenceRequirements: ConcernEvidenceRequirementInput[];
  falsification?: {
    plausibleFailure: string;
    scenario: string;
  };
}

export type AssuranceInput =
  | { mode: 'routine' }
  | {
      mode: 'consequential';
      concerns: AdoptionConcernInput[];
    };

export interface ExecutionPolicy {
  checkTimeoutMs: number;
  maxTimeoutMs: number;
  maxTimeoutRetriesPerCheck: number;
}

export interface CompileDelegationInput extends ProtocolEnvelope {
  humanEvent: ExactHumanEventInput;
  interpretation: TaskInterpretationInput;
  assurance: AssuranceInput;
  verification: VerificationInput;
  executionPolicy: ExecutionPolicy;
}

export interface VerifierRef extends RepositorySelector {
  role: VerifierRefRole;
}

/** Runtime form consumed by the CLI check runner. */
export interface VerificationDefinition {
  verifierId: string;
  definitionId: string;
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
  executionInputs: RepositorySelector[];
  verifierRefs: VerifierRef[];
}

export type ConcernEvidenceRequirement =
  | { kind: 'check'; verifierId: string }
  | { kind: 'human-review'; question: string };

export interface AdoptionConcern {
  id: string;
  key: string;
  statement: string;
  adoptionImpact: string;
  evidenceRequirements: ConcernEvidenceRequirement[];
  falsification?: {
    plausibleFailure: string;
    scenario: string;
  };
}

export type VerificationPlan =
  | { mode: 'checks'; definitions: VerificationDefinition[] }
  | { mode: 'no-command'; rationale: string };

export type Assurance =
  | { mode: 'routine' }
  | { mode: 'consequential'; concerns: AdoptionConcern[] };

export interface TaskContract extends ProtocolEnvelope {
  contractId: string;
  semanticContractId: string;
  verificationPlanId: string;
  effectiveContractId: string;
  humanEvents: HumanEvent[];
  interpretation: AgentInterpretation;
  assurance: Assurance;
  verificationPlan: VerificationPlan;
  executionPolicy: ExecutionPolicy;
}

export type DelegationCompileResult =
  | (ProtocolEnvelope & {
      status: 'delegation-compiled';
      contract: TaskContract;
    })
  | (ProtocolEnvelope & {
      status: 'authority-invalid';
      issues: ValidationIssue[];
    });
