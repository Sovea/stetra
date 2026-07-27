/** CLI-owned host-assisted Playbook bootstrap workflow. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import { inputError } from '../errors.ts';
import { parseArtifact } from '../validation.ts';

const DETERMINISTIC_DEFAULT_EXTENDS = [
  'builtin/core',
  'builtin/task-types/*',
];

const FALSEY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);
const REPO_SPECIFIC_LAYER_PATTERN = /^builtin\/(languages|frameworks|domains)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const CORE_FILE_NAME = 'core.yaml';

const LayerIdSchema = z.string().trim().regex(REPO_SPECIFIC_LAYER_PATTERN);
const InitCandidateSchema = z.strictObject({
  projectName: z.string().optional(),
  selectedLayers: z.array(LayerIdSchema),
  evidence: z.array(z.strictObject({
    layerId: LayerIdSchema,
    paths: z.array(z.string().trim().min(1)).min(1),
    rationale: z.string().optional(),
  })),
}).superRefine((candidate, context) => {
  const selected = new Set();
  for (const [index, layerId] of candidate.selectedLayers.entries()) {
    if (selected.has(layerId)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedLayers', index],
        message: `duplicate selected layer ${layerId}`,
      });
    }
    selected.add(layerId);
  }

  const evidence = new Set();
  for (const [index, entry] of candidate.evidence.entries()) {
    if (evidence.has(entry.layerId)) {
      context.addIssue({
        code: 'custom',
        path: ['evidence', index, 'layerId'],
        message: `duplicate evidence entry for ${entry.layerId}`,
      });
    }
    evidence.add(entry.layerId);
    if (!selected.has(entry.layerId)) {
      context.addIssue({
        code: 'custom',
        path: ['evidence', index, 'layerId'],
        message: `${entry.layerId} is not present in selectedLayers`,
      });
    }
  }
  for (const [index, layerId] of candidate.selectedLayers.entries()) {
    if (!evidence.has(layerId)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedLayers', index],
        message: `${layerId} is missing a corresponding evidence entry`,
      });
    }
  }
});
const INIT_CANDIDATE_SCHEMA = z.toJSONSchema(InitCandidateSchema);

function readJsonField(projectRoot, rel, field) {
  try {
    const data = JSON.parse(readFileSync(join(projectRoot, rel), 'utf-8'));
    return data[field];
  } catch {
    return undefined;
  }
}

function detectProjectName(projectRoot) {
  return (
    readJsonField(projectRoot, 'package.json', 'name')
    ?? resolve(projectRoot).split(/[\\/]/).at(-1)
    ?? 'my-project'
  );
}

function toCanonicalLayerId(builtinRoot, fullPath) {
  const rel = relative(builtinRoot, fullPath).replace(/\\/g, '/');
  const parts = rel.split('/');
  if (rel === CORE_FILE_NAME) return 'builtin/core';
  if (parts.at(-1) === CORE_FILE_NAME) return `builtin/${parts.slice(0, -1).join('/')}`;
  return `builtin/${rel.replace(/\.yaml$/, '')}`;
}

function discoverBuiltinLayers(builtinRoot) {
  const layers = new Set();

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.endsWith('.yaml')) continue;
      layers.add(toCanonicalLayerId(builtinRoot, fullPath));
    }
  }

  walk(builtinRoot);
  return layers;
}

function isRepoSpecificLayer(layerId) {
  return REPO_SPECIFIC_LAYER_PATTERN.test(layerId);
}

function writeContextArtifact(projectRoot, folder, extension, content, seed) {
  const digest = createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const filePath = join(projectRoot, '.resonant-code', 'context', folder, `${stamp}-${digest}.${extension}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function buildCandidatePath(projectRoot, repoSpecificKnownLayers) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      type: 'init-candidate',
      availableLayers: repoSpecificKnownLayers,
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'task-candidates', 'init', `${stamp}-${digest}.json`);
}

function buildInterpretationPrompt({ projectName, repoSpecificKnownLayers }) {
  const lines = [
    '# Init layer selection',
    '',
    'Select resonant-code playbook layers for local-augment generation.',
    '',
    'Constraints:',
    '- This is not a codebase wiki task.',
    '- Do not summarize the repository or describe architecture broadly.',
    '- Inspect the repository with your native tools; the CLI does not rank or preselect files.',
    '- Use exact repository-relative evidence paths that materially justify loading a playbook layer.',
    '- Prefer leaving a layer out over weak inference.',
    '- Do not infer from vague dependency presence alone.',
    '',
    'Deterministic defaults are already handled by commit-time assembly:',
    '- builtin/core',
    '- builtin/task-types/*',
    '',
    'Only decide repo-specific layers such as builtin/languages/*, builtin/frameworks/*, or builtin/domains/*.',
    '',
    `Default project name: ${projectName}`,
    '',
    'Installed repo-specific built-in layers:',
    ...(repoSpecificKnownLayers.length
      ? repoSpecificKnownLayers.map((layerId) => `- ${layerId}`)
      : ['- (none installed)']),
    '',
    'Return JSON only, matching the provided schema.',
    'For every selected layer, include a corresponding evidence entry with concrete repository paths you inspected.',
    'If repository evidence clearly points to a canonical repo-specific layer that is not installed yet, you may still include that canonical layer id; commit will mark it unavailable instead of loading it.',
  ];

  return lines.join('\n');
}

function shouldEmitDebugArtifacts(options = {}) {
  if (options.debugArtifacts !== undefined) return Boolean(options.debugArtifacts);
  const value = process.env.RESONANT_CODE_DEBUG_ARTIFACTS;
  if (!value) return false;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function normalizeCandidate(candidateInput, projectRoot) {
  const candidate = parseArtifact(
    InitCandidateSchema,
    candidateInput,
    'init candidate',
  );
  const projectName = typeof candidate.projectName === 'string' && candidate.projectName.trim()
    ? candidate.projectName.trim()
    : undefined;
  const selectedLayers = [...candidate.selectedLayers];
  const evidence = candidate.evidence.map((evidenceInput) => {
    const paths = evidenceInput.paths.map((item) => {
      return normalizeEvidencePath(projectRoot, item, evidenceInput.layerId);
    });
    return {
      layerId: evidenceInput.layerId,
      paths,
      rationale: typeof evidenceInput.rationale === 'string' && evidenceInput.rationale.trim()
        ? evidenceInput.rationale.trim()
        : undefined,
    };
  });

  return { projectName, selectedLayers, evidence };
}

function normalizeEvidencePath(projectRoot, value, layerId) {
  const supplied = value.trim().replace(/\\/g, '/');
  if (isAbsolute(supplied)) {
    throw new Error(`Evidence entry for ${layerId} must use repository-relative paths.`);
  }
  const target = resolve(projectRoot, supplied);
  const rel = relative(projectRoot, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Evidence entry for ${layerId} contains a path outside the repository: ${value}.`);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`Evidence entry for ${layerId} names a missing repository file: ${value}.`);
  }
  return rel.replace(/\\/g, '/');
}

function buildFinalExtends(repoSpecificIncluded) {
  return [
    DETERMINISTIC_DEFAULT_EXTENDS[0],
    ...repoSpecificIncluded,
    ...DETERMINISTIC_DEFAULT_EXTENDS.slice(1),
  ];
}

function generateLocalAugment(projectName, extendsEntries) {
  const extendsLines = extendsEntries.map((entry) => `    - "${entry}"`).join('\n');

  return `# .resonant-code/playbook/local-augment.yaml
# resonant-code · local playbook for this project
#
# This file selects built-in playbook layers for this repository and gives you a
# place to add project-specific overrides, augments, suppressions, and additions.
#
# resonant-code bootstrap accepts repo-specific layers only with concrete
# host-selected repository evidence. It does not summarize the repository.

version: "1.0"

meta:
  name: "${projectName}"
  extends:
${extendsLines}

# Override a built-in rule's prescription, weight, rationale, or exceptions.
# Every override must use \`supersedes: <directive-id>\`; duplicate ids are invalid.
# overrides: []

# Add examples to a built-in rule — the lowest-effort way to teach
# resonant-code what good and bad code looks like in this codebase.
# augments: []

# Disable a built-in rule that doesn't apply to this project.
# suppresses: []

# Add rules that don't exist in the built-in playbook.
# additions: []
`;
}

function buildSuccessMessage(result) {
  const lines = [
    'Created .resonant-code/playbook/local-augment.yaml',
    '',
    'Built-in layers loaded:',
    ...result.extends.final.map((layerId) => `  - ${layerId}`),
    '',
    'Host-selected repository evidence:',
  ];

  if (result.evidence.length === 0) {
    lines.push('  - none');
  } else {
    for (const evidence of result.evidence) {
      lines.push(`  - ${evidence.layerId}`);
      for (const path of evidence.paths) {
        lines.push(`      path: ${path}`);
      }
      if (evidence.rationale) {
        lines.push(`      rationale: ${evidence.rationale}`);
      }
    }
  }

  if (result.extends.unavailable.length > 0) {
    lines.push('', 'Selected repository evidence has no built-in layer available yet:');
    for (const layerId of result.extends.unavailable) {
      lines.push(`  - ${layerId}`);
    }
    lines.push('These can be supported in a future resonant-code release.');
  }

  lines.push(
    '',
    'Next steps:',
    '  - Run resonant-code context prepare to calibrate decision-relevant RCCL observations.',
    '  - Review .resonant-code/playbook/local-augment.yaml and rename meta.name if needed.',
    '  - Commit .resonant-code/playbook/local-augment.yaml to share with your team.',
  );

  return lines.join('\n');
}

function readCandidateInput(input) {
  try {
    return input === '-'
      ? JSON.parse(readFileSync(0, 'utf-8'))
      : JSON.parse(readFileSync(input, 'utf-8'));
  } catch (error) {
    const source = input === '-' ? 'stdin' : input;
    throw inputError(
      `Failed to read init candidate JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

function buildDebugArtifacts(projectRoot, prompt, projectName, repoSpecificKnownLayers, enabled) {
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    promptPath: writeContextArtifact(
      projectRoot,
      'init-prompts',
      'md',
      prompt,
      {
        kind: 'init-prompt',
        projectName,
        repoSpecificKnownLayers,
      },
    ),
  };
}

function buildCandidateArtifact(projectRoot, repoSpecificKnownLayers) {
  const candidatePath = buildCandidatePath(projectRoot, repoSpecificKnownLayers);
  return {
    suggestedPath: candidatePath,
    format: 'json',
    usage: `Write a single init candidate JSON object to ${candidatePath}, then run commit with --input ${candidatePath}. You can also pass --input - and provide the same JSON via stdin.`,
  };
}

export function prepareInit(options) {
  const projectRoot = resolve(options.projectRoot ?? '.');
  const builtinRoot = resolve(options.builtinRoot);

  if (!builtinRoot || !existsSync(builtinRoot)) {
    throw new Error(`Built-in playbook root not found: ${builtinRoot}`);
  }

  const knownLayers = discoverBuiltinLayers(builtinRoot);
  const repoSpecificKnownLayers = [...knownLayers].filter(isRepoSpecificLayer).sort();
  const projectName = detectProjectName(projectRoot);
  const prompt = buildInterpretationPrompt({ projectName, repoSpecificKnownLayers });
  const debugArtifacts = buildDebugArtifacts(
    projectRoot,
    prompt,
    projectName,
    repoSpecificKnownLayers,
    shouldEmitDebugArtifacts(options),
  );

  return {
    status: 'prepared',
    prompt,
    candidateSchema: JSON.stringify(INIT_CANDIDATE_SCHEMA, null, 2),
    candidateArtifact: buildCandidateArtifact(projectRoot, repoSpecificKnownLayers),
    projectNameDefault: projectName,
    defaults: {
      extends: DETERMINISTIC_DEFAULT_EXTENDS,
    },
    availableLayers: {
      repoSpecific: repoSpecificKnownLayers,
    },
    augment: {
      path: '.resonant-code/playbook/local-augment.yaml',
      exists: existsSync(join(projectRoot, '.resonant-code', 'playbook', 'local-augment.yaml')),
    },
    debugArtifacts,
  };
}

export function commitInit(options) {
  const projectRoot = resolve(options.projectRoot ?? '.');
  const builtinRoot = resolve(options.builtinRoot);
  const candidateInput = options.input === '-' ? '-' : options.input ? resolve(options.input) : null;
  const force = Boolean(options.force);

  if (!builtinRoot || !existsSync(builtinRoot)) {
    throw new Error(`Built-in playbook root not found: ${builtinRoot}`);
  }
  if (!candidateInput) {
    throw new Error('Commit requires --input <path-to-candidate-json> or --input -.');
  }

  const debugArtifacts = { enabled: shouldEmitDebugArtifacts(options) };
  const input = {
    source: candidateInput === '-' ? 'stdin' : candidateInput,
    supportsStdin: true,
  };

  const playbookDir = join(projectRoot, '.resonant-code', 'playbook');
  const augmentFile = join(playbookDir, 'local-augment.yaml');
  if (!force && existsSync(augmentFile)) {
    return {
      status: 'exists',
      augmentPath: '.resonant-code/playbook/local-augment.yaml',
      message: '.resonant-code/playbook/local-augment.yaml already exists. Re-run commit with --force to overwrite it.',
      input,
      debugArtifacts,
    };
  }

  const candidate = normalizeCandidate(readCandidateInput(candidateInput), projectRoot);
  const knownLayers = discoverBuiltinLayers(builtinRoot);
  const included = candidate.selectedLayers.filter((layerId) => knownLayers.has(layerId));
  const unavailable = candidate.selectedLayers.filter((layerId) => !knownLayers.has(layerId));
  const finalExtends = buildFinalExtends(included);
  const projectName = candidate.projectName ?? detectProjectName(projectRoot);

  mkdirSync(playbookDir, { recursive: true });
  writeFileSync(augmentFile, generateLocalAugment(projectName, finalExtends), 'utf-8');

  const result = {
    status: 'created',
    projectName,
    extends: {
      defaults: DETERMINISTIC_DEFAULT_EXTENDS,
      included,
      unavailable,
      final: finalExtends,
    },
    evidence: candidate.evidence,
    augmentPath: '.resonant-code/playbook/local-augment.yaml',
    input,
    debugArtifacts,
  };

  return {
    ...result,
    message: buildSuccessMessage(result),
  };
}
