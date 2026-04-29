/**
 * The `SkillsPolicy` engine — TypeScript mirror of the Rust `engine` module.
 *
 * This is the type agents and runtimes interact with. It owns:
 *
 * - The parsed policy document
 * - A per-skill GCRA rate limiter
 * - The hash-chained audit log
 * - A compiled cache of Ajv schema validators
 */

import { readFile } from "node:fs/promises";

import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

import { AuditChain, type Receipt } from "./audit.js";
import { Did } from "./did.js";
import { parseDurationSeconds } from "./duration.js";
import {
  ArgumentConstraintError,
  ConsentRequiredError,
  InvalidPolicyError,
  NotAllowedError,
  OutsideTimeWindowError,
  RateLimitExceededError,
  SkillsPolicyError,
} from "./errors.js";
import { RateLimiter } from "./rate.js";
import {
  type AuditLevel,
  CURRENT_VERSION,
  type SkillRule,
  SkillsPolicyDocSchema,
  type SkillsPolicyDoc,
  type TimeWindow,
} from "./schema.js";

export interface InvocationContextInit {
  agentDid: Did;
  sessionId: string;
  arguments: unknown;
  invokedAt?: Date;
  consentGranted?: boolean;
}

/**
 * Context describing a single attempted skill invocation. Immutable;
 * builder-style helpers return new instances.
 */
export class InvocationContext {
  readonly agentDid: Did;
  readonly sessionId: string;
  readonly arguments: unknown;
  readonly invokedAt: Date;
  readonly consentGranted: boolean;

  constructor(init: InvocationContextInit) {
    this.agentDid = init.agentDid;
    this.sessionId = init.sessionId;
    this.arguments = init.arguments;
    this.invokedAt = init.invokedAt ?? new Date();
    this.consentGranted = init.consentGranted ?? false;
  }

  withConsent(): InvocationContext {
    return new InvocationContext({
      agentDid: this.agentDid,
      sessionId: this.sessionId,
      arguments: this.arguments,
      invokedAt: this.invokedAt,
      consentGranted: true,
    });
  }

  withInvokedAt(invokedAt: Date): InvocationContext {
    return new InvocationContext({
      agentDid: this.agentDid,
      sessionId: this.sessionId,
      arguments: this.arguments,
      invokedAt,
      consentGranted: this.consentGranted,
    });
  }
}

export class SkillsPolicy {
  private readonly doc: SkillsPolicyDoc;
  private readonly agentDid: Did;
  private readonly limiter = new RateLimiter();
  private readonly chain = new AuditChain();
  private readonly schemas = new Map<string, ValidateFunction>();

