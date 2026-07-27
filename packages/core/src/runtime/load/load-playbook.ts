import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseYaml } from '../utils/yaml.ts';
import type {
  Directive,
  DirectiveExample,
  DirectiveScope,
  DirectiveTraits,
  DirectiveType,
  LocalPlaybook,
  PersonalPlaybook,
  Prescription,
  Weight,
} from '../types.ts';

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
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${filePath} does not match the current local Playbook schema. Re-run init; existing data was not modified.`);
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

/**
 * Loads a user-scoped overlay. Its schema deliberately excludes team-policy
 * operations: a personal overlay may add optional taste or examples, but may
 * not override, suppress, or create hard policy.
 */
export function loadPersonalPlaybook(filePath?: string): PersonalPlaybook | null {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = assertRecord(parseYaml(readFileSync(filePath, 'utf-8')), filePath);
  assertAllowedFields(parsed, ['version', 'meta', 'augments', 'additions'], filePath);
  if (parsed.version !== 1 && parsed.version !== '1.0') {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${filePath} does not match the current personal Playbook schema.`);
  }
  const meta = assertRecord(parsed.meta ?? {}, `${filePath}.meta`);
  assertAllowedFields(meta, ['name'], `${filePath}.meta`);
  if (meta.name !== undefined && (typeof meta.name !== 'string' || !meta.name.trim())) {
    throw new Error(`Invalid personal Playbook at ${filePath}.meta: name must be a non-empty string.`);
  }
  const additions = arrayField(parsed.additions, 'additions', filePath)
    .map((value, index) => {
      const location = `${filePath}.additions[${index}]`;
      const item = assertRecord(value, location);
      if ('weight' in item) {
        throw new Error(`Invalid personal directive at ${location}: weight is not accepted because personal additions are optional and are not score-ranked.`);
      }
      const directive = normalizeDirective(item, 'personal', filePath, 'personal-addition');
      if (!directive.id.startsWith('personal-')) {
        throw new Error(`Invalid personal directive "${directive.id}": id must start with personal-.`);
      }
      if (directive.prescription !== 'should') {
        throw new Error(`Invalid personal directive "${directive.id}": prescription must be should.`);
      }
      if (!['preference', 'convention', 'architecture'].includes(directive.type)) {
        throw new Error(`Invalid personal directive "${directive.id}": type must be preference, convention, or architecture.`);
      }
      if (directive.rccl_immune) {
        throw new Error(`Invalid personal directive "${directive.id}": personal guidance cannot be RCCL-immune.`);
      }
      return directive;
    });
  return {
    version: '1.0',
    meta: {
      name: typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : undefined,
    },
    augments: arrayField(parsed.augments, 'augments', filePath)
      .map((item, index) => normalizeAugment(item, `${filePath}.augments[${index}]`)),
    additions,
  };
}

function normalizeDirective(
  input: Record<string, unknown>,
  layerId: string,
  filePath: string,
  kind: 'builtin' | 'local-addition' | 'personal-addition',
): Directive {
  rejectConditionalBranching(input, filePath);
  const id = nonEmptyString(input.id, 'id', filePath);
  const type = enumValue(input.type, ['constraint', 'preference', 'convention', 'architecture', 'anti-pattern'] as const, 'type', filePath);
  const layer = nonEmptyString(input.layer, 'layer', filePath);
  validateDeclaredLayer(layer, layerId, kind, filePath);
  const prescription = enumValue(input.prescription, ['must', 'should'] as const, 'prescription', filePath);
  const weight = enumValue(input.weight ?? 'normal', ['low', 'normal', 'high', 'critical'] as const, 'weight', filePath);
  const description = nonEmptyString(input.description, 'description', filePath);
  const rationale = nonEmptyString(input.rationale, 'rationale', filePath);
  const examples = normalizeExamples(input.examples, filePath);
  return {
    id,
    type: type as DirectiveType,
    layer,
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

export function validatePersonalReferences(
  personal: PersonalPlaybook | null,
  teamAvailable: Directive[],
): void {
  if (!personal) return;
  const byId = new Map(teamAvailable.map((directive) => [directive.id, directive]));
  for (const augment of personal.augments) {
    if (!byId.has(augment.id)) {
      throw new Error(`Personal playbook augments unknown team/built-in directive "${augment.id}".`);
    }
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

function validateDeclaredLayer(
  declared: string,
  sourceLayerId: string,
  kind: 'builtin' | 'local-addition' | 'personal-addition',
  location: string,
): void {
  if (kind === 'local-addition') {
    if (!declared.startsWith('local')) throw new Error(`Invalid layer at ${location}: local additions must use a local layer.`);
    return;
  }
  if (kind === 'personal-addition') {
    if (!declared.startsWith('personal')) throw new Error(`Invalid layer at ${location}: personal additions must use a personal layer.`);
    return;
  }
  const expected = sourceLayerId === 'builtin/core' ? 'core' : sourceLayerId.split('/')[1];
  if (declared !== expected) {
    throw new Error(`Invalid layer at ${location}: declared ${declared}, but the physical source belongs to ${expected}.`);
  }
}

function booleanTrait(input: unknown): boolean | undefined {
  return typeof input === 'boolean' ? input : undefined;
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: string[],
  location: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`Invalid personal Playbook at ${location}: unsupported field(s) ${unknown.join(', ')}.`);
  }
}
