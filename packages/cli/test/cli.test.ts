import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { CliError } from '../src/errors.ts';
import { formatCliOutput, runCli } from '../src/cli.ts';
import type { PromptProvider } from '../src/runtime-context.ts';

test('CLI owns init, bootstrap, RCCL, and change prepare without installation paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-flow-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"cli-fixture","type":"module"}\n', 'utf8');
    writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');

    const initialized = await runCli([
      'init',
      root,
      '--adapter',
      'codex',
      '--json',
    ]);
    assert.equal((initialized.output as { status: string }).status, 'initialized');
    assert.equal(initialized.json, true);

    const bootstrap = await runCli(['bootstrap', 'prepare', root, '--json']);
    assert.equal((bootstrap.output as { status: string }).status, 'prepared');
    const bootstrapOutput = bootstrap.output as {
      prompt: string;
      signals?: unknown;
    };
    assert.match(bootstrapOutput.prompt, /Inspect the repository with your native tools/);
    assert.equal(Object.hasOwn(bootstrapOutput, 'signals'), false);

    const bootstrapCandidate = join(root, 'bootstrap-candidate.json');
    writeFileSync(bootstrapCandidate, JSON.stringify({
      selectedLayers: ['builtin/languages/typescript'],
      evidence: [{
        layerId: 'builtin/languages/typescript',
        paths: ['missing-config.json'],
      }],
    }), 'utf8');
    await assert.rejects(
      () => runCli([
        'bootstrap',
        'commit',
        root,
        '--input',
        bootstrapCandidate,
        '--json',
      ]),
      /names a missing repository file/,
    );

    writeFileSync(bootstrapCandidate, JSON.stringify({
      selectedLayers: ['builtin/languages/typescript'],
      evidence: [{
        layerId: 'builtin/languages/typescript',
        paths: ['package.json'],
        rationale: 'The package manifest declares the TypeScript project boundary.',
      }],
    }), 'utf8');
    const committedBootstrap = await runCli([
      'bootstrap',
      'commit',
      root,
      '--input',
      bootstrapCandidate,
      '--json',
    ]);
    assert.equal((committedBootstrap.output as { status: string }).status, 'created');
    const humanBootstrap = formatCliOutput({
      ...committedBootstrap,
      json: false,
      color: false,
    });
    assert.match(humanBootstrap, /Selected layers/);
    assert.match(humanBootstrap, /builtin\/languages\/typescript/);
    assert.match(humanBootstrap, /package\.json/);
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    assert.equal(gitignore.match(/# resonant-code:begin/g)?.length, 1);
    assert.equal(gitignore.match(/# resonant-code:end/g)?.length, 1);
    assert.doesNotMatch(gitignore, /# resonant-code: generated runtime artifacts/);

    const context = await runCli([
      'context',
      'prepare',
      root,
      '--evidence',
      'src/example.ts:1-1',
      '--json',
    ]);
    assert.equal((context.output as { status: string }).status, 'ready');
    const contextContract = (context.output as {
      contract: {
        schemaVersion: string;
        requestId: string;
        contextFingerprint: string;
        evidenceWindows: Array<{ windowId: string }>;
      };
    }).contract;
    const contextProposal = join(root, 'context-proposal.json');
    writeFileSync(contextProposal, JSON.stringify({
      schemaVersion: contextContract.schemaVersion,
      requestId: contextContract.requestId,
      contextFingerprint: contextContract.contextFingerprint,
      replace: false,
      observations: [{
        id: 'obs-example-export-boundary',
        category: 'architecture',
        scope: 'src/**',
        statement: 'The example export is defined in src/example.ts.',
        affects: ['api-shape'],
        decisionImpact: 'Changing the export elsewhere would split the public shape.',
        semanticConfidence: 'high',
        evidence: [{
          windowId: contextContract.evidenceWindows[0].windowId,
        }],
      }],
    }), 'utf8');
    const contextContractPath = writeJsonFixture(
      root,
      'context-contract.json',
      context.output,
    );
    const committedContext = await runCli([
      'context',
      'commit',
      root,
      '--contract',
      contextContractPath,
      '--input',
      contextProposal,
      '--json',
    ]);
    const contextFingerprint = (committedContext.output as {
      document: {
        observations: Array<{
          lifecycle: { contentFingerprint: string };
        }>;
      };
    }).document.observations[0].lifecycle.contentFingerprint;
    const humanContext = formatCliOutput({
      ...committedContext,
      json: false,
      color: false,
    });
    assert.match(humanContext, /obs-example-export-boundary/);
    assert.match(humanContext, /Changing the export elsewhere/);
    assert.match(humanContext, new RegExp(contextFingerprint));
    await assert.rejects(
      () => runCli([
        'context',
        'approve',
        root,
        '--id',
        'obs-example-export-boundary',
        '--fingerprint',
        `obs-example-export-boundary=${'0'.repeat(64)}`,
        '--approved-by',
        'reviewer',
        '--json',
      ]),
      /changed after review/,
    );
    const approvedContext = await runCli([
      'context',
      'approve',
      root,
      '--id',
      'obs-example-export-boundary',
      '--fingerprint',
      `obs-example-export-boundary=${contextFingerprint}`,
      '--approved-by',
      'reviewer',
      '--json',
    ]);
    assert.equal((approvedContext.output as { status: string }).status, 'approved');

    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'cli@example.invalid']);
    git(root, ['config', 'user.name', 'CLI Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const prepared = await runCli([
      'change',
      'prepare',
      root,
      '--task',
      'Document the exported example',
      '--change-type',
      'docs',
      '--target',
      'src/example.ts',
      '--risk',
      'low',
      '--scope',
      'local',
      '--guidance-byte-limit',
      '20000',
      '--json',
    ]);
    const decision = prepared.output as {
      status: string;
      runId?: string;
      runPath?: string;
    };
    assert.equal(decision.status, 'checks-required');
    assert.equal(decision.runId, undefined);
    assert.equal(decision.runPath, undefined);
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);

    const status = await runCli(['status', root, '--json']);
    assert.equal((status.output as {
      controlPlane: { kind: string };
      installation: { status: string };
    }).controlPlane.kind, 'cli');
    assert.equal((status.output as {
      installation: { status: string };
    }).installation.status, 'current');
    const doctor = await runCli(['doctor', root, '--strict', '--json']);
    assert.equal((doctor.output as { status: string }).status, 'blocked');
    assert.equal(doctor.exitCode, 2);
    const doctorReadiness = (doctor.output as {
      readiness: {
        required: Array<{ code: string }>;
        recommended: Array<{ code: string }>;
        optional: Array<{ code: string }>;
      };
    }).readiness;
    assert.ok(doctorReadiness.required.some((action) => action.code === 'checks-absent'));
    assert.equal(
      doctorReadiness.recommended.some((action) => action.code === 'local-augment-absent'),
      false,
    );
    assert.equal(
      doctorReadiness.optional.some((action) => action.code === 'rccl-absent'),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('change lifecycle creates one task-scoped run only after checks are configured', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-run-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"run-fixture","type":"module"}\n', 'utf8');
    writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'run@example.invalid']);
    git(root, ['config', 'user.name', 'Run Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const prepareArgs = [
      'change',
      'prepare',
      root,
      '--task',
      'Document the exported example',
      '--change-type',
      'docs',
      '--target',
      'src/example.ts',
      '--risk',
      'low',
      '--scope',
      'local',
      '--guidance-byte-limit',
      '20000',
      '--json',
    ];
    const blocked = (await runCli(prepareArgs)).output as {
      status: string;
      checkPlan: Array<{ id: string }>;
      runId?: string;
    };
    assert.equal(blocked.status, 'checks-required');
    assert.equal(blocked.runId, undefined);
    assert.equal(existsSync(join(root, '.resonant-code', 'runs')), false);

    mkdirSync(join(root, '.resonant-code'), { recursive: true });
    writeFileSync(join(root, '.resonant-code', 'checks.json'), JSON.stringify({
      version: '1.0',
      checks: blocked.checkPlan.map((check) => ({
        id: check.id,
        command: [process.execPath, '-e', 'process.exit(0)'],
        timeoutMs: 10_000,
      })),
    }, null, 2), 'utf8');

    const prepared = (await runCli(prepareArgs)).output as {
      status: string;
      runId: string;
      runPath: string;
      evaluationInputPath: string;
    };
    assert.ok(prepared.status === 'compiled' || prepared.status === 'needs-attention');
    assert.match(prepared.runId, /^[0-9a-f-]{36}$/);
    const run = JSON.parse(readFileSync(prepared.runPath, 'utf8'));
    assert.equal(run.runId, prepared.runId);
    assert.equal(run.workflow, 'change');
    assert.equal(run.state, 'prepared');
    assert.deepEqual(
      JSON.parse(readFileSync(prepared.evaluationInputPath, 'utf8')),
      { attestations: [], exceptions: [] },
    );
    assert.ok(run.worktreeBaseline.entries.every((entry: { path: string }) =>
      !entry.path.startsWith('.resonant-code/runs/')));

    const runsDirectory = join(root, '.resonant-code', 'runs');
    const oldCompletedRuns = Array.from({ length: 51 }, () => {
      const runId = randomUUID();
      const runDirectory = join(runsDirectory, runId);
      mkdirSync(join(runDirectory, 'checks'), { recursive: true });
      writeFileSync(
        join(runDirectory, 'run.json'),
        `${JSON.stringify({ state: 'completed' })}\n`,
        'utf8',
      );
      writeFileSync(join(runDirectory, 'checks', 'fixture.log'), 'old\n', 'utf8');
      return runDirectory;
    });
    const retainedPreparedRun = join(runsDirectory, randomUUID());
    mkdirSync(retainedPreparedRun);
    writeFileSync(
      join(retainedPreparedRun, 'run.json'),
      `${JSON.stringify({ state: 'prepared' })}\n`,
      'utf8',
    );

    writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 2;\n', 'utf8');
    const completed = (await runCli([
      'change',
      'complete',
      root,
      '--run',
      prepared.runId,
      '--json',
    ])).output as {
      status: string;
      runId: string;
      runPath: string;
      checks: Array<{ outputRefs?: { stdout: string; stderr: string } }>;
    };
    assert.equal(completed.runId, prepared.runId);
    assert.equal(completed.runPath, prepared.runPath);
    assert.ok(completed.checks.every((check) =>
      check.outputRefs?.stdout.startsWith(
        `.resonant-code/runs/${prepared.runId}/checks/`,
      )));
    const completedRun = JSON.parse(readFileSync(prepared.runPath, 'utf8'));
    assert.equal(completedRun.state, 'completed');
    assert.equal(Object.hasOwn(completedRun, 'completionFacts'), false);
    assert.equal(existsSync(join(root, '.resonant-code', 'feedback')), false);
    const retainedRunStates = readdirSync(runsDirectory)
      .map((runId) =>
        JSON.parse(readFileSync(join(runsDirectory, runId, 'run.json'), 'utf8')).state);
    assert.equal(retainedRunStates.filter((state) => state === 'completed').length, 50);
    assert.equal(retainedRunStates.filter((state) => state === 'prepared').length, 1);
    assert.ok(oldCompletedRuns.some((runDirectory) => !existsSync(runDirectory)));
    assert.equal(existsSync(retainedPreparedRun), true);

    const explained = (await runCli([
      'change',
      'explain',
      root,
      '--run',
      prepared.runId,
      '--json',
    ])).output as {
      state: string;
      runId: string;
      evaluation: { evaluationId: string };
    };
    assert.equal(explained.state, 'completed');
    assert.equal(explained.runId, prepared.runId);
    assert.equal(
      explained.evaluation.evaluationId,
      completedRun.completion.evaluation.evaluationId,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects removed change aliases and validates RCCL through Core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-validation-'));
  try {
    await assert.rejects(
      () => runCli(['change', 'auto']),
      /unknown command 'auto'/i,
    );

    mkdirSync(join(root, '.resonant-code'), { recursive: true });
    writeFileSync(
      join(root, '.resonant-code', 'rccl.yaml'),
      'version: "1.0"\nobservations:\n  - id: incomplete\n',
      'utf8',
    );
    const status = await runCli(['status', root, '--json']);
    const output = status.output as {
      sources: { rccl: string };
      readiness: { required: Array<{ code: string }> };
    };
    assert.equal(output.sources.rccl, 'invalid');
    assert.ok(output.readiness.required.some((action) => action.code === 'rccl-invalid'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict doctor blocks only required readiness issues', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-readiness-levels-'));
  try {
    await runCli(['init', root, '--adapter', 'codex', '--json']);
    mkdirSync(join(root, '.resonant-code'), { recursive: true });
    writeFileSync(join(root, '.resonant-code', 'checks.json'), JSON.stringify({
      version: '1.0',
      checks: [{
        id: 'test',
        command: [process.execPath, '-e', 'process.exit(0)'],
        timeoutMs: 10_000,
      }],
    }), 'utf8');

    const doctor = await runCli(['doctor', root, '--strict', '--json']);
    const output = doctor.output as {
      status: string;
      readiness: {
        status: string;
        required: Array<{ code: string }>;
        recommended: Array<{ code: string }>;
        optional: Array<{ code: string }>;
      };
    };
    assert.equal(doctor.exitCode, 0);
    assert.equal(output.status, 'ok');
    assert.equal(output.readiness.status, 'ready');
    assert.deepEqual(output.readiness.required, []);
    assert.ok(
      output.readiness.recommended.some((action) =>
        action.code === 'local-augment-absent'),
    );
    assert.ok(
      output.readiness.optional.some((action) => action.code === 'rccl-absent'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Commander exposes nested help and classifies usage errors', async () => {
  const help = await runCli(['change', 'prepare', '--help']);
  assert.equal(help.exitCode, 0);
  assert.equal(help.json, false);
  assert.match(String(help.output), /--guidance-byte-limit/);

  await assert.rejects(
    () => runCli(['change', 'prepare']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'USAGE_ERROR');
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /required option '--task/);
      return true;
    },
  );

  await assert.rejects(
    () => runCli([
      'change',
      'prepare',
      '--task',
      'Invalid option fixture',
      '--risk',
      'critical',
    ]),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'USAGE_ERROR');
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /Invalid risk/);
      return true;
    },
  );
});

test('machine mode never prompts or emits ANSI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-machine-'));
  let promptCalls = 0;
  const prompts: PromptProvider = {
    async selectAdapters() {
      promptCalls += 1;
      throw new Error('machine mode attempted to prompt');
    },
    async selectGuidance() {
      promptCalls += 1;
      throw new Error('machine mode attempted to prompt');
    },
  };
  try {
    const execution = await runCli(
      ['init', root, '--json'],
      {
        interactive: true,
        color: true,
        input: new PassThrough(),
        output: new PassThrough(),
        prompts,
      },
    );
    assert.equal(promptCalls, 0);
    assert.deepEqual(
      (execution.output as { adapters: string[] }).adapters,
      ['claude', 'codex'],
    );
    const rendered = formatCliOutput(execution);
    assert.deepEqual(JSON.parse(rendered), execution.output);
    assert.doesNotMatch(rendered, /\u001B\[/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive init collects adapters without changing project planning rules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-interactive-init-'));
  let adapterPrompts = 0;
  const prompts: PromptProvider = {
    async selectAdapters() {
      adapterPrompts += 1;
      return ['codex'];
    },
    async selectGuidance() {
      throw new Error('unexpected guidance prompt');
    },
  };
  try {
    const execution = await runCli(
      ['init', root, '--dry-run'],
      {
        interactive: true,
        color: true,
        input: new PassThrough(),
        output: new PassThrough(),
        prompts,
      },
    );
    assert.equal(adapterPrompts, 1);
    assert.deepEqual(
      (execution.output as { adapters: string[] }).adapters,
      ['codex'],
    );
    const rendered = formatCliOutput(execution);
    assert.match(rendered, /\u001B\[/);
    assert.equal(existsSync(join(root, '.resonant-code', 'manifest.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive guidance overflow returns an explicit selection to Runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-interactive-overflow-'));
  let guidancePrompts = 0;
  const prompts: PromptProvider = {
    async selectAdapters() {
      throw new Error('unexpected adapter prompt');
    },
    async selectGuidance(input) {
      guidancePrompts += 1;
      assert.ok(input.candidates.length > 0);
      assert.ok(input.mandatoryBytes <= input.byteLimit);
      return {
        considerIds: [],
        rationale: 'The mandatory guidance is sufficient for this focused fixture.',
      };
    },
  };
  try {
    writeFileSync(join(root, 'example.ts'), 'export const value = 1;\n', 'utf8');
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'cli@example.invalid']);
    git(root, ['config', 'user.name', 'CLI Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const execution = await runCli(
      [
        'change',
        'prepare',
        root,
        '--task',
        'Add an exported feature',
        '--change-type',
        'feature',
        '--target',
        'example.ts',
        '--tech',
        'typescript',
        '--guidance-byte-limit',
        '3000',
      ],
      {
        interactive: true,
        input: new PassThrough(),
        output: new PassThrough(),
        prompts,
      },
    );
    assert.equal(guidancePrompts, 1);
    assert.notEqual(
      (execution.output as { status: string }).status,
      'guidance-overflow',
    );
    const decision = execution.output as {
      delivery: { selection: { considerIds: string[]; rationale: string } };
    };
    assert.deepEqual(decision.delivery.selection.considerIds, []);
    assert.match(decision.delivery.selection.rationale, /mandatory guidance/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prompt cancellation maps to conventional exit code 130', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-cancel-'));
  const prompts: PromptProvider = {
    async selectAdapters() {
      const error = new Error('cancelled');
      error.name = 'ExitPromptError';
      throw error;
    },
    async selectGuidance() {
      throw new Error('unexpected guidance prompt');
    },
  };
  try {
    await assert.rejects(
      () => runCli(['init', root], {
        interactive: true,
        input: new PassThrough(),
        output: new PassThrough(),
        prompts,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'PROMPT_CANCELLED');
        assert.equal(error.exitCode, 130);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI returns business guidance overflow as a successful machine result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-cli-overflow-'));
  try {
    writeFileSync(join(root, 'example.ts'), 'export const value = 1;\n', 'utf8');
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'cli@example.invalid']);
    git(root, ['config', 'user.name', 'CLI Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial']);

    const result = await runCli([
      'change',
      'prepare',
      root,
      '--task',
      'Add an exported feature',
      '--change-type',
      'feature',
      '--target',
      'example.ts',
      '--tech',
      'typescript',
      '--guidance-byte-limit',
      '3000',
      '--json',
    ]);
    assert.equal((result.output as { status: string }).status, 'guidance-overflow');
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('human completion output presents facts, guidance, and review needs', () => {
  const rendered = formatCliOutput({
    command: 'change complete',
    json: false,
    color: false,
    exitCode: 0,
    output: {
      status: 'warning',
      evaluationId: 'evaluation-id',
      changes: {
        files: [
          { path: 'src/a.ts', status: 'modified' },
          { path: 'src/b.ts', status: 'added' },
        ],
      },
      checks: [
        { id: 'typecheck', status: 'passed' },
        { id: 'test', status: 'failed', reason: 'Check exited with 1.' },
      ],
      results: [
        {
          guidanceId: 'required-1',
          section: 'required',
          verdict: 'satisfied',
          reasons: ['Evidence covered the requirement.'],
        },
        {
          guidanceId: 'consider-1',
          section: 'consider',
          verdict: 'unverified',
          reasons: ['No evidence-backed verdict was provided.'],
        },
      ],
      runId: 'f61d2968-155a-4249-a72e-4789001bb515',
      runPath: '/tmp/run/run.json',
    },
  });
  assert.match(rendered, /Changed files: 2/);
  assert.match(rendered, /Checks: 2/);
  assert.match(rendered, /test: Check exited with 1/);
  assert.match(rendered, /required: satisfied=1/);
  assert.match(rendered, /consider-1 \(unverified\)/);
  assert.match(rendered, /Run: f61d2968-155a-4249-a72e-4789001bb515/);
  assert.match(rendered, /Review unresolved evidence/);
});

function writeJsonFixture(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}
