import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITIGNORE_BLOCK_START = '# resonant-code: generated runtime artifacts';
const GITIGNORE_BLOCK_END = '# .resonant-code/';
const GENERATED_GITIGNORE_RULES = [
  '.resonant-code/context/',
];

const DETERMINISTIC_DEFAULT_EXTENDS = [
  'builtin/core',
  'builtin/task-types/*',
];

const STRONG_SIGNAL_FILE_NAMES = new Set([
  'Cargo.toml',
  'angular.json',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'gradlew',
  'manage.py',
  'mvnw',
  'nest-cli.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.js',
  'nuxt.config.ts',
  'package.json',
  'pom.xml',
  'pyproject.toml',
  'remix.config.js',
  'remix.config.ts',
  'setup.cfg',
  'setup.py',
  'svelte.config.js',
  'svelte.config.ts',
  'tsconfig.app.json',
  'tsconfig.build.json',
  'tsconfig.json',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
]);

const IGNORED_SIGNAL_DIRECTORIES = new Set([
  '.claude',
  '.git',
  '.resonant-code',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const FALSEY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);
const REPO_SPECIFIC_LAYER_PATTERN = /^builtin\/(languages|frameworks|domains)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const CORE_FILE_NAME = 'core.yaml';

const INIT_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectName: { type: 'string' },
    selectedLayers: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^builtin\\/(languages|frameworks|domains)\\/[a-z0-9-]+(?:\\/[a-z0-9-]+)*$',
      },
    },
    signals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          layerId: {
            type: 'string',
            pattern: '^builtin\\/(languages|frameworks|domains)\\/[a-z0-9-]+(?:\\/[a-z0-9-]+)*$',
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
          },
          rationale: { type: 'string' },
        },
        required: ['layerId', 'evidence'],
      },
    },
  },
  required: ['selectedLayers', 'signals'],
};

