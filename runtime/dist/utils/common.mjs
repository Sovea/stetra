//#region src/utils/common.ts
function unique(values) {
	return [...new Set(values)];
}
function uniqueCompact(values) {
	return [...new Set((values ?? []).filter((value) => value !== void 0 && value !== null))];
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validConfidence(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function hasConstraint(values, expected) {
	return expected.some((item) => values.includes(item));
}
//#endregion
export { hasConstraint, isRecord, unique, uniqueCompact, validConfidence };
