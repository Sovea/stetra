import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ZodError } from 'zod';
import { MemoryStore } from './knowledge/store.js';
import { ContextService } from './context/service.js';
import type { ContextInput } from './context/types.js';
import { memoryRequestSchema, type OperationName } from './operations.js';
import { StetraError } from './shared.js';

export function projectPath(path: string): string {
  if (!isAbsolute(path)) throw new StetraError('invalid', 'projectRoot must be an absolute directory path.');
  try {
    const resolved = realpathSync(path);
    if (!statSync(resolved).isDirectory()) throw new Error('Not a directory');
    return resolved;
  } catch { throw new StetraError('invalid', 'projectRoot must refer to an existing directory.'); }
}

export function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof StetraError) return { code: error.code, message: error.message };
  if (error instanceof ZodError) return { code: 'invalid', message: error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') };
  return { code: 'storage', message: error instanceof Error ? error.message : 'An unexpected error occurred.' };
}

export class Workspace {
  readonly root: string;
  readonly memories: MemoryStore;
  private readonly contexts: ContextService;

  constructor(root: string) {
    this.root = projectPath(root);
    this.memories = new MemoryStore(this.root);
    this.contexts = new ContextService(this.root, this.memories);
  }

  context(input: ContextInput = {}, maxBytes?: number) { return this.contexts.read(input, maxBytes); }

  async execute(operation: OperationName, input: unknown): Promise<unknown> {
    if (operation !== 'memory') throw new StetraError('invalid', 'Unknown operation. Use memory.');
    const request = memoryRequestSchema.parse(input);
    switch (request.action) {
      case 'list': return this.memories.list({ includeWithdrawn: request.includeWithdrawn, allScopes: request.allScopes });
      case 'read': return this.memories.get(request.memoryId);
      case 'search': { const { action: _action, ...options } = request; return this.memories.search(options); }
      case 'recall': { const { action: _action, ...options } = request; return this.memories.recall(options); }
      case 'create': return this.memories.create(request.memory);
      case 'update': return this.memories.update(request.memoryId, request.expectedRevision, request.memory);
      case 'delete': await this.memories.delete(request.memoryId, request.expectedRevision); return { deleted: request.memoryId };
    }
  }
}
