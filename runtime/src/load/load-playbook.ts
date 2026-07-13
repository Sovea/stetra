import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseYaml } from '../utils/yaml.ts';
import type { Directive, DirectiveExample, DirectiveScope, DirectiveTraits, DirectiveType, LocalPlaybook, Prescription, Weight } from '../types.ts';

/**
 * Discovers built-in layer ids by scanning the plugin playbook directory.
 */
export function discoverBuiltinLayers(builtinRoot: string): Map<string, string> {
  const layers = new Map<string, string>();

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.yaml')) continue;
      const rel = relative(builtinRoot, full).replace(/\\/g, '/');
      const parts = rel.split('/');
      let layerId = 'builtin';
      if (rel === 'core.yaml') {
        layerId = 'builtin/core';
      } else if (parts.at(-1) === 'core.yaml') {
        layerId = `builtin/${parts.slice(0, -1).join('/')}`;
      } else {
        layerId = `builtin/${rel.replace(/\.yaml$/, '')}`;
      }
      layers.set(layerId, full);
    }
  }

  walk(builtinRoot);
  return layers;
}

/**
 * Expands local augment extends patterns against discovered built-in layers.
 */
export function resolveExtendedLayers(extendsEntries: string[], layers: Map<string, string>): string[] {
  const selected: string[] = [];
  for (const entry of extendsEntries) {
    if (entry.startsWith('!')) {
      const target = entry.slice(1);
      const next = selected.filter((value) => value !== target);
      selected.length = 0;
      selected.push(...next);
      continue;
    }
    if (entry.endsWith('/*')) {
      const prefix = entry.slice(0, -1);
      for (const match of [...layers.keys()].filter((layerId) => layerId.startsWith(prefix)).sort()) {
        if (!selected.includes(match)) selected.push(match);
      }
      continue;
    }
    if (layers.has(entry) && !selected.includes(entry)) {
      selected.push(entry);
    }
  }
  return selected;
}

/**
 * Loads directives for one built-in layer file.
 */
export function loadDirectiveFile(filePath: string, layerId: string): Directive[] {
  const parsed = parseYaml(readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Directive file must contain a top-level array: ${filePath}`);
  }
  return parsed.map((item, index) => normalizeDirective(assertRecord(item, `${filePath}[${index}]`), layerId, filePath, 'builtin'));
}

/**
 * Loads the optional local playbook and normalizes all local sections.
 */
export function loadLocalPlaybook(filePath?: string): LocalPlaybook | null {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = assertRecord(parseYaml(readFileSync(filePath, 'utf-8')), filePath);
  if (parsed.version !== 1 && parsed.version !== '1.0') {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${filePath} must use local playbook schema 1. Re-run init; existing data was not modified.`);
  }
  const meta = ((parsed.meta ?? {}) as Record<string, unknown>);
  return {
    version: '1.0',
    meta: {
      name: typeof meta.name === 'string' ? meta.name : undefined,
      extends: Array.isArray(meta.extends) ? meta.extends.map(String) : [],
    },
    overrides: arrayField(parsed.overrides, 'overrides', filePath).map((item, index) => normalizeOverride(item, `${filePath}.overrides[${index}]`)),
    augments: arrayField(parsed.augments, 'augments', filePath).map((item, index) => normalizeAugment(item, `${filePath}.augments[${index}]`)),
    suppresses: arrayField(parsed.suppresses, 'suppresses', filePath).map((item, index) => normalizeSuppress(item, `${filePath}.suppresses[${index}]`)),
    additions: Array.isArray(parsed.additions)
      ? parsed.additions.map((item) => normalizeDirective(item as Record<string, unknown>, 'local', filePath, 'local-addition'))
      : [],
  };
}

function normalizeDirective(
  input: Record<string, unknown>,
  layerId: string,
  filePath: string,
  kind: 'builtin' | 'local-addition',
): Directive {
  rejectConditionalBranching(input, filePath);
  const id = nonEmptyString(input.id, 'id', filePath);
  const type = enumValue(input.type, ['constraint', 'preference', 'convention', 'architecture', 'anti-pattern'] as const, 'type', filePath);
  const prescription = enumValue(input.prescription, ['must', 'should'] as const, 'prescription', filePath);
  const weight = enumValue(input.weight ?? 'normal', ['low', 'normal', 'high', 'critical'] as const, 'weight', filePath);
  const description = nonEmptyString(input.description, 'description', filePath);
  const rationale = nonEmptyString(input.rationale, 'rationale', filePath);
  const examples = normalizeExamples(input.examples, filePath);
  return {
    id,
    type: type as DirectiveType,
    layer: typeof input.layer === 'string' ? input.layer : layerId,
    scope: normalizeScope(input.scope),
    prescription: prescription as Prescription,
    weight: weight as Weight,
    description,
    rationale,
    exceptions: Array.isArray(input.exceptions) ? input.exceptions.map(String) : [],
    examples,
    rccl_immune: Boolean(input.rccl_immune),
    traits: normalizeTraits(input.traits),
    source: { kind, layerId, filePath },
  };
}

