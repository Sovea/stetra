import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateGuidance } from '../src/feedback.ts';
import { prepareAdherenceEvidenceContract } from '../src/ai-contracts/adherence-evidence.ts';
import { hostArtifactEnvelope } from '../src/ai-contracts/shared.ts';

test('partial is excluded from strict follow numerator and trend uses two five-verdict windows', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-feedback-'));
  try {
    const lockfilePath = join(root, 'playbook.lock.yaml');
    let output;
    const verdicts = ['followed', 'followed', 'followed', 'followed', 'followed', 'ignored', 'ignored', 'ignored', 'ignored', 'partial'] as const;
    for (const verdict of verdicts) output = evaluateWithVerdict(lockfilePath, verdict);
    const signal = output!.lockfile.directives.d1.quality_signal.overall;
    assert.equal(signal.followed, 5);
    assert.equal(signal.partial, 1);
    assert.equal(signal.ignored, 4);
    assert.equal(signal.follow_rate, 0.5);
    assert.equal(signal.coverage_rate, 1);
    assert.equal(signal.trend, 'declining');
    assert.equal(signal.recent_verdicts.length, 10);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing adherence artifact records unverified without changing follow rate', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-feedback-'));
  try {
    const result = evaluateGuidance({ ...feedbackInput(join(root, 'playbook.lock.yaml')) });
    const signal = result.lockfile.directives.d1.quality_signal.overall;
    assert.equal(signal.unverified, 1);
    assert.equal(signal.follow_rate, 0);
    assert.equal(signal.coverage_rate, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('v3 lockfile data is rejected without modification after the v1 reset', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-old-lockfile-'));
  try {
    const lockfilePath = join(root, 'playbook.lock.yaml');
    const oldData = 'version: "3.0"\ndirectives: {}\nobservations: {}\ntensions: {}\ngovernance_summary: {}\n';
    writeFileSync(lockfilePath, oldData, 'utf8');
    assert.throws(() => evaluateGuidance(feedbackInput(lockfilePath)), /UNSUPPORTED_SCHEMA_VERSION.*1\.0/);
    assert.equal(readFileSync(lockfilePath, 'utf8'), oldData);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function evaluateWithVerdict(lockfilePath: string, verdict: 'followed' | 'partial' | 'ignored') {
  const input = feedbackInput(lockfilePath);
  const contract = prepareAdherenceEvidenceContract({ directives: [{ id: 'd1', description: 'directive', prescription: 'must', execution_mode: 'enforce' }], taskDescription: 'test feedback', artifactPath: 'adherence.json' });
  input.packet.post_compile_contract_requests = [{
    kind: 'adherence-evidence',
    artifact: contract.evidenceArtifact,
    contract: contract.contract,
  }];
  const payload = { verdicts: [{ directive_id: 'd1', verdict, confidence: 0.9, reason: verdict, evidence_refs: [{ kind: 'command' as const, ref: 'test-command', output_hash: 'hash-1' }], ...(verdict === 'ignored' ? { ignored_reason: 'other' as const } : {}) }] };
  return evaluateGuidance({ ...input, artifacts: { adherenceEvidence: { raw: hostArtifactEnvelope(contract.contract, payload), path: 'adherence.json' } }, evidenceContext: { commandOutputHashes: ['hash-1'] } });
}

function feedbackInput(lockfilePath: string): any {
  const taskIntent = { workflow: 'code', change_type: 'feature', operation: 'modify', target_layer: 'unknown', tech_stack: [], changed_files: [], tags: [] };
  const ego = { taskIntent, guidance: { must_follow: [{ id: 'd1', statement: 'directive', rationale: 'reason', prescription: 'must', exceptions: [], examples: [], execution_mode: 'enforce' }], avoid: [], context_tensions: [], ambient: [] } };
  return {
    ego, lockfilePath,
    packet: {
      version: '1', status: 'compiled', task: { workflow: 'code', change_type: 'feature', operation: 'modify', input: { description: 'test feedback' } },
      interpretation: { input_provenance: { interpretation_mode: 'deterministic-only' }, resolved: { task_intent: taskIntent, context_profile: {} } },
      governance: { ego, trace: {}, semantic_merge: { directive_modes: [{ directive_id: 'd1', execution_mode: 'enforce' }], context_tensions: [], relations: [], observation_links: [], observation_states: [] } },
    },
  };
}
