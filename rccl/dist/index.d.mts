import { a as CommitCalibrationOutput, c as PrepareCalibrationInput, d as RcclEvidence, f as RcclObservation, h as ValidateContextOutput, i as CommitCalibrationInput, l as PrepareCalibrationOutput, m as ValidateContextInput, n as CalibrationDiagnostic, o as DecisionDimension, p as RcclObservationProposal, r as CalibrationProposal, s as EvidenceStatus, t as CalibrationContract, u as RcclDocument } from "./types.mjs";

//#region src/lifecycle.d.ts
declare function prepareCalibration(input: PrepareCalibrationInput): PrepareCalibrationOutput;
declare function commitCalibration(input: CommitCalibrationInput): CommitCalibrationOutput;
declare function validateContext(input: ValidateContextInput): ValidateContextOutput;
//#endregion
//#region src/parse.d.ts
declare function parseRcclDocument(text: string): {
  valid: boolean;
  data?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
};
declare function parseCalibrationProposal(input: CalibrationProposal | string): {
  valid: boolean;
  data?: CalibrationProposal;
  diagnostics: CalibrationDiagnostic[];
};
//#endregion
export { type CalibrationContract, type CalibrationDiagnostic, type CalibrationProposal, type CommitCalibrationInput, type CommitCalibrationOutput, type DecisionDimension, type EvidenceStatus, type PrepareCalibrationInput, type PrepareCalibrationOutput, type RcclDocument, type RcclEvidence, type RcclObservation, type RcclObservationProposal, type ValidateContextInput, type ValidateContextOutput, commitCalibration, parseCalibrationProposal, parseRcclDocument, prepareCalibration, validateContext };