export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function uniqueCompact<T>(values: T[]): T[] {
  return [...new Set((values ?? []).filter((value) => value !== undefined && value !== null))];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function hasConstraint(values: string[], expected: string[]): boolean {
  return expected.some((item) => values.includes(item));
}
