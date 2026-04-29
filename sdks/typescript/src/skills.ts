/**
 * Skills policy — lightweight allow/deny checks on named agent skills.
 *
 * Each agent carries a set of skills it is permitted to invoke. The
 * {@link SkillsPolicy} interface is intentionally small because the full
 * policy implementation (matchers, quotas, approval flows) lives in a
 * separate `skills-policy` package that the OpenAgent SDK wraps.
 *
 * This file ships a correct in-memory implementation
 * ({@link InMemorySkillsPolicy}) that covers 80% of real usage and can be
 * swapped for the full policy package later.
 */

import { SkillDeniedError } from './errors.js';

/** A skill identifier such as `frontend-design` or `sql-query`. */
export type SkillId = string;

/** The minimum contract the OpenAgent SDK expects from a skills policy. */
export interface SkillsPolicy {
  /** Return true if the agent may invoke `skill`. */
  canInvoke(skill: SkillId): boolean;

  /** Throw a {@link SkillDeniedError} if `skill` is not allowed. */
  assertCanInvoke(skill: SkillId): void;

  /** List all skills the agent is currently permitted to invoke. */
  listAllowed(): readonly SkillId[];

  /** Produce a new policy with an additional skill. */
  grant(skill: SkillId): SkillsPolicy;

  /** Produce a new policy without `skill`. */
  revoke(skill: SkillId): SkillsPolicy;
}

/**
 * In-memory, immutable skills policy. Every mutation returns a new instance.
 *
 * Supports two match modes:
 *  - Exact: `frontend-design` matches only `frontend-design`
 *  - Wildcard suffix: `frontend-*` matches `frontend-design`, `frontend-test`, ...
 */
export class InMemorySkillsPolicy implements SkillsPolicy {
  private readonly skills: ReadonlySet<SkillId>;

  constructor(skills: readonly SkillId[] = []) {
    this.skills = new Set(skills);
  }

  canInvoke(skill: SkillId): boolean {
    if (this.skills.has(skill)) return true;
    // Check wildcard patterns like `frontend-*`.
    for (const allowed of this.skills) {
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1);
        if (skill.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  assertCanInvoke(skill: SkillId): void {
    if (!this.canInvoke(skill)) {
      throw new SkillDeniedError(skill, `Skill not permitted: ${skill}`, {
        allowed: [...this.skills],
      });
    }
  }

  listAllowed(): readonly SkillId[] {
    return [...this.skills];
  }

  grant(skill: SkillId): SkillsPolicy {
    if (this.skills.has(skill)) return this;
    return new InMemorySkillsPolicy([...this.skills, skill]);
  }

  revoke(skill: SkillId): SkillsPolicy {
    if (!this.skills.has(skill)) return this;
    return new InMemorySkillsPolicy([...this.skills].filter((s) => s !== skill));
  }
}

/** Empty policy that denies everything. */
export const denyAllSkills: SkillsPolicy = new InMemorySkillsPolicy([]);

/** Policy that allows any skill (dangerous — use only in tests). */
export const allowAllSkills: SkillsPolicy = new InMemorySkillsPolicy(['*']);
