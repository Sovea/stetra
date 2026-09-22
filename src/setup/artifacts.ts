export interface InstallArtifact {
  path: string;
  content: string;
  kind: 'file' | 'hook' | 'block';
  event?: string;
  markers?: { start: string; end: string };
}