const args = process.argv.slice(2);

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function ensureRuntimeArtifactsIgnored(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const managedBlock = [
    GITIGNORE_BLOCK_START,
    ...GENERATED_GITIGNORE_RULES,
    GITIGNORE_BLOCK_END,
  ].join('\n');

  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf-8').replace(/\r\n/g, '\n')
    : '';

  const blockPattern = new RegExp(
    `${escapeForRegex(GITIGNORE_BLOCK_START)}[\\s\\S]*?${escapeForRegex(GITIGNORE_BLOCK_END)}\\n?`,
    'g',
  );
  const withoutManagedBlock = existing.replace(blockPattern, '').trimEnd();
  const next = withoutManagedBlock
    ? `${withoutManagedBlock}\n\n${managedBlock}\n`
    : `${managedBlock}\n`;

  writeFileSync(gitignorePath, next, 'utf-8');
  return relative(projectRoot, gitignorePath).replace(/\\/g, '/');
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

function describeSignalFile(name) {
  if (name.startsWith('tsconfig')) return 'TypeScript configuration file';
  if (name === 'package.json') return 'Node package manifest';
  if (name === 'Cargo.toml') return 'Rust package manifest';
  if (name === 'go.mod') return 'Go module manifest';
  if (name === 'pyproject.toml' || name === 'setup.py' || name === 'setup.cfg') return 'Python project manifest';
  if (name === 'build.gradle' || name === 'build.gradle.kts' || name === 'pom.xml') return 'Java build manifest';
  if (name === 'next.config.js' || name === 'next.config.mjs' || name === 'next.config.ts') return 'Next.js configuration file';
  if (name === 'nuxt.config.js' || name === 'nuxt.config.ts') return 'Nuxt configuration file';
  if (name === 'remix.config.js' || name === 'remix.config.ts') return 'Remix configuration file';
  if (name === 'svelte.config.js' || name === 'svelte.config.ts') return 'Svelte configuration file';
  if (name === 'vite.config.js' || name === 'vite.config.mjs' || name === 'vite.config.ts') return 'Vite configuration file';
  if (name === 'angular.json') return 'Angular workspace configuration';
  if (name === 'nest-cli.json') return 'NestJS CLI configuration';
  if (name === 'manage.py') return 'Django management entrypoint';
  if (name === 'gradlew' || name === 'mvnw') return 'Java framework wrapper script';
  return 'Explicit strong-signal file';
}

function collectStrongSignalFiles(projectRoot, limit = 40) {
  const results = [];

  function walk(dir) {
    if (results.length >= limit) return;

    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (results.length >= limit) return;

      const fullPath = join(dir, entry.name);
      const relPath = relative(projectRoot, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (IGNORED_SIGNAL_DIRECTORIES.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!STRONG_SIGNAL_FILE_NAMES.has(entry.name)) continue;
      results.push({
        path: relPath,
        reason: describeSignalFile(entry.name),
      });
    }
  }

  walk(projectRoot);
  return results;
}

function writeContextArtifact(projectRoot, folder, extension, content, seed) {
  const digest = createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const filePath = join(projectRoot, '.resonant-code', 'context', folder, `${stamp}-${digest}.${extension}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function buildCandidatePath(projectRoot, signalFiles) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      type: 'init-candidate',
      signals: signalFiles.map((signal) => signal.path),
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'task-candidates', 'init', `${stamp}-${digest}.json`);
}

function buildInterpretationPrompt({ projectName, repoSpecificKnownLayers, signalFiles }) {
  const lines = [
    '# Init layer selection',
    '',
    'Select resonant-code playbook layers for local-augment generation.',
    '',
    'Constraints:',
    '- This is not a codebase wiki task.',
    '- Do not summarize the repository or describe architecture broadly.',
    '- Use only explicit strong signals that materially justify loading a playbook layer.',
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
    'Explicit strong-signal files found:',
    ...(signalFiles.length
      ? signalFiles.map((signal) => `- ${signal.path} — ${signal.reason}`)
      : ['- (none found)']),
    '',
    'Return JSON only, matching the provided schema.',
    'For every selected layer, include a corresponding signals entry with concrete evidence paths.',
    'If a strong signal clearly points to a canonical repo-specific layer that is not installed yet, you may still include that canonical layer id; commit will mark it unavailable instead of loading it.',
  ];

  return lines.join('\n');
}

function parseFlags(argv) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return { positionals, flags };
}

function readSingleFlag(flags, name) {
  return flags.get(name);
}

function readBooleanFlag(flags, name) {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) return true;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function shouldEmitDebugArtifacts(options = {}) {
  if (options.debugArtifacts !== undefined) return Boolean(options.debugArtifacts);
  const value = process.env.RESONANT_CODE_DEBUG_ARTIFACTS;
  if (!value) return false;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function normalizeCandidate(candidateInput) {
  if (!candidateInput || typeof candidateInput !== 'object' || Array.isArray(candidateInput)) {
    throw new Error('Init candidate must be a JSON object.');
  }

  const projectName = typeof candidateInput.projectName === 'string' && candidateInput.projectName.trim()
    ? candidateInput.projectName.trim()
    : undefined;

  if (!Array.isArray(candidateInput.selectedLayers)) {
    throw new Error('Init candidate field `selectedLayers` must be an array.');
  }

  const selectedLayers = [];
  const selectedLayerSet = new Set();
  for (const value of candidateInput.selectedLayers) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Every selected layer must be a non-empty string.');
    }
    const layerId = value.trim();
    if (!isRepoSpecificLayer(layerId)) {
      throw new Error(`Unsupported selected layer id: ${layerId}`);
    }
    if (!selectedLayerSet.has(layerId)) {
      selectedLayerSet.add(layerId);
      selectedLayers.push(layerId);
    }
  }

  if (!Array.isArray(candidateInput.signals)) {
    throw new Error('Init candidate field `signals` must be an array.');
  }

  const signals = [];
  const signalLayerSet = new Set();
  for (const signalInput of candidateInput.signals) {
    if (!signalInput || typeof signalInput !== 'object' || Array.isArray(signalInput)) {
      throw new Error('Each signals entry must be an object.');
    }

    if (typeof signalInput.layerId !== 'string' || !signalInput.layerId.trim()) {
      throw new Error('Each signals entry must include a non-empty layerId.');
    }
    const layerId = signalInput.layerId.trim();
    if (!isRepoSpecificLayer(layerId)) {
      throw new Error(`Unsupported signal layer id: ${layerId}`);
    }

    if (!Array.isArray(signalInput.evidence) || signalInput.evidence.length === 0) {
      throw new Error(`Signals entry for ${layerId} must include at least one evidence item.`);
    }
    const evidence = signalInput.evidence.map((item) => {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error(`Signals entry for ${layerId} contains an invalid evidence item.`);
      }
      return item.trim();
    });

    if (signalLayerSet.has(layerId)) {
      throw new Error(`Duplicate signals entry for ${layerId}.`);
    }
    signalLayerSet.add(layerId);
    signals.push({
      layerId,
      evidence,
      rationale: typeof signalInput.rationale === 'string' && signalInput.rationale.trim()
        ? signalInput.rationale.trim()
        : undefined,
    });
  }

  for (const layerId of selectedLayers) {
    if (!signalLayerSet.has(layerId)) {
      throw new Error(`Selected layer ${layerId} is missing a corresponding signals entry.`);
    }
  }
  for (const layerId of signalLayerSet) {
    if (!selectedLayerSet.has(layerId)) {
      throw new Error(`Signals entry ${layerId} is not present in selectedLayers.`);
    }
  }

  return { projectName, selectedLayers, signals };
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
# /rc playbook init selects repo-specific layers only from explicit strong signals.
# It does not try to summarize the repository or generate a wiki.

version: "1.0"

meta:
  name: "${projectName}"
  extends:
${extendsLines}

# Override a built-in rule's prescription, weight, rationale, or exceptions.
# Every override must use `supersedes: <directive-id>`; duplicate ids are invalid.
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
    'Updated .gitignore for resonant-code runtime artifacts',
    '',
    'Built-in layers loaded:',
    ...result.extends.final.map((layerId) => `  - ${layerId}`),
    '',
    'Repo-specific strong signals:',
  ];

  if (result.signals.length === 0) {
    lines.push('  - none');
  } else {
    for (const signal of result.signals) {
      lines.push(`  - ${signal.layerId}`);
      for (const evidence of signal.evidence) {
        lines.push(`      evidence: ${evidence}`);
      }
      if (signal.rationale) {
        lines.push(`      rationale: ${signal.rationale}`);
      }
    }
  }

  lines.push('', 'Ignored generated artifacts:');
  for (const entry of result.gitignore.ignored) {
    lines.push(`  - ${entry}`);
  }

  if (result.extends.unavailable.length > 0) {
    lines.push('', 'Detected strong signals but no built-in layer is available yet:');
    for (const layerId of result.extends.unavailable) {
      lines.push(`  - ${layerId}`);
    }
    lines.push('These can be supported in a future resonant-code release.');
  }

  lines.push(
    '',
    'Next steps:',
    '  - Run /resonant-code:calibrate-repo-context to generate RCCL (Repository Context Calibration Layer) from your codebase.',
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
    throw new Error(`Failed to read init candidate JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildDebugArtifacts(projectRoot, prompt, projectName, repoSpecificKnownLayers, signalFiles, enabled) {
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
        signalFiles: signalFiles.map((signal) => signal.path),
      },
    ),
  };
}

