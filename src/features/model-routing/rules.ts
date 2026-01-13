/**
 * Routing Rules
 *
 * Defines the rules engine for model routing decisions.
 * Rules are evaluated in priority order, and the first matching rule wins.
 */

import type {
  RoutingRule,
  RoutingContext,
  ComplexitySignals,
  ComplexityTier,
} from './types.js';

/**
 * Default routing rules, ordered by priority (highest first)
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // ============ Override Rules (Highest Priority) ============

  {
    name: 'explicit-model-specified',
    condition: (ctx) => ctx.explicitModel !== undefined,
    action: { tier: 'EXPLICIT' as any, reason: 'User specified model explicitly' },
    priority: 100,
  },

  // NOTE: Escalation is handled by routeWithEscalation(), not in rules
  // This allows gradual escalation: LOW → MEDIUM → HIGH

  // ============ Agent-Based Rules ============

  {
    name: 'advisor-agents-oracle',
    condition: (ctx) => ctx.agentType === 'oracle',
    action: { tier: 'HIGH', reason: 'Oracle requires deep reasoning for architecture/debugging' },
    priority: 80,
  },

  {
    name: 'advisor-agents-prometheus',
    condition: (ctx) => ctx.agentType === 'prometheus',
    action: { tier: 'HIGH', reason: 'Prometheus requires strategic planning capabilities' },
    priority: 80,
  },

  {
    name: 'advisor-agents-momus',
    condition: (ctx) => ctx.agentType === 'momus',
    action: { tier: 'HIGH', reason: 'Momus requires critical evaluation capabilities' },
    priority: 80,
  },

  {
    name: 'advisor-agents-metis',
    condition: (ctx) => ctx.agentType === 'metis',
    action: { tier: 'HIGH', reason: 'Metis requires pre-planning analysis capabilities' },
    priority: 80,
  },

  {
    name: 'exploration-agent',
    condition: (ctx) => ctx.agentType === 'explore',
    action: { tier: 'LOW', reason: 'Exploration is search-focused, optimized for speed' },
    priority: 80,
  },

  {
    name: 'document-writer-agent',
    condition: (ctx) => ctx.agentType === 'document-writer',
    action: { tier: 'LOW', reason: 'Documentation is straightforward, optimized for speed' },
    priority: 80,
  },

  // ============ Task-Based Rules ============

  {
    name: 'architecture-system-wide',
    condition: (ctx, signals) =>
      signals.lexical.hasArchitectureKeywords &&
      signals.structural.impactScope === 'system-wide',
    action: { tier: 'HIGH', reason: 'Architectural decisions with system-wide impact' },
    priority: 70,
  },

  {
    name: 'security-domain',
    condition: (ctx, signals) =>
      signals.structural.domainSpecificity === 'security',
    action: { tier: 'HIGH', reason: 'Security-related tasks require careful reasoning' },
    priority: 70,
  },

  {
    name: 'difficult-reversibility-risk',
    condition: (ctx, signals) =>
      signals.structural.reversibility === 'difficult' &&
      signals.lexical.hasRiskKeywords,
    action: { tier: 'HIGH', reason: 'High-risk, difficult-to-reverse changes' },
    priority: 70,
  },

  {
    name: 'deep-debugging',
    condition: (ctx, signals) =>
      signals.lexical.hasDebuggingKeywords &&
      signals.lexical.questionDepth === 'why',
    action: { tier: 'HIGH', reason: 'Root cause analysis requires deep reasoning' },
    priority: 65,
  },

  {
    name: 'complex-multi-step',
    condition: (ctx, signals) =>
      signals.structural.estimatedSubtasks > 5 &&
      signals.structural.crossFileDependencies,
    action: { tier: 'HIGH', reason: 'Complex multi-step task with cross-file changes' },
    priority: 60,
  },

  {
    name: 'simple-search-query',
    condition: (ctx, signals) =>
      signals.lexical.hasSimpleKeywords &&
      signals.structural.estimatedSubtasks <= 1 &&
      signals.structural.impactScope === 'local' &&
      !signals.lexical.hasArchitectureKeywords &&
      !signals.lexical.hasDebuggingKeywords,
    action: { tier: 'LOW', reason: 'Simple search or lookup task' },
    priority: 60,
  },

  {
    name: 'short-local-change',
    condition: (ctx, signals) =>
      signals.lexical.wordCount < 50 &&
      signals.structural.impactScope === 'local' &&
      signals.structural.reversibility === 'easy' &&
      !signals.lexical.hasRiskKeywords,
    action: { tier: 'LOW', reason: 'Short, local, easily reversible change' },
    priority: 55,
  },

  {
    name: 'moderate-complexity',
    condition: (ctx, signals) =>
      signals.structural.estimatedSubtasks > 1 &&
      signals.structural.estimatedSubtasks <= 5,
    action: { tier: 'MEDIUM', reason: 'Moderate complexity with multiple subtasks' },
    priority: 50,
  },

  {
    name: 'module-level-work',
    condition: (ctx, signals) =>
      signals.structural.impactScope === 'module',
    action: { tier: 'MEDIUM', reason: 'Module-level changes' },
    priority: 45,
  },

  // ============ Default Rule ============

  {
    name: 'default-medium',
    condition: () => true,
    action: { tier: 'MEDIUM', reason: 'Default tier for unclassified tasks' },
    priority: 0,
  },
];

/**
 * Evaluate routing rules and return the first matching rule's action
 */
export function evaluateRules(
  context: RoutingContext,
  signals: ComplexitySignals,
  rules: RoutingRule[] = DEFAULT_ROUTING_RULES
): { tier: ComplexityTier | 'EXPLICIT'; reason: string; ruleName: string } {
  // Sort rules by priority (highest first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (rule.condition(context, signals)) {
      return {
        tier: rule.action.tier,
        reason: rule.action.reason,
        ruleName: rule.name,
      };
    }
  }

  // Should never reach here due to default rule, but just in case
  return {
    tier: 'MEDIUM',
    reason: 'Fallback to medium tier',
    ruleName: 'fallback',
  };
}

/**
 * Get all rules that would match for a given context (for debugging)
 */
export function getMatchingRules(
  context: RoutingContext,
  signals: ComplexitySignals,
  rules: RoutingRule[] = DEFAULT_ROUTING_RULES
): RoutingRule[] {
  return rules.filter(rule => rule.condition(context, signals));
}

/**
 * Create a custom routing rule
 */
export function createRule(
  name: string,
  condition: (context: RoutingContext, signals: ComplexitySignals) => boolean,
  tier: ComplexityTier,
  reason: string,
  priority: number
): RoutingRule {
  return {
    name,
    condition,
    action: { tier, reason },
    priority,
  };
}

/**
 * Merge custom rules with default rules
 */
export function mergeRules(customRules: RoutingRule[]): RoutingRule[] {
  // Custom rules override defaults with the same name
  const customNames = new Set(customRules.map(r => r.name));
  const filteredDefaults = DEFAULT_ROUTING_RULES.filter(
    r => !customNames.has(r.name)
  );
  return [...customRules, ...filteredDefaults];
}
