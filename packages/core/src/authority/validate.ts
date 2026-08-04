import type {
  AgentInterpretation,
  HumanEvent,
  RepositoryEvidence,
} from './types.ts';
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSafeRepositoryPath,
  isSha256,
  isStableId,
  sha256,
  type ValidationIssue,
} from '../shared/protocol.ts';

export interface ValidatedAuthority {
  humanEvents: HumanEvent[];
  interpretations: AgentInterpretation[];
  repositoryEvidence: RepositoryEvidence[];
}

export function validateAuthority(input: Record<string, unknown>): {
  authority?: ValidatedAuthority;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const humanEvents = validateHumanEvents(input.humanEvents, issues);
  const repositoryEvidence = validateRepositoryEvidence(
    input.repositoryEvidence ?? [],
    issues,
  );
  const interpretations = validateInterpretations(input.interpretations, issues);
  const eventIds = new Set(humanEvents.map((event) => event.id));
  const evidenceIds = new Set(repositoryEvidence.map((evidence) => evidence.id));

  for (const [index, interpretation] of interpretations.entries()) {
    if (!interpretation.basis.humanEventIds.length
      && !interpretation.basis.repositoryEvidenceIds.length) {
      issues.push(issue(
        'interpretation-basis-empty',
        `interpretations[${index}].basis`,
        'Every Agent interpretation must reference at least one Human Event or repository evidence window.',
      ));
    }
    for (const id of interpretation.basis.humanEventIds) {
      if (!eventIds.has(id)) {
        issues.push(issue(
          'human-event-reference-missing',
          `interpretations[${index}].basis.humanEventIds`,
          `Human Event ${JSON.stringify(id)} does not exist.`,
        ));
      }
    }
    for (const id of interpretation.basis.repositoryEvidenceIds) {
      if (!evidenceIds.has(id)) {
        issues.push(issue(
          'repository-evidence-reference-missing',
          `interpretations[${index}].basis.repositoryEvidenceIds`,
          `Repository evidence ${JSON.stringify(id)} does not exist.`,
        ));
      }
    }
    if (interpretation.field === 'focus-path'
      && !isSafeRepositoryPath(interpretation.value)) {
      issues.push(issue(
        'focus-path-unsafe',
        `interpretations[${index}].value`,
        'Focus paths must be safe repository-relative paths.',
      ));
    }
    if (interpretation.field === 'consequence'
      && !['low', 'medium', 'high'].includes(interpretation.value)) {
      issues.push(issue(
        'consequence-invalid',
        `interpretations[${index}].value`,
        'Consequence must be low, medium, or high.',
      ));
    }
  }

  return issues.length
    ? { issues }
    : { authority: { humanEvents, interpretations, repositoryEvidence }, issues };
}

