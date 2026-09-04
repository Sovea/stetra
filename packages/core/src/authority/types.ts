/** Authority-bearing and Agent-authored task meaning stay physically separate. */

export type HumanEventKind = 'task' | 'correction' | 'exception' | 'decision';

export interface HumanEvent {
  id: string;
  kind: HumanEventKind;
  content: string;
  contentFingerprint: string;
  capture: 'unattested-input';
}

export interface AgentInterpretation {
  authority: 'agent-judgment';
  basisHumanEventIds: string[];
  desiredOutcome: string;
  constraints: string[];
  nonGoals: string[];
}
