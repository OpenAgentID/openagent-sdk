/**
 * Zod schema for the policy YAML document shape, matching `SkillsPolicyDoc`
 * in the Rust crate one-for-one.
 *
 * Deserialization uses `yaml` to convert the text into a plain JS object,
 * then this schema validates the shape before the engine ever touches it.
 */

import { z } from "zod";

export const CURRENT_VERSION = 1 as const;
export const MAX_SKILL_RULES = 256;

export const AuditLevelSchema = z.enum(["none", "hash", "full"]);
export type AuditLevel = z.infer<typeof AuditLevelSchema>;

export const RateLimitSchema = z.object({
  window: z.string().min(1),
  max: z.number().int().positive(),
});
export type RateLimit = z.infer<typeof RateLimitSchema>;

export const TimeWindowSchema = z.object({
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(0).max(24),
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const SkillRuleSchema = z
  .object({
    allow: z.boolean().default(true),
    rate_limit: RateLimitSchema.optional(),
    // JSON Schema blob — we accept anything serializable and validate it
    // lazily at compile time via Ajv.
    arg_constraints: z.unknown().optional(),
    time_windows: z.array(TimeWindowSchema).default([]),
    require_consent: z.boolean().default(false),
    audit_level: AuditLevelSchema.default("hash"),
  })
  .strict();
export type SkillRule = z.infer<typeof SkillRuleSchema>;

export const DefaultRuleSchema = z
  .object({
    allow: z.boolean().default(false),
    audit_level: AuditLevelSchema.default("hash"),
  })
  .strict();
export type DefaultRule = z.infer<typeof DefaultRuleSchema>;

export const SkillsPolicyDocSchema = z
  .object({
    version: z.literal(CURRENT_VERSION),
    agent: z.string().min(1),
    description: z.string().optional(),
    skills: z.record(z.string(), SkillRuleSchema).default({}),
    default: DefaultRuleSchema.default({ allow: false, audit_level: "hash" }),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Object.keys(val.skills).length > MAX_SKILL_RULES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many rules (${Object.keys(val.skills).length}); maximum is ${MAX_SKILL_RULES}`,
      });
    }
  });
export type SkillsPolicyDoc = z.infer<typeof SkillsPolicyDocSchema>;
