/**
 * Capability + skills policy implementations.
 *
 * The plugin ships two ready-to-use policies plus the building blocks for
 * a custom one:
 *
 *   - {@link StaticCapabilityChecker} — fixed allowlist of scopes
 *   - {@link DenyUnlessScopedSkillsPolicy} — default SKILLS.md gate
 *
 * Both implementations are deliberately small and dependency-free; real
 * deployments will plug in an Arsenal-backed checker via the same
 * `CapabilityChecker` interface.
 */

import type {
  CapabilityChecker,
  ScopeDecision,
  SkillDecision,
  SkillEvaluationContext,
  SkillsPolicy,
} from './types.js';

/** Scope grammar for skill invocations. */
export const SKILL_SCOPE_PREFIX = 'skills:invoke:';

/** Scope grammar for tool invocations. */
export const TOOL_SCOPE_PREFIX = 'tools:invoke:';

/** Build the canonical scope string for a skill name. */
export function skillScope(name: string): string {
  return `${SKILL_SCOPE_PREFIX}${name}`;
}

/** Build the canonical scope string for a tool name. */
export function toolScope(name: string): string {
  return `${TOOL_SCOPE_PREFIX}${name}`;
}

/**
 * Capability checker backed by a fixed allowlist. Supports literal scopes
 * and one wildcard form: `prefix:*` matches anything starting with `prefix:`.
 *
 * Example: `tools:invoke:*` allows every tool, `skills:invoke:web.*`
 * allows every skill whose name starts with `web.`.
 */
export class StaticCapabilityChecker implements CapabilityChecker {
  private readonly literal: Set<string>;
  private readonly wildcards: readonly string[];

  constructor(scopes: Iterable<string>) {
    const literal = new Set<string>();
    const wildcards: string[] = [];
    for (const s of scopes) {
      if (s.endsWith('*')) wildcards.push(s.slice(0, -1));
      else literal.add(s);
    }
    this.literal = literal;
    this.wildcards = wildcards;
  }

  check(scope: string): ScopeDecision {
    if (this.literal.has(scope)) {
      return { allowed: true, matchedScope: scope };
    }
    for (const prefix of this.wildcards) {
      if (scope.startsWith(prefix)) {
        return { allowed: true, matchedScope: `${prefix}*` };
      }
    }
    return { allowed: false, reason: `No matching scope for ${scope}` };
  }
}

/**
 * Deny-unless-scoped skills policy.
 *
 * For a skill named `foo`, requires the agent to hold `skills:invoke:foo`
 * (or a wildcard that subsumes it). This is the default policy when the
 * caller passes `audit: true` without supplying their own.
 */
export class DenyUnlessScopedSkillsPolicy implements SkillsPolicy {
  async evaluate(
    skillName: string,
    ctx: SkillEvaluationContext,
  ): Promise<SkillDecision> {
    const required = skillScope(skillName);
    const decision = await Promise.resolve(ctx.capabilities.check(required));
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason ?? `Missing scope: ${required}`,
      };
    }
    const result: SkillDecision = { allowed: true };
    if (decision.matchedScope !== undefined) {
      result.matchedScope = decision.matchedScope;
    }
    return result;
  }
}

/**
 * Allow-listed skills policy: only the named skills are permitted, and the
 * agent must additionally hold the right scope.
 */
export class AllowListSkillsPolicy implements SkillsPolicy {
  private readonly allowed: Set<string>;
  private readonly inner: SkillsPolicy;

  constructor(allowedSkills: Iterable<string>, inner?: SkillsPolicy) {
    this.allowed = new Set(allowedSkills);
    this.inner = inner ?? new DenyUnlessScopedSkillsPolicy();
  }

  async evaluate(
    skillName: string,
    ctx: SkillEvaluationContext,
  ): Promise<SkillDecision> {
    if (!this.allowed.has(skillName)) {
      return { allowed: false, reason: `Skill not in allow-list: ${skillName}` };
    }
    return this.inner.evaluate(skillName, ctx);
  }
}

/**
 * Compose multiple policies — a skill is allowed only if every policy
 * allows it. Useful for stacking allow-list + scope + custom policies.
 */
export class CompositeSkillsPolicy implements SkillsPolicy {
  constructor(private readonly policies: readonly SkillsPolicy[]) {}

  async evaluate(
    skillName: string,
    ctx: SkillEvaluationContext,
  ): Promise<SkillDecision> {
    let lastMatched: string | undefined;
    for (const p of this.policies) {
      const d = await Promise.resolve(p.evaluate(skillName, ctx));
      if (!d.allowed) return d;
      if (d.matchedScope) lastMatched = d.matchedScope;
    }
    const result: SkillDecision = { allowed: true };
    if (lastMatched !== undefined) result.matchedScope = lastMatched;
    return result;
  }
}
