import type {
  AgentInterpretation,
  HumanEvent,
  InterpretationBasis,
  RepositoryEvidence,
} from '../authority/types.ts';
import type {
  ProtocolEnvelope,
  ValidationIssue,
} from '../shared/protocol.ts';

export type ConsequenceLevel = 'low' | 'medium' | 'high';
export type VerificationSource = 'team-default' | 'host-task';
export type VerifierRefRole = 'command-definition' | 'acceptance-surface';

export interface VerifierRef {
  path: string;
  role: VerifierRefRole;
}

export interface MaterialSemanticFork {
  question: string;
  alternatives: string[];
  decisionImpact: string;
}

export interface SemanticEnvelopeInput {
  desiredOutcome: SemanticValueInput;
  constraints: SemanticValueInput[];
  nonGoals: SemanticValueInput[];
  focus: SemanticValueInput[];
  consequence: ConsequenceValueInput;
  unresolvedMaterialFork?: MaterialSemanticFork;
}

export interface SemanticValueInput {
  value: string;
  basis: InterpretationBasis;
}

export interface ConsequenceValueInput {
  value: ConsequenceLevel;
  basis: InterpretationBasis;
}

export interface VerificationDefinition {
  id: string;
  rationale: string;
  argv: string[];
  timeoutMs: number;
  source: VerificationSource;
  verifierRefs: VerifierRef[];
}

export interface VerificationDefinitionInput {
  id: string;
  rationale: string;
  argv: string[];
  timeoutMs: number;
  source: VerificationSource;
  commandDefinitionPaths: string[];
  acceptanceSurfacePaths: string[];
}

export interface VerificationInput {
  checks?: VerificationDefinitionInput[];
  noCommandRationale?: string;
}

export interface CompileDelegationInput extends ProtocolEnvelope {
  humanEvents: HumanEvent[];
  repositoryEvidence?: RepositoryEvidence[];
  semantic: SemanticEnvelopeInput;
  verification: VerificationInput;
}

export interface MaterializedInterpretation extends AgentInterpretation {}

export interface SemanticContract extends ProtocolEnvelope {
  contractId: string;
  authority: {
    humanEvents: HumanEvent[];
    providerTrustBoundary: 'host-supplied-events-not-runtime-authenticated';
  };
  semantic: {
    desiredOutcome: MaterializedInterpretation;
    constraints: MaterializedInterpretation[];
    nonGoals: MaterializedInterpretation[];
    focus: MaterializedInterpretation[];
    consequence: ConsequenceLevel;
    consequenceInterpretation: MaterializedInterpretation;
  };
  repositoryEvidence: RepositoryEvidence[];
  interpretationTrace: MaterializedInterpretation[];
  authorization: {
    standingAuthorization: string;
    escalationBoundary: string[];
    focusPathsArePermissions: false;
  };
  verification:
    | { mode: 'checks'; checks: VerificationDefinition[] }
    | { mode: 'no-command'; rationale: string };
}

export type DelegationCompileResult =
  | (ProtocolEnvelope & {
      status: 'delegation-compiled';
      contract: SemanticContract;
    })
  | (ProtocolEnvelope & {
      status: 'semantic-decision-required';
      fork: MaterialSemanticFork;
      message: string;
    })
  | (ProtocolEnvelope & {
      status: 'verification-required';
      message: string;
    })
  | (ProtocolEnvelope & {
      status: 'authority-invalid';
      issues: ValidationIssue[];
    });
