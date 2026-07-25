import { _ as RcclObservation, a as CalibrationEvidenceSelection, b as ValidateContextInput, c as CommitCalibrationInput, d as EvidenceStatus, f as PrepareCalibrationInput, g as RcclEvidenceProposal, h as RcclEvidence, i as CalibrationDiagnostic, l as CommitCalibrationOutput, m as RcclDocument, n as ApproveContextOutput, o as CalibrationEvidenceWindow, p as PrepareCalibrationOutput, r as CalibrationContract, s as CalibrationProposal, t as ApproveContextInput, u as DecisionDimension, v as RcclObservationContent, x as ValidateContextOutput, y as RcclObservationProposal } from "./types.mjs";

//#region src/lifecycle.d.ts
declare function prepareCalibration(input: PrepareCalibrationInput): PrepareCalibrationOutput;
declare function commitCalibration(input: CommitCalibrationInput): CommitCalibrationOutput;
declare function approveContext(input: ApproveContextInput): ApproveContextOutput;
declare function validateContext(input: ValidateContextInput): ValidateContextOutput;
//#endregion
//#region src/parse.d.ts
declare function parseRcclDocument(text: string): {
  valid: boolean;
  data?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
};
declare function parseCalibrationContract(input: unknown): {
  valid: boolean;
  data?: CalibrationContract;
  diagnostics: CalibrationDiagnostic[];
};
declare function parseCalibrationProposal(input: CalibrationProposal | string): {
  valid: boolean;
  data?: CalibrationProposal;
  diagnostics: CalibrationDiagnostic[];
};
//#endregion
export { type ApproveContextInput, type ApproveContextOutput, type CalibrationContract, type CalibrationDiagnostic, type CalibrationEvidenceSelection, type CalibrationEvidenceWindow, type CalibrationProposal, type CommitCalibrationInput, type CommitCalibrationOutput, type DecisionDimension, type EvidenceStatus, type PrepareCalibrationInput, type PrepareCalibrationOutput, type RcclDocument, type RcclEvidence, type RcclEvidenceProposal, type RcclObservation, type RcclObservationContent, type RcclObservationProposal, type ValidateContextInput, type ValidateContextOutput, approveContext, commitCalibration, parseCalibrationContract, parseCalibrationProposal, parseRcclDocument, prepareCalibration, validateContext };