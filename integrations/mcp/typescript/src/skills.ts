/**
 * Skills policy support for @openagentid/mcp.
 *
 * MCP tools and SKILLS.md entries describe the same thing: a capability
 * an agent can invoke. When an MCP server exposes a tool that proxies
 * skill invocation (typically named `invoke_skill` or any name a host
 * application configures), the middleware consults a skills policy
 * before allowing the call. This file provides the helper that picks the
 * right policy for a given call and a small built-in store implementation
 * suitable for tests and reference implementations.
 */

import { SkillsPolicyDecision, SkillsPolicyHook } from './types.js';

/**
 * Tool name prefixes that the middleware treats as skill-like by default.
 * Host applications can override the matcher entirely via
 * {@link createSkillsPolicy}.
 */
export const DEFAULT_SKILL_TOOL_NAMES: ReadonlyArray<string> = [
  'invoke_skill',
  'run_skill',
  'execute_skill',
  'skill.invoke',
  'skill.run',
];

/**
 * A single rule describing whether a `(skillName, did)` pair is allowed.
 * `null` for `dids` means "any verified caller". An empty array means
 * "no caller".
 */
export interface SkillsRule {
  skillName: string;
  /** DIDs allowed to invoke this skill, or `null` for any. */
  dids: ReadonlyArray<string> | null;
  /** Optional reason emitted when the rule denies a call. */
  reason?: string;
}

/**
 * Policy store interface — implementations may be in-memory, file-backed
 * by `SKILLS.md`, or fetched from a remote service.
 */
export interface SkillsPolicyStore {
  lookup(skillName: string): Promise<SkillsRule | null> | SkillsRule | null;
}

/**
 * Trivial in-memory store useful in tests and as a starting point for
 * production stores.
 */
export class InMemorySkillsPolicyStore implements SkillsPolicyStore {
  private readonly rules: Map<string, SkillsRule>;

  constructor(rules: ReadonlyArray<SkillsRule> = []) {
    this.rules = new Map(rules.map((rule) => [rule.skillName, rule]));
  }

  lookup(skillName: string): SkillsRule | null {
    return this.rules.get(skillName) ?? null;
  }

  /** Returns a NEW store with the given rule applied (immutable update). */
  withRule(rule: SkillsRule): InMemorySkillsPolicyStore {
    const next = new Map(this.rules);
    next.set(rule.skillName, rule);
    return new InMemorySkillsPolicyStore([...next.values()]);
  }
}

export interface CreateSkillsPolicyOptions {
  /** The store backing skill lookups. */
  store: SkillsPolicyStore;
  /**
   * Returns true when a tool call should be checked against the skills
   * policy. Defaults to matching the tool name against
   * {@link DEFAULT_SKILL_TOOL_NAMES}.
   */
  isSkillTool?: (toolName: string) => boolean;
  /**
   * Extracts the skill name from the tool's arguments. Defaults to
   * reading `args.skill` or `args.skillName`.
   */
  extractSkillName?: (args: unknown) => string | null;
  /**
   * Default decision when no rule matches. Defaults to `{ allow: true }`
   * to keep non-skill tools unaffected.
   */
  defaultDecision?: SkillsPolicyDecision;
}

/**
 * Build a {@link SkillsPolicyHook} from a store and matching options.
 *
 * The returned hook always allows tools that are not skill-like; it only
 * consults the store when {@link CreateSkillsPolicyOptions.isSkillTool}
 * returns true.
 */
export function createSkillsPolicy(
  options: CreateSkillsPolicyOptions,
): SkillsPolicyHook {
  const isSkillTool =
    options.isSkillTool ??
    ((toolName: string) => DEFAULT_SKILL_TOOL_NAMES.includes(toolName));
  const extractSkillName =
    options.extractSkillName ?? defaultExtractSkillName;
  const defaultDecision: SkillsPolicyDecision = options.defaultDecision ?? {
    allow: true,
  };

  return async ({
    toolName,
    args,
    identity,
  }): Promise<SkillsPolicyDecision> => {
    if (!isSkillTool(toolName)) {
      return defaultDecision;
    }

    const skillName = extractSkillName(args);
    if (skillName === null) {
      return {
        allow: false,
        reason: `Skill tool '${toolName}' invoked without a skill name`,
      };
    }

    const rule = await Promise.resolve(options.store.lookup(skillName));
    if (rule === null) {
      return {
        allow: false,
        reason: `No policy entry for skill '${skillName}'`,
      };
    }

    if (rule.dids === null) {
      return { allow: true };
    }

    if (rule.dids.includes(identity.did)) {
      return { allow: true };
    }

    return {
      allow: false,
      reason:
        rule.reason ??
        `DID '${identity.did}' is not authorized for skill '${skillName}'`,
    };
  };
}

function defaultExtractSkillName(args: unknown): string | null {
  if (args === null || typeof args !== 'object') {
    return null;
  }
  const record = args as Record<string, unknown>;
  const skill = record['skill'];
  if (typeof skill === 'string' && skill.length > 0) {
    return skill;
  }
  const skillName = record['skillName'];
  if (typeof skillName === 'string' && skillName.length > 0) {
    return skillName;
  }
  return null;
}

/**
 * Compose two skills policy hooks. The combined hook denies if either
 * underlying hook denies; allow decisions from `first` are forwarded to
 * `second`.
 */
export function combineSkillsPolicies(
  first: SkillsPolicyHook,
  second: SkillsPolicyHook,
): SkillsPolicyHook {
  return async (input): Promise<SkillsPolicyDecision> => {
    const a = await Promise.resolve(first(input));
    if (!a.allow) {
      return a;
    }
    return Promise.resolve(second(input));
  };
}

/** Re-exported for convenience. */
export type {
  SkillsPolicyHook,
  SkillsPolicyDecision,
  VerifiedIdentity,
} from './types.js';
