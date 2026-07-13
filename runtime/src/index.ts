/**
 * resonant-code Runtime v1 public lifecycle.
 *
 * Everything else is deliberately internal: host agents submit raw v1 artifacts
 * to these entrypoints and Runtime owns validation, normalization, adjudication,
 * tracing, and feedback writes.
 */
export { planGuidance } from './plan-guidance.ts';
export { compile } from './compile.ts';
export { evaluateGuidance } from './feedback.ts';

export type {
  PublicCompileInput as CompileInput,
  CompileOutput,
  PublicEvaluateInput as EvaluateInput,
  EvaluateOutput,
  GuidancePlan,
  GuidancePlanInput,
} from './types.ts';
