/** Safe generated-adapter planning, ownership, drift inspection, and writes. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  ADAPTER_PROTOCOL_VERSION,
  compareSemanticVersions,
  MANIFEST_SCHEMA_VERSION,
  PRODUCT_VERSION,
} from '../version.ts';
import {
  HOST_WORKFLOW_REFERENCES,
  renderClaudeChallengerAgent,
  renderCodexChallengerAgent,
  renderHostPointerBlock,
  renderHostSkill,
  renderHostWorkflowReference,
  type HostAdapter,
} from '../adapters/templates.ts';
import { inputError } from '../errors.ts';
import {
  DELEGATION_PROTOCOL,
} from '../protocol.ts';
import { findLegacyArtifacts } from './legacy.ts';
import {
  HostAdapterSchema,
  ProjectManifestSchema,
  type ManifestArtifact,
  type ProjectManifest,
} from '../schemas/project.ts';
import { parseArtifact } from '../validation.ts';

export type { HostAdapter } from '../adapters/templates.ts';

type ArtifactKind = 'file' | 'managed-block';

interface DesiredArtifact {
  path: string;
  kind: ArtifactKind;
  templateRevision: number;
  content: string;
  markers?: {
    start: string;
    end: string;
  };
}

interface PlannedWrite {
  artifact: DesiredArtifact;
  action: 'create' | 'upgrade' | 'force' | 'unchanged' | 'blocked';
  nextContent?: string;
  reason?: string;
}

export interface InitializeProjectOptions {
  projectRoot?: string;
  adapters?: HostAdapter[];
  force?: boolean;
  dryRun?: boolean;
}

const MANIFEST_PATH = '.stetra/manifest.json';
const TEMPLATE_REVISION = 4;
const DOC_MARKERS = {
  start: '<!-- stetra:begin -->',
  end: '<!-- stetra:end -->',
};
const GITIGNORE_MARKERS = {
  start: '# stetra:begin',
  end: '# stetra:end',
};

export function initializeProject(options: InitializeProjectOptions = {}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot ?? '.');
  const legacyArtifacts = findLegacyArtifacts(projectRoot);
  if (legacyArtifacts.length) {
    return {
      status: 'blocked',
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      projectRoot,
      manifestPath: join(projectRoot, MANIFEST_PATH),
      generatorVersion: PRODUCT_VERSION,
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      adapters: [],
      dryRun: Boolean(options.dryRun),
      force: Boolean(options.force),
      counts: { create: 0, upgrade: 0, force: 0, unchanged: 0, blocked: legacyArtifacts.length },
      artifacts: legacyArtifacts.map((path) => ({
        path,
        kind: 'legacy',
        action: 'blocked',
        reason: 'Archive or remove this legacy artifact explicitly; clean-break initialization never migrates or deletes it.',
      })),
      readiness: {
        required: [{
          code: 'legacy-artifacts-present',
          message: `Archive or remove legacy artifacts explicitly: ${legacyArtifacts.join(', ')}.`,
        }],
        recommended: [],
        optional: [],
      },
    };
  }
  const existingManifest = readManifest(projectRoot);
  const requestedAdapters = options.adapters?.length
    ? normalizeAdapters(options.adapters)
    : existingManifest
      ? []
      : (['codex', 'claude'] satisfies HostAdapter[]);
  const adapters = normalizeAdapters([
    ...(existingManifest?.adapters ?? []),
    ...requestedAdapters,
  ]);
  const desiredArtifacts = buildDesiredArtifacts(adapters);
  validateTrackedArtifacts(existingManifest, desiredArtifacts);

  const priorByKey = new Map(
    (existingManifest?.artifacts ?? []).map((artifact) => [
      artifactKey(artifact),
      artifact,
    ]),
  );
  const plan = desiredArtifacts.map((artifact) =>
    planArtifact(
      projectRoot,
      artifact,
      priorByKey.get(artifactKey(artifact)),
      Boolean(options.force),
    ));
  const blocked = plan.filter((item) => item.action === 'blocked');
  const manifest = buildManifest(adapters, desiredArtifacts);

  if (!blocked.length && !options.dryRun) {
    for (const item of plan) {
      if (item.action === 'unchanged' || item.nextContent === undefined) continue;
      writeProjectFile(projectRoot, item.artifact.path, item.nextContent);
    }
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    const currentManifestPath = projectPath(projectRoot, MANIFEST_PATH);
    if (!existsSync(currentManifestPath)
      || readFileSync(currentManifestPath, 'utf8') !== manifestContent) {
      writeProjectFile(projectRoot, MANIFEST_PATH, manifestContent);
    }
  }

  const counts = countActions(plan);
  const required: Array<{ code: string; message: string }> = [];
  const recommended: Array<{ code: string; message: string }> = [];
  const optional: Array<{ code: string; message: string }> = [];
  return {
    status: blocked.length ? 'blocked' : options.dryRun ? 'planned' : 'initialized',
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    projectRoot,
    manifestPath: join(projectRoot, MANIFEST_PATH),
    generatorVersion: PRODUCT_VERSION,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    adapters,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    counts,
    artifacts: plan.map((item) => ({
      path: item.artifact.path,
      kind: item.artifact.kind,
      action: item.action,
      ...(item.reason ? { reason: item.reason } : {}),
    })),
    readiness: {
      required,
      recommended,
      optional,
    },
  };
}

export function inspectProjectInstallation(projectRootInput = '.') {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const legacyArtifacts = findLegacyArtifacts(projectRoot);
  if (legacyArtifacts.length) {
    return {
      status: 'legacy',
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      projectRoot,
      manifestPath: join(projectRoot, MANIFEST_PATH),
      adapters: [],
      artifacts: legacyArtifacts.map((path) => ({ path, status: 'legacy' as const })),
      legacyArtifacts,
    };
  }
  const manifest = readManifest(projectRoot);
  if (!manifest) {
    return {
      status: 'absent',
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      projectRoot,
      manifestPath: join(projectRoot, MANIFEST_PATH),
      adapters: [],
      artifacts: [],
    };
  }

  const desiredArtifacts = buildDesiredArtifacts(manifest.adapters);
  const priorByKey = new Map(
    manifest.artifacts.map((artifact) => [artifactKey(artifact), artifact]),
  );
  const artifacts: Array<ManifestArtifact & {
    status: 'current' | 'missing' | 'modified' | 'outdated' | 'unsupported';
  }> = desiredArtifacts.map((desired) => {
    const prior = priorByKey.get(artifactKey(desired));
    if (!prior) {
      return {
        path: desired.path,
        kind: desired.kind,
        templateRevision: desired.templateRevision,
        generatedHash: sha256(desired.content),
        status: 'missing' as const,
      };
    }
    const target = projectPath(projectRoot, desired.path);
    assertNoSymlinkTraversal(projectRoot, desired.path);
    if (!existsSync(target)) {
      return { ...prior, status: 'missing' as const };
    }
    const current = readFileSync(target, 'utf8');
    const generatedContent = desired.kind === 'file'
      ? current
      : extractManagedBlock(current, desired.markers!, desired.path, true);
    if (generatedContent === null) {
      return { ...prior, status: 'missing' as const };
    }
    const currentHash = sha256(generatedContent);
    const desiredHash = sha256(desired.content);
    return {
      ...prior,
      status: currentHash === desiredHash
        ? 'current' as const
        : currentHash === prior.generatedHash
          ? 'outdated' as const
          : 'modified' as const,
    };
  });
  const desiredKeys = new Set(desiredArtifacts.map(artifactKey));
  for (const artifact of manifest.artifacts) {
    if (!desiredKeys.has(artifactKey(artifact))) {
      artifacts.push({ ...artifact, status: 'unsupported' as const });
    }
  }
  const drifted = artifacts.some((artifact) => artifact.status !== 'current');
  const versionStatus = manifest.generatorVersion === PRODUCT_VERSION
    ? 'current'
    : 'different';

  return {
    status: drifted ? 'drifted' : versionStatus === 'different' ? 'version-drift' : 'current',
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    projectRoot,
    manifestPath: join(projectRoot, MANIFEST_PATH),
    generatorVersion: manifest.generatorVersion,
    adapterProtocolVersion: manifest.adapterProtocolVersion,
    versionStatus,
    adapters: manifest.adapters,
    artifacts,
  };
}

function buildDesiredArtifacts(adapters: HostAdapter[]): DesiredArtifact[] {
  const artifacts: DesiredArtifact[] = [{
    path: '.gitignore',
    kind: 'managed-block',
    templateRevision: TEMPLATE_REVISION,
    markers: GITIGNORE_MARKERS,
    content: [
      GITIGNORE_MARKERS.start,
      '.stetra/tasks/',
      GITIGNORE_MARKERS.end,
    ].join('\n'),
  }];

  for (const adapter of adapters) {
    const skillRoot = adapter === 'codex'
      ? '.agents/skills/stetra'
      : '.claude/skills/stetra';
    artifacts.push({
      path: `${skillRoot}/SKILL.md`,
      kind: 'file',
      templateRevision: TEMPLATE_REVISION,
      content: renderHostSkill(adapter),
    });
    artifacts.push({
      path: adapter === 'codex'
        ? '.codex/agents/stetra-challenger.toml'
        : '.claude/agents/stetra-challenger.md',
      kind: 'file',
      templateRevision: TEMPLATE_REVISION,
      content: adapter === 'codex'
        ? renderCodexChallengerAgent()
        : renderClaudeChallengerAgent(),
    });
    for (const workflow of HOST_WORKFLOW_REFERENCES) {
      artifacts.push({
        path: `${skillRoot}/references/${workflow}.md`,
        kind: 'file',
        templateRevision: TEMPLATE_REVISION,
        content: renderHostWorkflowReference(adapter, workflow),
      });
    }
    artifacts.push({
      path: adapter === 'codex' ? 'AGENTS.md' : 'CLAUDE.md',
      kind: 'managed-block',
      templateRevision: TEMPLATE_REVISION,
      markers: DOC_MARKERS,
      content: renderHostPointerBlock(adapter, DOC_MARKERS),
    });
  }

  return artifacts.sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
}

function planArtifact(
  projectRoot: string,
  artifact: DesiredArtifact,
  prior: ManifestArtifact | undefined,
  force: boolean,
): PlannedWrite {
  const target = projectPath(projectRoot, artifact.path);
  assertNoSymlinkTraversal(projectRoot, artifact.path);
  if (!existsSync(target)) {
    const nextContent = artifact.kind === 'file'
      ? artifact.content
      : `${artifact.content}\n`;
    return { artifact, action: 'create', nextContent };
  }
  if (!lstatSync(target).isFile()) {
    return {
      artifact,
      action: 'blocked',
      reason: 'The managed path exists but is not a regular file.',
    };
  }

  const current = readFileSync(target, 'utf8');
  if (artifact.kind === 'file') {
    if (canonicalGeneratedContent(current) === canonicalGeneratedContent(artifact.content)) {
      return { artifact, action: 'unchanged' };
    }
    const owned = prior?.generatedHash === sha256(current);
    if (owned) return { artifact, action: 'upgrade', nextContent: artifact.content };
    if (force) return { artifact, action: 'force', nextContent: artifact.content };
    return {
      artifact,
      action: 'blocked',
      reason: 'The generated adapter file was modified outside stetra; use --force to replace this managed file.',
    };
  }

  const markers = artifact.markers!;
  const currentBlock = extractManagedBlock(current, markers, artifact.path, true);
  if (currentBlock === null) {
    return {
      artifact,
      action: 'create',
      nextContent: upsertManagedBlock(current, artifact.content, markers, artifact.path),
    };
  }
  if (canonicalGeneratedContent(currentBlock) === canonicalGeneratedContent(artifact.content)) {
    return { artifact, action: 'unchanged' };
  }
  const owned = prior?.generatedHash === sha256(currentBlock);
  if (owned) {
    return {
      artifact,
      action: 'upgrade',
      nextContent: upsertManagedBlock(current, artifact.content, markers, artifact.path),
    };
  }
  if (force) {
    return {
      artifact,
      action: 'force',
      nextContent: upsertManagedBlock(current, artifact.content, markers, artifact.path),
    };
  }
  return {
    artifact,
    action: 'blocked',
    reason: 'The stetra managed block was modified; use --force to replace only that block.',
  };
}

function buildManifest(
  adapters: HostAdapter[],
  artifacts: DesiredArtifact[],
): ProjectManifest {
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatorVersion: PRODUCT_VERSION,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    adapters,
    artifacts: artifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      templateRevision: artifact.templateRevision,
      generatedHash: sha256(artifact.content),
    })),
  };
}

function readManifest(projectRoot: string): ProjectManifest | null {
  assertNoSymlinkTraversal(projectRoot, MANIFEST_PATH);
  const path = projectPath(projectRoot, MANIFEST_PATH);
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError(
      `Failed to parse ${MANIFEST_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('protocol' in value)
    || value.protocol !== DELEGATION_PROTOCOL
    || !('schemaVersion' in value)
    || value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `UNSUPPORTED_SCHEMA_VERSION: ${MANIFEST_PATH} must use ${MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  const manifest = parseArtifact(
    ProjectManifestSchema,
    value,
    MANIFEST_PATH,
  );
  if (manifest.adapterProtocolVersion !== ADAPTER_PROTOCOL_VERSION) {
    throw new Error(
      `UNSUPPORTED_ADAPTER_PROTOCOL: ${MANIFEST_PATH} requires ${manifest.adapterProtocolVersion}; this CLI supports ${ADAPTER_PROTOCOL_VERSION}.`,
    );
  }
  if (compareSemanticVersions(manifest.generatorVersion, PRODUCT_VERSION) > 0) {
    throw new Error(
      `UNSUPPORTED_GENERATOR_VERSION: ${MANIFEST_PATH} was written by newer CLI ${manifest.generatorVersion}; installed CLI is ${PRODUCT_VERSION}.`,
    );
  }
  const artifacts: ManifestArtifact[] = manifest.artifacts.map((artifact, index) => {
    if (artifact.templateRevision > TEMPLATE_REVISION) {
      throw new Error(`${MANIFEST_PATH} artifact ${index} is invalid.`);
    }
    return artifact;
  });
  return {
    protocol: manifest.protocol,
    schemaVersion: manifest.schemaVersion,
    generatorVersion: manifest.generatorVersion,
    adapterProtocolVersion: manifest.adapterProtocolVersion,
    adapters: manifest.adapters,
    artifacts,
  };
}

function validateTrackedArtifacts(
  manifest: ProjectManifest | null,
  desired: DesiredArtifact[],
): void {
  if (!manifest) return;
  const desiredKeys = new Set(desired.map(artifactKey));
  const unsupported = manifest.artifacts.filter((artifact) =>
    !desiredKeys.has(artifactKey(artifact)));
  if (unsupported.length) {
    throw new Error(
      `The project manifest tracks unsupported artifact(s): ${unsupported.map((item) => item.path).join(', ')}.`,
    );
  }
}

function upsertManagedBlock(
  source: string,
  block: string,
  markers: { start: string; end: string },
  path: string,
): string {
  const range = managedBlockRange(source, markers, path);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const renderedBlock = artifactNewlines(block, newline);
  if (range) {
    return `${source.slice(0, range.start)}${renderedBlock}${source.slice(range.end)}`;
  }
  if (!source) return `${renderedBlock}${newline}`;
  const separator = source.endsWith(`${newline}${newline}`)
    ? ''
    : source.endsWith(newline)
      ? newline
      : `${newline}${newline}`;
  return `${source}${separator}${renderedBlock}${newline}`;
}

function extractManagedBlock(
  source: string,
  markers: { start: string; end: string },
  path: string,
  allowMissing = false,
): string | null {
  const range = managedBlockRange(source, markers, path);
  if (!range) {
    if (allowMissing) return null;
    throw new Error(`Managed block is missing from ${path}.`);
  }
  return source.slice(range.start, range.end);
}

function managedBlockRange(
  source: string,
  markers: { start: string; end: string },
  path: string,
): { start: number; end: number } | null {
  const starts = indexesOf(source, markers.start);
  const ends = indexesOf(source, markers.end);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error(`Managed block markers are malformed in ${path}.`);
  }
  const end = ends[0] + markers.end.length;
  return { start: starts[0], end };
}

function indexesOf(source: string, needle: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(needle, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

function normalizeAdapters(adapters: HostAdapter[] | undefined): HostAdapter[] {
  const input: HostAdapter[] = adapters?.length ? adapters : ['codex', 'claude'];
  for (const adapter of input) {
    if (!HostAdapterSchema.safeParse(adapter).success) {
      throw new Error(`Unsupported adapter: ${String(adapter)}. Expected codex or claude.`);
    }
  }
  return [...new Set(input)].sort();
}

function canonicalProjectRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not a directory: ${root}`);
  }
  return realpathSync(root);
}

function projectPath(projectRoot: string, relativePath: string): string {
  const target = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe managed path: ${relativePath}`);
  }
  return target;
}

function assertNoSymlinkTraversal(projectRoot: string, relativePath: string): void {
  const parts = relativePath.split('/').filter(Boolean);
  let current = projectRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to manage a path through a symbolic link: ${relativePath}`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`Refusing to manage ${relativePath}: ${parts.slice(0, index + 1).join('/')} is not a directory.`);
    }
  }
}

function writeProjectFile(projectRoot: string, relativePath: string, content: string): void {
  assertNoSymlinkTraversal(projectRoot, relativePath);
  const target = projectPath(projectRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  const mode = existsSync(target) ? statSync(target).mode : 0o644;
  writeFileSync(temporary, content, { encoding: 'utf8', mode });
  try {
    renameSync(temporary, target);
  } catch (error) {
    if (!existsSync(target)) {
      rmSync(temporary, { force: true });
      throw error;
    }
    const backup = `${target}.backup-${process.pid}`;
    renameSync(target, backup);
    try {
      renameSync(temporary, target);
    } catch (replacementError) {
      if (!existsSync(target)) renameSync(backup, target);
      rmSync(temporary, { force: true });
      throw replacementError;
    }
    rmSync(backup, { force: true });
  }
}

function artifactKey(artifact: Pick<ManifestArtifact, 'path' | 'kind'>): string {
  return `${artifact.kind}:${artifact.path}`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(canonicalGeneratedContent(value)).digest('hex')}`;
}

function canonicalGeneratedContent(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function artifactNewlines(value: string, newline: string): string {
  return canonicalGeneratedContent(value).replace(/\n/g, newline);
}

function countActions(plan: PlannedWrite[]) {
  return Object.fromEntries(
    ['create', 'upgrade', 'force', 'unchanged', 'blocked']
      .map((action) => [
        action,
        plan.filter((item) => item.action === action).length,
      ]),
  );
}
