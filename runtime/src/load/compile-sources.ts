import { discoverBuiltinLayers, loadDirectiveFile, loadLocalPlaybook, resolveExtendedLayers } from './load-playbook.ts';
import { loadRccl } from './load-rccl.ts';
import { verifyRcclDocumentWithSummary } from '../verify/verify-rccl.ts';
import type {
  CompileInputBase,
  Directive,
  LocalPlaybook,
  RcclDocument,
  ResolvedTaskOutput,
  RuntimeRcclVerificationSummary,
} from '../types.ts';

export interface CompileSources {
  builtinLayers: Map<string, string>;
  local: LocalPlaybook | null;
  selectedLayerIds: string[];
  builtinDirectives: Directive[];
  allDirectives: Directive[];
  rccl: RcclDocument | null;
  rcclVerificationSummary?: RuntimeRcclVerificationSummary;
}

export async function loadCompileSources(input: CompileInputBase & { resolvedTask?: ResolvedTaskOutput }): Promise<CompileSources> {
  const builtinLayers = discoverBuiltinLayers(input.builtinRoot);
  const local = loadLocalPlaybook(input.localAugmentPath);
  const selectedLayerIds = local?.meta.extends.length
    ? resolveExtendedLayers(local.meta.extends, builtinLayers)
    : ['builtin/core'];
  const builtinDirectives = selectedLayerIds.flatMap((layerId) => {
    const filePath = builtinLayers.get(layerId);
    return filePath ? loadDirectiveFile(filePath, layerId) : [];
  });
  const loadedSources: CompileSources = {
    builtinLayers,
    local,
    selectedLayerIds,
    builtinDirectives,
    allDirectives: [...builtinDirectives, ...(local?.additions ?? [])],
    rccl: await loadRccl(input.rcclPath),
  };
  return verifyCompileSourcesRccl(input, loadedSources);
}

export async function loadOrVerifyCompileSources(
  input: CompileInputBase & { resolvedTask?: ResolvedTaskOutput },
  preloadedSources?: CompileSources,
): Promise<CompileSources> {
  return preloadedSources
    ? verifyCompileSourcesRccl(input, preloadedSources)
    : loadCompileSources(input);
}

export async function verifyCompileSourcesRccl(
  input: CompileInputBase & { resolvedTask?: ResolvedTaskOutput },
  sources: CompileSources,
): Promise<CompileSources> {
  if (!sources.rccl) {
    return {
      ...sources,
      rcclVerificationSummary: undefined,
    };
  }
  const verifiedRccl = await verifyRcclDocumentWithSummary(sources.rccl, {
    projectRoot: input.projectRoot,
    resolvedTask: input.resolvedTask,
    policy: input.verificationPolicy ?? 'task-relevant',
  });
  return {
    ...sources,
    rccl: verifiedRccl.document,
    rcclVerificationSummary: verifiedRccl.summary,
  };
}
