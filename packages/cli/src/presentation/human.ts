import type { Colors } from 'picocolors/types';

type JsonObject = Record<string, unknown>;

export function formatHumanResult(
  command: string,
  output: unknown,
  colors: Colors,
): string {
  if (!isRecord(output)) return String(output);
  if (command === 'init') return formatInit(output, colors);
  if (command === 'status' || command === 'doctor') {
    return formatReadiness(output, colors);
  }
  if (command === 'change prepare') return formatChangePrepare(output, colors);
  if (command.startsWith('context ')) return formatContext(output, colors);
  return formatStructured(output, colors);
}

function formatInit(output: JsonObject, colors: Colors): string {
  const status = String(output.status ?? 'unknown');
  const lines = [
    heading('Resonant Code project setup', colors),
    statusLine(status, colors),
  ];
  if (Array.isArray(output.adapters)) {
    lines.push(`${colors.bold('Adapters:')} ${output.adapters.join(', ') || 'none'}`);
  }
  if (isRecord(output.counts)) {
    const counts = Object.entries(output.counts)
      .filter(([, count]) => Number(count) > 0)
      .map(([action, count]) => `${action}=${String(count)}`)
      .join(', ');
    if (counts) lines.push(`${colors.bold('Artifacts:')} ${counts}`);
  }
  if (Array.isArray(output.artifacts)) {
    for (const artifact of output.artifacts) {
      if (!isRecord(artifact) || artifact.action !== 'blocked') continue;
      lines.push(
        `${colors.yellow('!')} ${String(artifact.path)}: ${String(
          artifact.reason ?? 'managed content changed',
        )}`,
      );
    }
  }
  appendNextActions(lines, output.nextActions, colors);
  return lines.join('\n');
}

function formatReadiness(output: JsonObject, colors: Colors): string {
  const command = String(output.command ?? 'status');
  const lines = [
    heading(`Resonant Code ${command}`, colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.version === 'string') {
    lines.push(`${colors.bold('Version:')} ${output.version}`);
  }
  if (isRecord(output.readiness)) {
    lines.push(
      `${colors.bold('Readiness:')} ${statusValue(
        String(output.readiness.status ?? 'unknown'),
        colors,
      )}`,
    );
    appendNextActions(lines, output.readiness.nextActions, colors);
  }
  if (isRecord(output.installation)) {
    lines.push(
      `${colors.bold('Installation:')} ${statusValue(
        String(output.installation.status ?? 'unknown'),
        colors,
      )}`,
    );
  }
  return lines.join('\n');
}

function formatChangePrepare(output: JsonObject, colors: Colors): string {
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

  const lines = [
    heading('Change guidance prepared', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (typeof output.decisionId === 'string') {
    lines.push(`${colors.bold('Decision:')} ${output.decisionId}`);
  }
  if (typeof output.sessionPath === 'string') {
    lines.push(`${colors.bold('Session:')} ${output.sessionPath}`);
  }
  appendGuidance(lines, output.guidance, colors);
  appendReasons(lines, output.reasons, colors);
  if (typeof output.nextStep === 'string') {
    lines.push('', `${colors.bold('Next:')} ${output.nextStep}`);
  }
  return lines.join('\n');
}

function formatContext(output: JsonObject, colors: Colors): string {
  const lines = [
    heading('Repository context', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (isRecord(output.summary)) {
    const summary = Object.entries(output.summary)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    if (summary) lines.push(`${colors.bold('Summary:')} ${summary}`);
  }
  if ('contract' in output || 'document' in output) {
    lines.push(colors.dim('Use --json for the complete machine-readable artifact.'));
  }
  appendReasons(lines, output.diagnostics, colors);
  return lines.join('\n');
}

function formatStructured(output: JsonObject, colors: Colors): string {
  const lines = [statusLine(String(output.status ?? 'ok'), colors)];
  for (const [label, field] of [
    ['Decision', 'decisionId'],
    ['Evaluation', 'evaluationId'],
    ['Session', 'sessionPath'],
    ['Proposal', 'proposalPath'],
  ] as const) {
    if (typeof output[field] === 'string') {
      lines.push(`${colors.bold(`${label}:`)} ${output[field]}`);
    }
  }
  appendReasons(lines, output.reasons, colors);
  if (typeof output.message === 'string') lines.push(output.message);
  if (typeof output.nextStep === 'string') {
    lines.push(`${colors.bold('Next:')} ${output.nextStep}`);
  }
  if ('evaluation' in output || 'aggregates' in output) {
    lines.push(colors.dim('Use --json for the complete machine-readable result.'));
  }
  return lines.join('\n');
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

function appendNextActions(
  lines: string[],
  actions: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(actions) || !actions.length) return;
  lines.push('', colors.bold('Next actions'));
  for (const action of actions) {
    if (!isRecord(action)) continue;
    lines.push(`${colors.cyan('•')} ${String(action.message ?? action.code)}`);
  }
}

function appendReasons(
  lines: string[],
  reasons: unknown,
  colors: Colors,
): void {
  if (!Array.isArray(reasons) || !reasons.length) return;
  lines.push('', colors.bold('Details'));
  for (const reason of reasons) {
    if (isRecord(reason)) {
      lines.push(`${colors.yellow('•')} ${String(reason.message ?? reason.code)}`);
    } else {
      lines.push(`${colors.yellow('•')} ${String(reason)}`);
    }
  }
}

function heading(value: string, colors: Colors): string {
  return colors.bold(colors.cyan(value));
}

function statusLine(status: string, colors: Colors): string {
  return `${colors.bold('Status:')} ${statusValue(status, colors)}`;
}

function statusValue(status: string, colors: Colors): string {
  if (['ok', 'ready', 'compiled', 'created', 'initialized', 'valid'].includes(status)) {
    return colors.green(status);
  }
  if (['blocked', 'rejected', 'guidance-overflow', 'needs-attention'].includes(status)) {
    return colors.yellow(status);
  }
  return status;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
