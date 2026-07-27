import { z } from 'zod';

export const HostAdapterSchema = z.enum(['codex', 'claude']);

export const ManifestArtifactSchema = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(['file', 'managed-block']),
  templateRevision: z.number().int().positive(),
  generatedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const ProjectManifestSchema = z.strictObject({
  schemaVersion: z.string(),
  generatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  protocolVersion: z.string(),
  adapters: z.array(HostAdapterSchema),
  artifacts: z.array(ManifestArtifactSchema),
}).superRefine((manifest, context) => {
  const adapters = new Set<string>();
  for (const [index, adapter] of manifest.adapters.entries()) {
    if (adapters.has(adapter)) {
      context.addIssue({
        code: 'custom',
        path: ['adapters', index],
        message: `duplicate adapter ${adapter}`,
      });
    }
    adapters.add(adapter);
  }

  const artifacts = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const key = `${artifact.kind}:${artifact.path}`;
    if (artifacts.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts', index],
        message: `duplicate managed artifact ${artifact.path}`,
      });
    }
    artifacts.add(key);
  }
});

export type ManifestArtifact = z.infer<typeof ManifestArtifactSchema>;
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
