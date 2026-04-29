/**
 * @openagent/skills-policy
 *
 * Governance for agent skills.
 *
 * This package is a specialized Arsenal policy layer. It gates which
 * `SKILLS.md` entries an agent may invoke and enforces rate limits, JSON
 * Schema argument constraints, time windows, HITL consent, and a
 * hash-chained audit log.
 *
 * ```ts
 * import { Did, InvocationContext, SkillsPolicy } from "@openagent/skills-policy";
 *
 * const policy = SkillsPolicy.fromYaml(`
 * version: 1
 * agent: did:oas:l1fe:agent:my-bot
 * skills:
 *   frontend-design:
 *     allow: true
 *     rate_limit: { window: 1h, max: 10 }
 * default:
 *   allow: false
 * `);
 *
 * const ctx = new InvocationContext({
 *   agentDid: Did.parse("did:oas:l1fe:agent:my-bot"),
 *   sessionId: "sess-42",
 *   arguments: { component: "Button" },
 * });
 *
 * const receipt = policy.recordInvocation("frontend-design", ctx);
 * ```
 */

export { AuditChain, type Receipt, HASH_LEN } from "./audit.js";
export { Did } from "./did.js";
export { InvocationContext, SkillsPolicy } from "./engine.js";
export {
  ArgumentConstraintError,
  ConsentRequiredError,
  InvalidPolicyError,
  InvalidSkillsMarkdownError,
  NotAllowedError,
  OutsideTimeWindowError,
  RateLimitExceededError,
  SkillsPolicyError,
} from "./errors.js";
export { RateLimiter, type RateLimitDecision } from "./rate.js";
export {
  type AuditLevel,
  CURRENT_VERSION,
  type DefaultRule,
  MAX_SKILL_RULES,
  type RateLimit,
  type SkillRule,
  type SkillsPolicyDoc,
  type TimeWindow,
} from "./schema.js";
export { type SkillEntry, SkillsManifest } from "./skillsMd.js";
