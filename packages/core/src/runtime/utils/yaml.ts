import YAML from 'yaml';

export function parseYaml(text: string): unknown {
  return YAML.parse(text);
}

export function toYaml(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 0 });
}
