/**
 * Typed error hierarchy for the skills policy engine.
 *
 * Each failing dimension has its own subclass so callers can pattern-match
 * with `instanceof` rather than parsing error messages.
 */

export class SkillsPolicyError extends Error {
  override readonly name: string = "SkillsPolicyError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidPolicyError extends SkillsPolicyError {
  override readonly name = "InvalidPolicyError";

  constructor(message: string) {
    super(`invalid policy document: ${message}`);
  }
}

export class InvalidSkillsMarkdownError extends SkillsPolicyError {
  override readonly name = "InvalidSkillsMarkdownError";

  constructor(message: string) {
    super(`failed to parse SKILLS.md: ${message}`);
  }
}

export class NotAllowedError extends SkillsPolicyError {
  override readonly name = "NotAllowedError";
  readonly skill: string;
  readonly reason: string;

  constructor(skill: string, reason: string) {
    super(`skill \`${skill}\` is not allowed by policy: ${reason}`);
    this.skill = skill;
    this.reason = reason;
  }
}

export class RateLimitExceededError extends SkillsPolicyError {
  override readonly name = "RateLimitExceededError";
  readonly skill: string;
  readonly used: number;
  readonly max: number;
  readonly windowSecs: number;

  constructor(skill: string, used: number, max: number, windowSecs: number) {
    super(
      `rate limit exceeded for skill \`${skill}\`: ${used}/${max} in ${windowSecs}s window`,
    );
    this.skill = skill;
    this.used = used;
    this.max = max;
    this.windowSecs = windowSecs;
  }
}

export class ArgumentConstraintError extends SkillsPolicyError {
  override readonly name = "ArgumentConstraintError";
  readonly skill: string;
  readonly details: string;

  constructor(skill: string, details: string) {
    super(`argument constraints violated for skill \`${skill}\`: ${details}`);
    this.skill = skill;
    this.details = details;
  }
}

export class OutsideTimeWindowError extends SkillsPolicyError {
  override readonly name = "OutsideTimeWindowError";
  readonly skill: string;

  constructor(skill: string) {
    super(
      `skill \`${skill}\` cannot be invoked at this time: outside allowed time windows`,
    );
    this.skill = skill;
  }
}

export class ConsentRequiredError extends SkillsPolicyError {
  override readonly name = "ConsentRequiredError";
  readonly skill: string;

  constructor(skill: string) {
    super(`skill \`${skill}\` requires consent but none was provided`);
    this.skill = skill;
  }
}