  private constructor(doc: SkillsPolicyDoc) {
    this.doc = doc;
    this.agentDid = Did.parse(doc.agent);
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(ajv);
    for (const [name, rule] of Object.entries(doc.skills)) {
      if (rule.arg_constraints !== undefined) {
        try {
          const compiled = ajv.compile(rule.arg_constraints as AnySchema);
          this.schemas.set(name, compiled);
        } catch (err) {
          throw new InvalidPolicyError(
            `skill \`${name}\` has invalid JSON Schema: ${(err as Error).message}`,
          );
        }
      }
      if (rule.rate_limit) {
        try {
          parseDurationSeconds(rule.rate_limit.window);
        } catch (err) {
          throw new InvalidPolicyError(
            `skill \`${name}\` has invalid rate_limit.window: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  static fromYaml(yaml: string): SkillsPolicy {
    let raw: unknown;
    try {
      raw = parseYaml(yaml);
    } catch (err) {
      throw new InvalidPolicyError(
        `YAML parse error: ${(err as Error).message}`,
      );
    }
    const result = SkillsPolicyDocSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidPolicyError(result.error.message);
    }
    const doc = result.data;
    if (doc.version !== CURRENT_VERSION) {
      throw new InvalidPolicyError(
        `unsupported policy version ${doc.version}; expected ${CURRENT_VERSION}`,
      );
    }
    return new SkillsPolicy(doc);
  }

  static async fromFile(path: string): Promise<SkillsPolicy> {
    const content = await readFile(path, "utf8");
    return SkillsPolicy.fromYaml(content);
  }

  agent(): Did {
    return this.agentDid;
  }

  hasRule(skill: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.doc.skills, skill);
  }

  auditChain(): AuditChain {
    return this.chain;
  }

  resetRateLimit(skill: string): void {
    this.limiter.reset(skill);
  }

  /**
   * Read-only check: can `ctx` invoke `skill` right now?
   *
   * Runs every policy dimension except the rate-limit *advance*. On failure
   * throws a specific `SkillsPolicyError` subclass.
   */
  canInvoke(skill: string, ctx: InvocationContext): void {
    if (!ctx.agentDid.equals(this.agentDid)) {
      throw new NotAllowedError(
        skill,
        `policy is bound to \`${this.agentDid.toString()}\`, got \`${ctx.agentDid.toString()}\``,
      );
    }

    const { rule, isDefault } = this.resolveRule(skill);

    if (!rule.allow) {
      const reason = isDefault
        ? "no matching rule and default.allow = false"
        : "rule has allow = false";
      throw new NotAllowedError(skill, reason);
    }

    if (rule.time_windows.length > 0 && !timeMatches(rule.time_windows, ctx.invokedAt)) {
      throw new OutsideTimeWindowError(skill);
    }

    if (rule.require_consent && !ctx.consentGranted) {
      throw new ConsentRequiredError(skill);
    }

    const validator = this.schemas.get(skill);
    if (validator) {
      const valid = validator(ctx.arguments);
      if (!valid) {
        const first = validator.errors?.[0];
        const details = first
          ? `${first.instancePath || "(root)"} ${first.message ?? "invalid"}`
          : "unknown violation";
        throw new ArgumentConstraintError(skill, details);
      }
    }
  }

  /**
   * Authorize and record an invocation.
   *
   * Runs `canInvoke`, then checks and advances the rate limiter, then
   * appends a `Receipt` to the hash-chained audit log. On any failure no
   * state changes.
   */
  recordInvocation(skill: string, ctx: InvocationContext): Receipt {
    this.canInvoke(skill, ctx);

    const { rule } = this.resolveRule(skill);

    if (rule.rate_limit) {
      const nowSecs = ctx.invokedAt.getTime() / 1000;
      const decision = this.limiter.checkAndRecord(
        skill,
        rule.rate_limit,
        nowSecs,
      );
      if (decision.kind === "denied") {
        let windowSecs = 0;
        try {
          windowSecs = parseDurationSeconds(rule.rate_limit.window);
        } catch {
          // unreachable — validated at construction.
        }
        throw new RateLimitExceededError(
          skill,
          decision.used,
          rule.rate_limit.max,
          windowSecs,
        );
      }
    }

    if (rule.audit_level === "none") {
      // Synthetic receipt: not persisted, returned so callers get a
      // stable shape. Matches the Rust behavior.
      const head = this.chain.head();
      return {
        sequence: Number.MAX_SAFE_INTEGER,
        skill,
        agent: ctx.agentDid.asString(),
        session: ctx.sessionId,
        invokedAt: ctx.invokedAt.toISOString(),
        auditLevel: "none",
        argumentsHash: "0".repeat(64),
        previousHash: head,
        receiptHash: head,
      };
    }

    return this.chain.append(
      skill,
      ctx.agentDid.asString(),
      ctx.sessionId,
      ctx.invokedAt,
      rule.audit_level,
      ctx.arguments,
    );
  }

  private resolveRule(skill: string): {
    rule: SkillRule;
    isDefault: boolean;
  } {
    const direct = this.doc.skills[skill];
    if (direct) return { rule: direct, isDefault: false };
    const defaultRule: SkillRule = {
      allow: this.doc.default.allow,
      rate_limit: undefined,
      arg_constraints: undefined,
      time_windows: [],
      require_consent: false,
      audit_level: this.doc.default.audit_level,
    };
    return { rule: defaultRule, isDefault: true };
  }
}

function timeMatches(windows: readonly TimeWindow[], at: Date): boolean {
  // Use UTC hours/weekdays to match the Rust implementation exactly.
  const hour = at.getUTCHours();
  // JS getUTCDay: 0 = Sunday .. 6 = Saturday — matches our schema.
  const weekday = at.getUTCDay();
  return windows.some((w) => windowContains(w, hour, weekday));
}

function windowContains(
  w: TimeWindow,
  hour: number,
  weekday: number,
): boolean {
  if (w.weekdays.length > 0 && !w.weekdays.includes(weekday)) {
    return false;
  }
  if (w.start_hour <= w.end_hour) {
    return hour >= w.start_hour && hour < w.end_hour;
  }
  return hour >= w.start_hour || hour < w.end_hour;
}

/** Re-export `SkillsPolicyError` for callers who want to catch the base. */
export { SkillsPolicyError };
