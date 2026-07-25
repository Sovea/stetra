import { _ as RcclObservation, m as RcclDocument } from "./types.mjs";

//#region src/runtime.d.ts
declare function parseRccl(text: string): {
  valid: boolean;
  data?: RcclDocument;
  errors?: string[];
};
declare function verifyObservationEvidence(observation: RcclObservation, projectRoot: string, checkedAt: string): RcclObservation;
//#endregion
export { type RcclDocument, type RcclObservation, parseRccl, verifyObservationEvidence };