function validateHumanEvents(value: unknown, issues: ValidationIssue[]): HumanEvent[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(issue(
      'human-events-required',
      'humanEvents',
      'At least one exact Human Event is required.',
    ));
    return [];
  }
  const output: HumanEvent[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `humanEvents[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue('human-event-invalid', path, 'Human Event must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['id', 'kind', 'content', 'contentFingerprint', 'provider', 'nativeId'], path, issues);
    if (!isStableId(candidate.id)) {
      issues.push(issue('human-event-id-invalid', `${path}.id`, 'Human Event id is invalid.'));
      continue;
    }
    if (ids.has(candidate.id)) {
      issues.push(issue('human-event-id-duplicate', `${path}.id`, `Human Event ${candidate.id} is duplicated.`));
      continue;
    }
    ids.add(candidate.id);
    if (candidate.kind !== 'task' && candidate.kind !== 'decision') {
      issues.push(issue('human-event-kind-invalid', `${path}.kind`, 'Human Event kind must be task or decision.'));
      continue;
    }
    if (!isNonEmptyString(candidate.content)) {
      issues.push(issue('human-event-content-empty', `${path}.content`, 'Human Event content is required.'));
      continue;
    }
    if (!isSha256(candidate.contentFingerprint)
      || candidate.contentFingerprint !== sha256(candidate.content)) {
      issues.push(issue(
        'human-event-fingerprint-mismatch',
        `${path}.contentFingerprint`,
        'Human Event fingerprint must be the SHA-256 digest of its exact content.',
      ));
      continue;
    }
    if (candidate.provider !== undefined && !isNonEmptyString(candidate.provider)) {
      issues.push(issue('human-event-provider-invalid', `${path}.provider`, 'Provider must be a non-empty string.'));
      continue;
    }
    if (candidate.nativeId !== undefined && !isNonEmptyString(candidate.nativeId)) {
      issues.push(issue('human-event-native-id-invalid', `${path}.nativeId`, 'Native event id must be a non-empty string.'));
      continue;
    }
    output.push({
      id: candidate.id,
      kind: candidate.kind,
      content: candidate.content,
      contentFingerprint: candidate.contentFingerprint,
      ...(candidate.provider ? { provider: candidate.provider } : {}),
      ...(candidate.nativeId ? { nativeId: candidate.nativeId } : {}),
    });
  }
  return output;
}

function validateRepositoryEvidence(
  value: unknown,
  issues: ValidationIssue[],
): RepositoryEvidence[] {
  if (!Array.isArray(value)) {
    issues.push(issue('repository-evidence-invalid', 'repositoryEvidence', 'Repository evidence must be an array.'));
    return [];
  }
  const output: RepositoryEvidence[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `repositoryEvidence[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue('repository-evidence-invalid', path, 'Repository evidence must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['id', 'path', 'startLine', 'endLine', 'text', 'digest'], path, issues);
    if (!isStableId(candidate.id) || ids.has(candidate.id)) {
      issues.push(issue('repository-evidence-id-invalid', `${path}.id`, 'Repository evidence id must be unique and stable.'));
      continue;
    }
    ids.add(candidate.id);
    if (!isSafeRepositoryPath(candidate.path)) {
      issues.push(issue('repository-evidence-path-unsafe', `${path}.path`, 'Evidence path must be repository-relative.'));
      continue;
    }
    if (!Number.isInteger(candidate.startLine) || Number(candidate.startLine) < 1
      || !Number.isInteger(candidate.endLine) || Number(candidate.endLine) < Number(candidate.startLine)) {
      issues.push(issue('repository-evidence-range-invalid', path, 'Evidence line range is invalid.'));
      continue;
    }
    if (typeof candidate.text !== 'string'
      || !isSha256(candidate.digest)
      || candidate.digest !== sha256(candidate.text)) {
      issues.push(issue('repository-evidence-digest-mismatch', `${path}.digest`, 'Evidence digest must match the exact text.'));
      continue;
    }
    output.push({
      id: candidate.id,
      path: candidate.path,
      startLine: Number(candidate.startLine),
      endLine: Number(candidate.endLine),
      text: candidate.text,
      digest: candidate.digest,
    });
  }
  return output;
}

function validateInterpretations(
  value: unknown,
  issues: ValidationIssue[],
): AgentInterpretation[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(issue('interpretations-required', 'interpretations', 'Agent interpretations are required.'));
    return [];
  }
  const fields = new Set(['desired-outcome', 'constraint', 'non-goal', 'focus-path', 'consequence']);
  const output: AgentInterpretation[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `interpretations[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue('interpretation-invalid', path, 'Agent interpretation must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['id', 'field', 'value', 'basis'], path, issues);
    if (!isStableId(candidate.id) || ids.has(candidate.id)) {
      issues.push(issue('interpretation-id-invalid', `${path}.id`, 'Interpretation id must be unique and stable.'));
      continue;
    }
    ids.add(candidate.id);
    if (typeof candidate.field !== 'string' || !fields.has(candidate.field)) {
      issues.push(issue('interpretation-field-invalid', `${path}.field`, 'Interpretation field is invalid.'));
      continue;
    }
    if (!isNonEmptyString(candidate.value)) {
      issues.push(issue('interpretation-value-empty', `${path}.value`, 'Interpretation value is required.'));
      continue;
    }
    if (!isRecord(candidate.basis)) {
      issues.push(issue('interpretation-basis-invalid', `${path}.basis`, 'Interpretation basis must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate.basis, ['humanEventIds', 'repositoryEvidenceIds'], `${path}.basis`, issues);
    const humanEventIds = stringIds(candidate.basis.humanEventIds, `${path}.basis.humanEventIds`, issues);
    const repositoryEvidenceIds = stringIds(
      candidate.basis.repositoryEvidenceIds,
      `${path}.basis.repositoryEvidenceIds`,
      issues,
    );
    output.push({
      id: candidate.id,
      field: candidate.field as AgentInterpretation['field'],
      value: candidate.value.trim(),
      basis: { humanEventIds, repositoryEvidenceIds },
    });
  }
  return output;
}

function stringIds(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item))) {
    issues.push(issue('reference-list-invalid', path, 'References must be an array of stable ids.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('reference-list-duplicate', path, 'References must not contain duplicates.'));
  }
  return [...value];
}

function rejectExtraKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of hasExactKeys(value, allowed)) {
    issues.push(issue('unsupported-field', `${path}.${key}`, `Unsupported field ${key}.`));
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
