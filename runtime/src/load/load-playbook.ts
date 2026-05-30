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
  return parsed.map((item) => normalizeDirective(item as Record<string, unknown>, layerId, filePath, 'builtin'));
}

/**
 * Loads the optional local playbook and normalizes all local sections.
 */
export function loadLocalPlaybook(filePath?: string): LocalPlaybook | null {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const meta = ((parsed.meta ?? {}) as Record<string, unknown>);
  return {
    version: String(parsed.version ?? '1.0'),
    meta: {
      name: typeof meta.name === 'string' ? meta.name : undefined,
      extends: Array.isArray(meta.extends) ? meta.extends.map(String) : [],
    },
    overrides: Array.isArray(parsed.overrides) ? parsed.overrides.map((item) => item as any) : [],
    augments: Array.isArray(parsed.augments) ? parsed.augments.map((item) => item as any) : [],
    suppresses: Array.isArray(parsed.suppresses) ? parsed.suppresses.map((item) => item as any) : [],
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
  return {
    id: String(input.id),
    type: String(input.type) as DirectiveType,
    layer: typeof input.layer === 'string' ? input.layer : layerId,
    scope: normalizeScope(input.scope),
    prescription: String(input.prescription) as Prescription,
    weight: (input.weight ?? 'normal') as Weight,
    description: String(input.description ?? ''),
    rationale: String(input.rationale ?? ''),
    exceptions: Array.isArray(input.exceptions) ? input.exceptions.map(String) : [],
    examples: normalizeExamples(input.examples),
    rccl_immune: Boolean(input.rccl_immune),
    traits: normalizeTraits(input.traits),
    source: { kind, layerId, filePath },
  };
}

function normalizeScope(input: unknown): DirectiveScope {
  if (typeof input === 'string') return { path: input };
  if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).path === 'string') {
    return { path: String((input as Record<string, unknown>).path) };
  }
  return { path: '**/*' };
}

function normalizeExamples(input: unknown): DirectiveExample[] {
  if (!Array.isArray(input)) return [];
  return input.map((example) => {
    const item = example as Record<string, unknown>;
    return {
      avoid: item.avoid && typeof item.avoid === 'object'
        ? { code: String((item.avoid as Record<string, unknown>).code ?? '') }
        : undefined,
      good: item.good && typeof item.good === 'object'
        ? { code: String((item.good as Record<string, unknown>).code ?? '') }
        : undefined,
      note: String(item.note ?? ''),
    };
  });
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
