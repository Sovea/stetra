export type HumanEventKind = 'task' | 'correction' | 'exception' | 'decision';

export interface HumanEvent {
  id: string;
  kind: HumanEventKind;
  content: string;
  contentFingerprint: string;
  provider?: string;
  nativeId?: string;
}

export type InterpretationField =
  | 'desired-outcome'
  | 'constraint'
  | 'non-goal'
  | 'focus-path';

export interface InterpretationBasis {
  humanEventIds: string[];
  repositoryEvidenceIds: string[];
}

export interface AgentInterpretation {
  id: string;
  field: InterpretationField;
  value: string;
  basis: InterpretationBasis;
}

export interface RepositoryEvidence {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  digest: string;
}
