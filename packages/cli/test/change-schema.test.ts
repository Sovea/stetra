import assert from 'node:assert/strict';
import test from 'node:test';

import { CliError } from '../src/errors.ts';
import { EvaluationInputSchema } from '../src/schemas/change.ts';
import { parseArtifact } from '../src/validation.ts';

test('evaluation input reports the exact path for malformed semantic evidence', () => {
  assert.throws(
    () => parseArtifact(
      EvaluationInputSchema,
      {
        attestations: [{
          guidanceId: 'required-1',
          verdict: 'satisfied',
          explanation: 'The implementation preserves the required boundary.',
          evidenceRefs: [{
            kind: 'semantic',
            ref: 'semantic:boundary',
          }],
        }],
        exceptions: [],
      },
      'evaluation input',
    ),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.ok(error.issues?.some((issue) =>
        issue.path === 'attestations[0].evidenceRefs[0].description'));
      return true;
    },
  );
});

test('evaluation input accepts only canonical evidence shapes', () => {
  const value = parseArtifact(
    EvaluationInputSchema,
    {
      attestations: [{
        guidanceId: 'required-1',
        verdict: 'satisfied',
        explanation: 'The changed file and semantic boundary were inspected.',
        evidenceRefs: [
          {
            kind: 'diff',
            ref: 'diff:src/example.ts',
            file: 'src/example.ts',
          },
          {
            kind: 'semantic',
            ref: 'semantic:boundary',
            description: 'The public boundary remains unchanged.',
          },
        ],
      }],
      exceptions: [],
    },
    'evaluation input',
  );
  assert.equal(value.attestations[0].evidenceRefs[1].kind, 'semantic');
});
