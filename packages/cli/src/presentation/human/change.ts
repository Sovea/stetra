import type { Colors } from 'picocolors/types';

import {
  appendReasons,
  countValues,
  formatCounts,
  heading,
  isRecord,
  statusLine,
  type JsonObject,
} from './shared.ts';

export function formatChangePrepare(
  output: JsonObject,
  colors: Colors,
): string {
  if (output.status === 'guidance-overflow') {
    const lines = [
      heading('Guidance delivery needs a selection', colors),
      `${colors.bold('Budget:')} ${String(output.byteLimit)} bytes`,
      `${colors.bold('Mandatory:')} ${String(output.mandatoryBytes)} bytes`,
      `${colors.bold('Full guidance:')} ${String(output.fullGuidanceBytes)} bytes`,
    ];
    if (Array.isArray(output.selectableConsider)) {
      lines.push('', colors.bold('Optional guidance'));
      for (const item of output.selectableConsider) {
        if (!isRecord(item)) continue;
        lines.push(
          `${colors.cyan('•')} ${colors.bold(String(item.id))} `
          + `${colors.dim(`${String(item.bytes)} bytes`)}`,
        );
        if (typeof item.instruction === 'string') {
          lines.push(`  ${item.instruction}`);
        }
      }
    }
    appendReasons(lines, output.reasons, colors);
    if (typeof output.nextStep === 'string') {
      lines.push('', `${colors.bold('Next:')} ${output.nextStep}`);
    }
    return lines.join('\n');
  }

  const needsAlignment = output.status === 'needs-alignment';
  const verificationRequired = output.status === 'verification-required';
  const lines = [
    heading(
      needsAlignment
        ? 'Semantic alignment required'
        : verificationRequired
          ? 'Verification required before run'
          : 'Change guidance prepared',
      colors,
    ),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  appendTaskAuthority(lines, output.task, colors);
  if (needsAlignment) appendAlignmentDecision(lines, output.reasons, colors);
  appendActivation(lines, output.activation, colors);
  appendCheckPlan(lines, output.checkPlan, colors);
  appendAttestationPlan(lines, output.attestationPlan, colors);
  appendGuidance(lines, output.guidance, colors);
  if ((needsAlignment || verificationRequired) && typeof output.nextStep === 'string') {
    lines.push('', `${colors.bold('Next:')} ${output.nextStep}`);
  } else if (!needsAlignment && !verificationRequired) {
    lines.push(
      '',
      `${colors.bold('Next:')} Implement the aligned change, challenge the complete diff, and complete the prepared run. Machine-readable run details remain available with --json.`,
    );
  }
  return lines.join('\n');
}

export function formatChangeComplete(
  output: JsonObject,
  colors: Colors,
): string {
  const status = String(output.status ?? 'unknown');
  const lines = [
    heading(
      status === 'ready-for-adoption'
        ? 'Change ready for adoption'
        : 'Change evaluation',
      colors,
    ),
    statusLine(status, colors),
  ];

  if (isRecord(output.changes) && Array.isArray(output.changes.files)) {
    const counts = countValues(
      output.changes.files
        .filter(isRecord)
        .map((file) => String(file.status ?? 'unknown')),
    );
    lines.push(
      `${colors.bold('Changed files:')} ${String(output.changes.files.length)}${formatCounts(counts)}`,
    );
  }
  appendScopeDelta(lines, output.scopeDelta, colors);

  if (Array.isArray(output.checks)) {
    const checks = output.checks.filter(isRecord);
    const counts = countValues(checks.map((check) => String(check.status ?? 'unknown')));
    lines.push(
      `${colors.bold('Checks:')} ${String(checks.length)}${formatCounts(counts)}`,
    );
    for (const check of checks) {
      if (check.status === 'passed') continue;
      const marker = check.status === 'failed' ? colors.red('!') : colors.yellow('!');
      lines.push(
        `${marker} ${String(check.id ?? 'check')}: ${String(
          check.reason ?? check.status ?? 'unknown',
        )}`,
      );
    }
  }

  const results = Array.isArray(output.results)
    ? output.results.filter(isRecord)
    : [];
  appendGuidanceSummary(lines, results, colors);
  appendEvaluationAuthority(lines, results, colors);

  appendExceptions(lines, results, colors);
  appendActions(lines, output.actionRequired, colors);
  appendInformational(lines, output.informational, colors);

  if (status === 'ready-for-adoption') {
    lines.push(
      '',
      `${colors.bold('Next:')} Review the actual change and decide whether to adopt it. This result is evidence readiness, not human acceptance.`,
    );
  } else if (status === 'needs-attention') {
    lines.push('', `${colors.bold('Next:')} Review unresolved evidence before adopting the change.`);
  } else if (status === 'exception-required') {
    lines.push(
      '',
      `${colors.bold('Next:')} Supply missing evidence or obtain explicit user approval for the exact exception, then rerun completion.`,
    );
  } else if (status === 'rejected') {
    lines.push(
      '',
      `${colors.bold('Next:')} Fix hard violations or failed required checks before adopting the change.`,
    );
  }
  return lines.join('\n');
}

function appendGuidanceSummary(
  lines: string[],
  results: JsonObject[],
  colors: Colors,
): void {
  if (!results.length) return;
  lines.push('', colors.bold('Guidance summary'));
  for (const section of ['required', 'avoid', 'tension', 'consider']) {
    const sectionResults = results.filter((result) => result.section === section);
    if (!sectionResults.length) continue;
    const counts = countValues(
      sectionResults.map((result) => String(result.verdict ?? 'unknown')),
    );
    lines.push(`${colors.cyan('•')} ${section}: ${formatCounts(counts, false)}`);
  }
}

function appendTaskAuthority(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value) || !Array.isArray(value.provenance)) return;
  const items = value.provenance.filter(isRecord);
  const groups: Array<{
    label: string;
    sources: string[];
  }> = [
    {
      label: 'Human semantic contract',
      sources: ['human-stated', 'human-confirmed'],
    },
    {
      label: 'Agent interpretation',
      sources: ['agent-inferred'],
    },
    {
      label: 'Repository and Runtime facts',
      sources: ['repository-derived', 'deterministic'],
    },
  ];
  for (const group of groups) {
    const selected = items.filter((item) =>
      group.sources.includes(String(item.source)));
    if (!selected.length) continue;
    lines.push('', colors.bold(group.label));
    for (const item of selected) {
      lines.push(
        `${colors.cyan('•')} ${String(item.field)}: ${String(item.value)} `
        + colors.dim(`[${String(item.source)}]`),
      );
    }
  }
}

