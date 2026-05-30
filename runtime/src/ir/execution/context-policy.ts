import type { ExecutionMode } from '../../types.ts';
import type { DirectiveIR, GovernanceIRBundle, SemanticRelationIR } from '../types.ts';

export interface DirectiveDecision {
  mode: ExecutionMode;
  reason: string;
  basis: 'prescription' | 'governance-graph' | 'verification' | 'task-context' | 'feedback' | 'anti-pattern';
  contextApplied: string[];
  contextRulesApplied: string[];
}

interface ContextExecutionRuleInput {
  directive: DirectiveIR;
  relations: SemanticRelationIR[];
  defaultDecision: DirectiveDecision;
  decision: DirectiveDecision;
  context: GovernanceIRBundle['task']['context'];
  hasTension: boolean;
}

interface ContextExecutionRuleResult {
  mode?: ExecutionMode;
  basis?: DirectiveDecision['basis'];
  reasonSuffix: string;
  contextApplied: string[];
}

interface ContextExecutionRule {
  id: string;
  field: string;
  effect: 'mode-adjustment' | 'review-priority' | 'ambienting';
  matches(input: ContextExecutionRuleInput): boolean;
  apply(input: ContextExecutionRuleInput): ContextExecutionRuleResult;
}

export function applyContextExecutionPolicy(input: {
  directive: DirectiveIR;
  relations: SemanticRelationIR[];
  defaultDecision: DirectiveDecision;
  context: GovernanceIRBundle['task']['context'];
}): DirectiveDecision {
  let decision = { ...input.defaultDecision, contextApplied: [...input.defaultDecision.contextApplied], contextRulesApplied: [...input.defaultDecision.contextRulesApplied] };
  const hasTension = input.relations.some((relation) => relation.adjudication.finalRelation === 'tension');

  for (const rule of CONTEXT_EXECUTION_RULES) {
    const ruleInput = { ...input, decision, hasTension };
    if (!rule.matches(ruleInput)) continue;
    const result = rule.apply(ruleInput);
    decision = {
      ...decision,
      mode: result.mode ?? decision.mode,
      basis: result.basis ?? decision.basis,
      reason: `${decision.reason} ${result.reasonSuffix}`,
      contextApplied: unique([...decision.contextApplied, ...result.contextApplied]),
      contextRulesApplied: unique([...decision.contextRulesApplied, rule.id]),
    };
  }

  return {
    ...decision,
    contextApplied: unique(decision.contextApplied),
    contextRulesApplied: unique(decision.contextRulesApplied),
  };
}

export function contextInfluenceEffect(context: string, mode: ExecutionMode): string {
  if (context.startsWith('optimization_target:')) return `adjusted execution to ${mode} for the task optimization target`;
  if (context.startsWith('hard_constraints:')) return `adjusted execution to ${mode} for explicit task constraints`;
  if (context.startsWith('allowed_tradeoffs:')) return `adjusted execution to ${mode} for allowed task tradeoffs`;
  if (context.startsWith('avoid:')) return `adjusted execution to ${mode} for task avoidance guidance`;
  if (context.startsWith('risk_level:')) return `raised execution or review attention to ${mode} for task risk`;
  if (context.startsWith('scope_size:')) return `adjusted execution to ${mode} for task scope size`;
  if (context.startsWith('compatibility_requirement:')) return `adjusted execution to ${mode} for compatibility requirements`;
  if (context.startsWith('interface_sensitivity:')) return `raised review attention while resolving execution to ${mode} for sensitive interfaces`;
  if (context.startsWith('refactor_tolerance:')) return `adjusted execution to ${mode} for refactor tolerance`;
  if (context.startsWith('migration_phase:')) return `adjusted execution to ${mode} for migration phase`;
  if (context.startsWith('review_goal:')) return `raised review attention while resolving execution to ${mode} for review goal`;
  if (context.startsWith('feedback:')) return `recorded feedback influence while resolving execution to ${mode}`;
  return `adjusted execution to ${mode} for task context`;
}