function buildCandidateArtifact(projectRoot, signalFiles) {
  const candidatePath = buildCandidatePath(projectRoot, signalFiles);
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
  const signalFiles = collectStrongSignalFiles(projectRoot);
  const projectName = detectProjectName(projectRoot);
  const prompt = buildInterpretationPrompt({ projectName, repoSpecificKnownLayers, signalFiles });
  const debugArtifacts = buildDebugArtifacts(
    projectRoot,
    prompt,
    projectName,
    repoSpecificKnownLayers,
    signalFiles,
    shouldEmitDebugArtifacts(options),
  );

  return {
    status: 'prepared',
    prompt,
    candidateSchema: JSON.stringify(INIT_CANDIDATE_SCHEMA, null, 2),
    candidateArtifact: buildCandidateArtifact(projectRoot, signalFiles),
    projectNameDefault: projectName,
    defaults: {
      extends: DETERMINISTIC_DEFAULT_EXTENDS,
    },
    availableLayers: {
      repoSpecific: repoSpecificKnownLayers,
    },
    signals: signalFiles,
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

  const candidate = normalizeCandidate(readCandidateInput(candidateInput));
  const knownLayers = discoverBuiltinLayers(builtinRoot);
  const included = candidate.selectedLayers.filter((layerId) => knownLayers.has(layerId));
  const unavailable = candidate.selectedLayers.filter((layerId) => !knownLayers.has(layerId));
  const finalExtends = buildFinalExtends(included);
  const projectName = candidate.projectName ?? detectProjectName(projectRoot);

  mkdirSync(playbookDir, { recursive: true });
  writeFileSync(augmentFile, generateLocalAugment(projectName, finalExtends), 'utf-8');
  const gitignorePath = ensureRuntimeArtifactsIgnored(projectRoot);

  const result = {
    status: 'created',
    projectName,
    extends: {
      defaults: DETERMINISTIC_DEFAULT_EXTENDS,
      included,
      unavailable,
      final: finalExtends,
    },
    signals: candidate.signals,
    augmentPath: '.resonant-code/playbook/local-augment.yaml',
    gitignore: {
      path: gitignorePath,
      ignored: GENERATED_GITIGNORE_RULES,
    },
    input,
    debugArtifacts,
  };

  return {
    ...result,
    message: buildSuccessMessage(result),
  };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error('Expected a command: prepare or commit.');
  }

  const { positionals, flags } = parseFlags(rest);
  const projectRoot = positionals[0];
  const builtinRoot = positionals[1];

  if (!projectRoot) throw new Error(`${command} requires <project-root>.`);
  if (!builtinRoot) throw new Error(`${command} requires <builtin-root>.`);

  if (command === 'prepare') {
    return {
      command,
      options: {
        projectRoot,
        builtinRoot,
        debugArtifacts: readBooleanFlag(flags, 'debug-artifacts'),
      },
    };
  }

  if (command === 'commit') {
    return {
      command,
      options: {
        projectRoot,
        builtinRoot,
        input: readSingleFlag(flags, 'input'),
        force: Boolean(readSingleFlag(flags, 'force')),
        debugArtifacts: readBooleanFlag(flags, 'debug-artifacts'),
      },
    };
  }

  throw new Error('Expected a command: prepare or commit.');
}

export function main(argv = args) {
  const parsed = parseCli(argv);
  return parsed.command === 'prepare'
    ? prepareInit(parsed.options)
    : commitInit(parsed.options);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const result = main();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.status === 'exists' ? 1 : 0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