function appendAlignmentDecision(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(value) || !value.length) return;
  lines.push('', colors.bold('Human decision needed'));
  for (const item of value) {
    if (!isRecord(item)) {
      lines.push(`${colors.yellow('•')} ${String(item)}`);
      continue;
    }
    const detail = typeof item.value === 'string' ? ` — ${item.value}` : '';
    lines.push(
      `${colors.yellow('•')} [${String(item.kind ?? 'decision')}] `
      + `${String(item.message ?? item.field ?? 'Resolve the semantic choice.')}${detail}`,
    );
  }
}

function appendScopeDelta(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value)) return;
  const within = Array.isArray(value.withinTarget)
    ? value.withinTarget.map(String)
    : [];
  const outside = Array.isArray(value.outsideTarget)
    ? value.outsideTarget.map(String)
    : [];
  lines.push(
    `${colors.bold('Target relation:')} within=${String(within.length)}, outside=${String(outside.length)}`,
  );
  if (outside.length) {
    lines.push('', colors.bold('Outside declared targets'));
    for (const path of outside) {
      lines.push(
        `${colors.yellow('•')} ${path} — inspect whether this is necessary adjacent work or a semantic scope change`,
      );
    }
  }
  if (Array.isArray(value.renamed) && value.renamed.length) {
    lines.push('', colors.bold('Renamed files'));
    for (const item of value.renamed) {
      if (isRecord(item)) lines.push(`${colors.cyan('•')} ${String(item.from)} → ${String(item.to)}`);
    }
  }
  if (Array.isArray(value.deleted) && value.deleted.length) {
    lines.push('', colors.bold('Deleted files'));
    for (const path of value.deleted) lines.push(`${colors.yellow('•')} ${String(path)}`);
  }
}

function appendEvaluationAuthority(
  lines: string[],
  results: JsonObject[],
  colors: Colors,
): void {
  const groups = [
    { basis: 'runtime-fact', label: 'Runtime conclusions' },
    { basis: 'agent-attested', label: 'Agent judgments' },
    { basis: 'human-approved', label: 'Human-approved exceptions' },
    { basis: 'unverified', label: 'Unverified conclusions' },
  ];
  for (const group of groups) {
    const selected = results.filter((result) => result.basis === group.basis);
    if (!selected.length) continue;
    lines.push('', colors.bold(group.label));
    for (const result of selected) {
      lines.push(
        `${colors.cyan('•')} ${String(result.guidanceId)}: `
        + `${String(result.verdict ?? 'unknown')} [${String(result.section ?? 'guidance')}]`,
      );
    }
  }
}

function appendActions(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(value)) return;
  const actions = value.filter(isRecord);
  if (!actions.length) return;
  lines.push('', colors.bold('Action required'));
  for (const action of actions) {
    lines.push(
      `${colors.yellow('•')} ${String(action.id ?? 'item')} [${String(action.kind ?? 'review')}]`,
    );
    if (typeof action.message === 'string') lines.push(`  ${action.message}`);
  }
}

function appendInformational(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(value)) return;
  const items = value.filter(isRecord);
  if (!items.length) return;
  lines.push('', colors.bold('Optional information'));
  for (const item of items) {
    lines.push(`${colors.dim('•')} ${String(item.id ?? 'optional-guidance')}`);
  }
}