export function contextReviewPriorityBoost(contextApplied: string[]): 'critical' | 'high' | null {
  if (contextApplied.includes('risk_level:critical') || contextApplied.includes('interface_sensitivity:auth-security')) return 'critical';
  if (
    contextApplied.includes('risk_level:high')
    || contextApplied.some((context) => context.startsWith('compatibility_requirement:') && !context.endsWith(':none'))
    || contextApplied.some((context) => context.startsWith('interface_sensitivity:') && !context.endsWith(':internal') && !context.endsWith(':unknown'))
    || contextApplied.includes('migration_phase:dual-run')
    || contextApplied.includes('migration_phase:cutover')
  ) return 'high';
  return null;
}

const CONTEXT_EXECUTION_RULES: ContextExecutionRule[] = [
  {
    id: 'context.safety.promote-compatible-should',
    field: 'optimization_target',
    effect: 'mode-adjustment',
    matches: ({ context, directive, defaultDecision, hasTension }) =>
      context.optimization_target === 'safety'
      && directive.prescription === 'should'
      && defaultDecision.mode === 'ambient'
      && hasTension
      && isCompatibilitySensitiveDirective(directive),
    apply: () => ({
      mode: 'deviation-noted',
      basis: 'task-context',
      reasonSuffix: 'Safety-focused context promotes compatibility-sensitive guidance from ambient to deviation-noted when repository reality conflicts with it.',
      contextApplied: ['optimization_target:safety'],
    }),
  },
  {
    id: 'context.safety.preserve-must-deviation',
    field: 'optimization_target',
    effect: 'review-priority',
    matches: ({ context, directive, defaultDecision }) =>
      context.optimization_target === 'safety'
      && directive.prescription === 'must'
      && defaultDecision.mode === 'deviation-noted',
    apply: () => ({
      basis: 'task-context',
      reasonSuffix: 'Safety-focused context preserves stricter enforcement intent even though repository compatibility still requires a deviation-noted posture.',
      contextApplied: ['optimization_target:safety'],
    }),
  },
  {
    id: 'context.compatibility.must-with-tension',
    field: 'compatibility_requirement',
    effect: 'mode-adjustment',
    matches: ({ context, directive, decision, hasTension }) =>
      (hasConstraint(context.hard_constraints, ['preserve compatibility', 'avoid breaking changes', 'preserve public api'])
        || hasCompatibilityRequirement(context))
      && directive.prescription === 'must'
      && decision.mode === 'enforce'
      && hasTension,
    apply: ({ context }) => ({
      mode: 'deviation-noted',
      basis: 'task-context',
      reasonSuffix: 'Explicit compatibility constraints shift execution to deviation-noted because legacy or migration realities must be preserved at touched interfaces.',
      contextApplied: [context.compatibility_requirement !== 'none' ? `compatibility_requirement:${context.compatibility_requirement}` : 'hard_constraints:compatibility'],
    }),
  },
  {
    id: 'context.scope.keep-broad-guidance-ambient',
    field: 'scope_size',
    effect: 'ambienting',
    matches: ({ context, directive }) =>
      (hasConstraint(context.allowed_tradeoffs, ['prefer narrow change scope'])
        || context.scope_size === 'single-file'
        || context.refactor_tolerance === 'none'
        || context.refactor_tolerance === 'local-only')
      && directive.prescription === 'should'
      && directive.traits.broadScope,
    apply: ({ context }) => ({
      mode: 'ambient',
      basis: 'task-context',
      reasonSuffix: 'Narrow-scope tradeoff guidance keeps broad architectural guidance ambient for this task.',
      contextApplied: [
        ...(hasConstraint(context.allowed_tradeoffs, ['prefer narrow change scope']) ? ['allowed_tradeoffs:prefer narrow change scope'] : []),
        ...(context.scope_size === 'single-file' ? ['scope_size:single-file'] : []),
        ...(context.refactor_tolerance === 'none' || context.refactor_tolerance === 'local-only' ? [`refactor_tolerance:${context.refactor_tolerance}`] : []),
      ],
    }),
  },
  {
    id: 'context.avoid.keep-broad-rewrite-ambient',
    field: 'avoid',
    effect: 'ambienting',
    matches: ({ context, directive }) =>
      hasConstraint(context.avoid, ['broad rewrites', 'overengineering'])
      && directive.prescription === 'should'
      && directive.traits.broadScope,
    apply: () => ({
      mode: 'ambient',
      basis: 'task-context',
      reasonSuffix: 'Avoiding broad rewrites or overengineering keeps expansive guidance ambient unless it is already a must-level requirement.',
      contextApplied: ['avoid:broad rewrites'],
    }),
  },
  {
    id: 'context.compatibility.promote-compatible-should',
    field: 'compatibility_requirement',
    effect: 'mode-adjustment',
    matches: ({ context, directive, defaultDecision, hasTension }) =>
      hasCompatibilityRequirement(context)
      && directive.prescription === 'should'
      && defaultDecision.mode === 'ambient'
      && hasTension
      && isCompatibilitySensitiveDirective(directive),
    apply: ({ context }) => ({
      mode: 'deviation-noted',
      basis: 'task-context',
      reasonSuffix: 'Compatibility requirements promote compatible should-level guidance to deviation-noted when verified repository tension exists.',
      contextApplied: [`compatibility_requirement:${context.compatibility_requirement}`],
    }),
  },
  {
    id: 'context.risk.raise-review-attention',
    field: 'risk_level',
    effect: 'review-priority',
    matches: ({ context, directive, decision }) =>
      isHighRisk(context)
      && (directive.prescription === 'must' || directive.traits.safetyCritical || decision.mode === 'deviation-noted')
      && decision.mode !== 'suppress',
    apply: ({ context, decision }) => ({
      basis: decision.basis === 'prescription' ? 'task-context' : decision.basis,
      reasonSuffix: 'High-risk context keeps this directive prominent for execution and review.',
      contextApplied: [`risk_level:${context.risk_level}`],
    }),
  },
  {
    id: 'context.interface.raise-review-attention',
    field: 'interface_sensitivity',
    effect: 'review-priority',
    matches: ({ context, directive, decision }) =>
      isSensitiveInterface(context)
      && (directive.prescription === 'must' || isCompatibilitySensitiveDirective(directive))
      && decision.mode !== 'suppress',
    apply: ({ context, decision }) => ({
      basis: decision.basis === 'prescription' ? 'task-context' : decision.basis,
      reasonSuffix: 'Sensitive interface context raises review attention for this directive.',
      contextApplied: [`interface_sensitivity:${context.interface_sensitivity}`],
    }),
  },
  {
    id: 'context.migration.keep-boundary-tension-explicit',
    field: 'migration_phase',
    effect: 'mode-adjustment',
    matches: ({ context, directive, decision, hasTension }) =>
      isMigrationExecutionPhase(context)
      && directive.traits.migrationSensitive
      && hasTension
      && decision.mode !== 'suppress',
    apply: ({ context, directive }) => ({
      mode: directive.prescription === 'must' ? 'deviation-noted' : undefined,
      basis: 'task-context',
      reasonSuffix: 'Migration phase context keeps migration-boundary tension explicit for this task.',
      contextApplied: [`migration_phase:${context.migration_phase}`],
    }),
  },
];

function isCompatibilitySensitiveDirective(directive: DirectiveIR): boolean {
  return directive.traits.compatibilitySensitive || directive.traits.rcclImmune || directive.prescription === 'must';
}

function hasConstraint(values: string[], expected: string[]): boolean {
  return expected.some((item) => values.includes(item));
}

function hasCompatibilityRequirement(context: GovernanceIRBundle['task']['context']): boolean {
  return context.compatibility_requirement === 'preserve-api'
    || context.compatibility_requirement === 'preserve-behavior'
    || context.compatibility_requirement === 'migration-compatible';
}

function isHighRisk(context: GovernanceIRBundle['task']['context']): boolean {
  return context.risk_level === 'high' || context.risk_level === 'critical';
}

function isSensitiveInterface(context: GovernanceIRBundle['task']['context']): boolean {
  return context.interface_sensitivity === 'public-api'
    || context.interface_sensitivity === 'persistence'
    || context.interface_sensitivity === 'external-integration'
    || context.interface_sensitivity === 'auth-security';
}

function isMigrationExecutionPhase(context: GovernanceIRBundle['task']['context']): boolean {
  return context.migration_phase === 'dual-run' || context.migration_phase === 'cutover';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
