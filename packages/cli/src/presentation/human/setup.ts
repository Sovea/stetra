import type { Colors } from 'picocolors/types';

import {
  appendReasons,
  appendStringList,
  heading,
  isRecord,
  statusLine,
  statusValue,
  type JsonObject,
} from './shared.ts';

export function formatInit(output: JsonObject, colors: Colors): string {
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
  appendReadinessGroups(lines, output.readiness, colors);
  return lines.join('\n');
}

export function formatReadiness(
  output: JsonObject,
  colors: Colors,
): string {
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
    appendReadinessGroups(lines, output.readiness, colors);
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

export function formatBootstrap(
  output: JsonObject,
  colors: Colors,
): string {
  const lines = [
    heading('Team Playbook bootstrap', colors),
    statusLine(String(output.status ?? 'unknown'), colors),
  ];
  if (isRecord(output.augment)) {
    lines.push(
      `${colors.bold('Destination:')} ${String(output.augment.path ?? 'unknown')}`,
      `${colors.bold('Existing:')} ${String(Boolean(output.augment.exists))}`,
    );
  }
  if (isRecord(output.extends)) {
    appendStringList(lines, 'Selected layers', output.extends.included, colors);
    appendStringList(lines, 'Unavailable layers', output.extends.unavailable, colors);
  } else if (
    isRecord(output.availableLayers)
    && Array.isArray(output.availableLayers.repoSpecific)
  ) {
    lines.push(
      `${colors.bold('Available repository layers:')} ${String(
        output.availableLayers.repoSpecific.length,
      )}`,
    );
  }
  if (Array.isArray(output.evidence) && output.evidence.length) {
    lines.push('', colors.bold('Reviewed repository evidence'));
    for (const entry of output.evidence) {
      if (!isRecord(entry)) continue;
      lines.push(`${colors.cyan('•')} ${String(entry.layerId ?? 'layer')}`);
      if (Array.isArray(entry.paths)) {
        for (const path of entry.paths) lines.push(`  ${String(path)}`);
      }
      if (typeof entry.rationale === 'string') {
        lines.push(`  ${colors.dim(entry.rationale)}`);
      }
    }
  }
  if (typeof output.augmentPath === 'string') {
    lines.push(`${colors.bold('Written:')} ${output.augmentPath}`);
  }
  if (output.status === 'prepared') {
    lines.push(
      '',
      `${colors.bold('Next:')} Let the Host inspect the repository and show its exact layer candidate for user approval before commit.`,
      colors.dim('Use --json for the bounded candidate contract.'),
    );
  } else if (output.status === 'created') {
    lines.push(
      '',
      `${colors.bold('Next:')} Review and commit the generated Team Playbook with the repository.`,
    );
  } else if (typeof output.message === 'string') {
    lines.push('', output.message);
  }
  return lines.join('\n');
}

export function formatContext(
  output: JsonObject,
  colors: Colors,
): string {
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
  if (isRecord(output.contract)) {
    if (typeof output.contract.contextFingerprint === 'string') {
      lines.push(
        `${colors.bold('Contract:')} ${output.contract.contextFingerprint}`,
      );
    }
    if (Array.isArray(output.contract.evidenceWindows)) {
      lines.push('', colors.bold('Evidence windows'));
      for (const window of output.contract.evidenceWindows) {
        if (!isRecord(window)) continue;
        const range = Array.isArray(window.lineRange)
          ? window.lineRange.join('-')
          : 'unknown';
        lines.push(
          `${colors.cyan('•')} ${String(window.file)}:${range}`,
          `  ${colors.dim(String(window.windowId ?? ''))}`,
        );
      }
    }
    lines.push(colors.dim('Use --json for the complete proposal contract.'));
  }
  if (isRecord(output.document) && Array.isArray(output.document.observations)) {
    appendObservations(lines, output.document.observations, colors);
  }
  if (Array.isArray(output.approvedObservationIds)) {
    appendStringList(
      lines,
      'Approved observations',
      output.approvedObservationIds,
      colors,
    );
  }
  if (typeof output.written === 'string') {
    lines.push(`${colors.bold('Written:')} ${output.written}`);
  }
  appendReasons(lines, output.diagnostics, colors);
  return lines.join('\n');
}

function appendActionGroup(
  lines: string[],
  label: string,
  actions: unknown,
  colors: Colors,
  level: 'required' | 'recommended' | 'optional',
): void {
  if (!Array.isArray(actions) || !actions.length) return;
  lines.push('', colors.bold(label));
  for (const action of actions) {
    if (!isRecord(action)) continue;
    const marker = level === 'required'
      ? colors.yellow('!')
      : level === 'recommended'
        ? colors.cyan('•')
        : colors.dim('•');
    const message = String(action.message ?? action.code);
    lines.push(`${marker} ${level === 'optional' ? colors.dim(message) : message}`);
  }
}

function appendObservations(
  lines: string[],
  observations: unknown[],
  colors: Colors,
): void {
  if (!observations.length) return;
  lines.push('', colors.bold('Observations'));
  for (const value of observations) {
    if (!isRecord(value)) continue;
    lines.push(
      `${colors.cyan('•')} ${colors.bold(String(value.id ?? 'observation'))} `
      + `[${String(value.reviewStatus ?? 'generated')}]`,
    );
    if (typeof value.statement === 'string') lines.push(`  ${value.statement}`);
    if (typeof value.decisionImpact === 'string') {
      lines.push(`  ${colors.bold('Impact:')} ${value.decisionImpact}`);
    }
    if (typeof value.semanticConfidence === 'string') {
      lines.push(`  ${colors.bold('Confidence:')} ${value.semanticConfidence}`);
    }
    if (isRecord(value.lifecycle) && typeof value.lifecycle.contentFingerprint === 'string') {
      lines.push(
        `  ${colors.bold('Fingerprint:')} ${value.lifecycle.contentFingerprint}`,
      );
    }
    if (Array.isArray(value.evidence)) {
      for (const evidence of value.evidence) {
        if (!isRecord(evidence)) continue;
        const range = Array.isArray(evidence.lineRange)
          ? evidence.lineRange.join('-')
          : 'unknown';
        lines.push(`  ${colors.dim(`${String(evidence.file)}:${range}`)}`);
      }
    }
  }
}

function appendReadinessGroups(
  lines: string[],
  readiness: unknown,
  colors: Colors,
): void {
  if (!isRecord(readiness)) return;
  appendActionGroup(lines, 'Required', readiness.required, colors, 'required');
  appendActionGroup(
    lines,
    'Recommended',
    readiness.recommended,
    colors,
    'recommended',
  );
  appendActionGroup(lines, 'Optional', readiness.optional, colors, 'optional');
}