function appendExceptions(
  lines: string[],
  results: JsonObject[],
  colors: Colors,
): void {
  const exceptions = results.filter((result) => isRecord(result.exception));
  if (!exceptions.length) return;
  const approvedExceptions = exceptions.filter((result) =>
    isRecord(result.exception) && result.exception.status === 'approved');
  const pendingExceptions = exceptions.length - approvedExceptions.length;
  lines.push(
    `${colors.bold('Exceptions:')} approved=${String(approvedExceptions.length)}, pending=${String(pendingExceptions)}`,
  );
  for (const result of exceptions) {
    const exception = result.exception as JsonObject;
    const marker = exception.status === 'approved'
      ? colors.yellow('•')
      : colors.red('!');
    lines.push(
      `${marker} ${String(result.guidanceId)} [${String(
        exception.status ?? 'requested',
      )}] — ${String(exception.reason ?? 'approved exception')}`,
    );
  }
}

function appendGuidance(
  lines: string[],
  guidance: unknown,
  colors: Colors,
): void {
  if (!isRecord(guidance)) return;
  for (const section of ['required', 'tensions', 'avoid', 'consider']) {
    const items = guidance[section];
    if (!Array.isArray(items) || !items.length) continue;
    lines.push('', colors.bold(section));
    for (const item of items) {
      if (!isRecord(item)) continue;
      const text = item.instruction
        ?? item.resolution
        ?? item.description
        ?? item.pattern
        ?? item.id;
      lines.push(`${colors.cyan('•')} [${String(item.id ?? section)}] ${String(text)}`);
    }
  }
}

function appendActivation(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value)) return;
  const targets = Array.isArray(value.targets) ? value.targets.map(String) : [];
  const techStack = Array.isArray(value.techStack) ? value.techStack.map(String) : [];
  if (targets.length) {
    lines.push(`${colors.bold('Targets:')} ${targets.join(', ')}`);
  }
  if (techStack.length) {
    const provenance = Array.isArray(value.techStackProvenance)
      ? value.techStackProvenance
        .filter(isRecord)
        .map((item) => `${String(item.technology)}:${String(item.source)}`)
        .join(', ')
      : 'unknown';
    lines.push(
      `${colors.bold('Technology:')} ${techStack.join(', ')} (${provenance})`,
    );
  }
  if (isRecord(value.activeBySource)) {
    const counts = new Map<string, number>();
    for (const source of ['builtin', 'team', 'personal']) {
      const ids = value.activeBySource[source];
      counts.set(source, Array.isArray(ids) ? ids.length : 0);
    }
    lines.push(`${colors.bold('Policy activation:')} ${formatCounts(counts, false)}`);
  }
  if (isRecord(value.configuredBySource)) {
    const counts = new Map<string, number>();
    for (const source of ['team', 'personal']) {
      const ids = value.configuredBySource[source];
      counts.set(source, Array.isArray(ids) ? ids.length : 0);
    }
    lines.push(`${colors.bold('Configured policy:')} ${formatCounts(counts, false)}`);
  }
  if (Array.isArray(value.inactive) && value.inactive.length) {
    lines.push('', colors.bold('Inactive scoped policy'));
    for (const item of value.inactive) {
      if (!isRecord(item)) continue;
      lines.push(
        `${colors.yellow('•')} ${String(item.id ?? 'directive')} — no overlap with ${String(item.scope ?? 'declared scope')}`,
      );
    }
  }
}

function appendCheckPlan(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(value)) return;
  const checks = value.filter(isRecord);
  if (!checks.length) return;
  const counts = countValues(checks.map((check) => String(check.status ?? 'unknown')));
  lines.push(`${colors.bold('Check plan:')} ${formatCounts(counts, false)}`);
  for (const check of checks) {
    const reasons = Array.isArray(check.reasons)
      ? check.reasons.map(String).join('; ')
      : '';
    const sources = Array.isArray(check.sources)
      ? check.sources.map(checkSourceLabel).join(', ')
      : 'unknown owner';
    const marker = check.status === 'missing'
      ? colors.yellow('!')
      : colors.cyan('•');
    lines.push(`${marker} ${String(check.id ?? 'check')} — ${sources}`);
    if (check.status === 'missing' && reasons) lines.push(`  ${reasons}`);
  }
}

function checkSourceLabel(value: unknown): string {
  if (value === 'team-default') return 'team baseline';
  if (value === 'host-task') return 'Agent-selected task check';
  if (value === 'delivered-guidance') return 'policy-required';
  return String(value);
}

function appendAttestationPlan(
  lines: string[],
  value: unknown,
  colors: Colors,
): void {
  if (!isRecord(value) || !Array.isArray(value.attentionItems)) return;
  const optionalCount = Array.isArray(value.optionalConsiderIds)
    ? value.optionalConsiderIds.length
    : 0;
  lines.push(
    `${colors.bold('Attestations:')} required=${String(value.attentionItems.length)}, optional=${String(optionalCount)}`,
  );
}
