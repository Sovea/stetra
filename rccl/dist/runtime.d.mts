import { c as RcclDocument, f as VerificationPolicy, l as RcclObservation, r as ParsedRcclResult } from "./types.mjs";

//#region src/io/parse-rccl.d.ts
declare function parseRccl(yamlText: string, options?: {
  allowVerifiedFields?: boolean;
}): ParsedRcclResult;
//#endregion
//#region src/verify/verify-evidence.d.ts
declare function verifyObservationEvidence(observation: RcclObservation, projectRoot: string, checkedAt: string, policy?: VerificationPolicy): RcclObservation;
//#endregion
//#region src/verify/verify-induction.d.ts
declare function verifyObservationInduction(observation: RcclObservation, policy?: VerificationPolicy): RcclObservation;
//#endregion
export { type RcclDocument, type RcclObservation, parseRccl, verifyObservationEvidence, verifyObservationInduction };