function normalizeScope(input: unknown): DirectiveScope {
  if (typeof input === 'string' && input.trim()) return { path: input.trim() };
  if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).path === 'string') {
    return { path: String((input as Record<string, unknown>).path) };
  }
  throw new Error('Invalid playbook directive scope: expected a non-empty path string or { path }.');
}

function normalizeExamples(input: unknown, location: string): DirectiveExample[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error(`Invalid playbook directive at ${location}: examples must be a non-empty array.`);
  return input.map((example, index) => {
    const item = assertRecord(example, `${location}.examples[${index}]`);
    if (typeof item.note !== 'string' || !item.note.trim()) throw new Error(`Invalid playbook directive at ${location}: every example requires a non-empty note.`);
    return {
      avoid: item.avoid && typeof item.avoid === 'object'
        ? { code: String((item.avoid as Record<string, unknown>).code ?? '') }
        : undefined,
      good: item.good && typeof item.good === 'object'
        ? { code: String((item.good as Record<string, unknown>).code ?? '') }
        : undefined,
      note: item.note.trim(),
    };
  });
}

export function assertUniqueDirectiveIds(directives: Directive[]): void {
  const seen = new Map<string, string>();
  for (const directive of directives) {
    const prior = seen.get(directive.id);
    if (prior) throw new Error(`Duplicate directive id "${directive.id}" in ${prior} and ${directive.source.filePath}.`);
    seen.set(directive.id, directive.source.filePath);
  }
}

export function validateLocalReferences(local: LocalPlaybook | null, builtins: Directive[]): void {
  if (!local) return;
  const byId = new Map(builtins.map((directive) => [directive.id, directive]));
  for (const override of local.overrides) {
    const target = byId.get(override.supersedes);
    if (!target) throw new Error(`Local override supersedes unknown directive "${override.supersedes}".`);
    if (override.scope && override.scope.path !== target.scope.path) {
      throw new Error(`Local override scope "${override.scope.path}" is incompatible with ${override.supersedes} scope "${target.scope.path}".`);
    }
  }
  for (const item of [...local.augments, ...local.suppresses]) {
    if (!byId.has(item.id)) throw new Error(`Local playbook references unknown directive "${item.id}".`);
  }
}

function normalizeOverride(value: unknown, location: string) {
  const item = assertRecord(value, location);
  if ('id' in item && !('supersedes' in item)) throw new Error(`Invalid local override at ${location}: use explicit supersedes instead of id.`);
  return {
    supersedes: nonEmptyString(item.supersedes, 'supersedes', location),
    ...(item.scope !== undefined ? { scope: normalizeScope(item.scope) } : {}),
    ...(item.prescription !== undefined ? { prescription: enumValue(item.prescription, ['must', 'should'] as const, 'prescription', location) } : {}),
    ...(item.weight !== undefined ? { weight: enumValue(item.weight, ['low', 'normal', 'high', 'critical'] as const, 'weight', location) } : {}),
    ...(item.rationale !== undefined ? { rationale: nonEmptyString(item.rationale, 'rationale', location) } : {}),
    ...(item.exceptions !== undefined ? { exceptions: stringArray(item.exceptions, 'exceptions', location) } : {}),
  };
}

function normalizeAugment(value: unknown, location: string) {
  const item = assertRecord(value, location);
  return { id: nonEmptyString(item.id, 'id', location), examples: normalizeExamples(item.examples, location) };
}

function normalizeSuppress(value: unknown, location: string) {
  const item = assertRecord(value, location);
  return { id: nonEmptyString(item.id, 'id', location), reason: nonEmptyString(item.reason, 'reason', location) };
}

function assertRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object at ${location}.`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string, location: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field} at ${location}: expected a non-empty string.`);
  return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string, location: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid ${field} at ${location}: expected one of ${allowed.join(', ')}.`);
  return value as T;
}

function stringArray(value: unknown, field: string, location: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`Invalid ${field} at ${location}: expected a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function arrayField(value: unknown, field: string, location: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid ${field} at ${location}: expected an array.`);
  return value;
}

function rejectConditionalBranching(input: Record<string, unknown>, location: string): void {
  for (const key of ['if', 'when', 'condition', 'conditions', 'then', 'else']) {
    if (key in input) throw new Error(`Invalid directive at ${location}: internal conditional branch "${key}" is not allowed.`);
  }
}

function normalizeTraits(input: unknown): DirectiveTraits | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const traits: DirectiveTraits = {
    safety_critical: booleanTrait(value.safety_critical),
    broad_scope: booleanTrait(value.broad_scope),
    compatibility_sensitive: booleanTrait(value.compatibility_sensitive),
    migration_sensitive: booleanTrait(value.migration_sensitive),
  };
  return Object.values(traits).some((item) => item !== undefined) ? traits : undefined;
}

function booleanTrait(input: unknown): boolean | undefined {
  return typeof input === 'boolean' ? input : undefined;
}
