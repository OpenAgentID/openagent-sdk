/**
 * Minimal DID wrapper used for binding a policy to an agent.
 *
 * Mirrors `openagent_skills_policy::Did` in Rust. A full W3C DID parser
 * lives in the OAS SDK; for this narrow use case we only need enough
 * validation to reject obviously malformed values.
 */

import { InvalidPolicyError } from "./errors.js";

const MAX_DID_LENGTH = 512;

export class Did {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static parse(input: string): Did {
    if (!input) {
      throw new InvalidPolicyError("DID cannot be empty");
    }
    if (input.length > MAX_DID_LENGTH) {
      throw new InvalidPolicyError(
        `DID length ${input.length} exceeds maximum ${MAX_DID_LENGTH}`,
      );
    }
    if (!input.startsWith("did:")) {
      throw new InvalidPolicyError(
        `DID \`${input}\` must start with \`did:\``,
      );
    }
    // Split once on `:` into `did`, `method`, `rest`.
    const firstColon = input.indexOf(":");
    const secondColon = input.indexOf(":", firstColon + 1);
    if (secondColon < 0) {
      throw new InvalidPolicyError(
        `DID \`${input}\` must have format \`did:method:id\``,
      );
    }
    const method = input.slice(firstColon + 1, secondColon);
    const rest = input.slice(secondColon + 1);
    if (method.length === 0 || rest.length === 0) {
      throw new InvalidPolicyError(
        `DID \`${input}\` must have format \`did:method:id\``,
      );
    }
    for (const ch of input) {
      if (!/[A-Za-z0-9:_\-.%]/.test(ch)) {
        throw new InvalidPolicyError(
          `DID \`${input}\` contains invalid character \`${ch}\``,
        );
      }
    }
    return new Did(input);
  }

  toString(): string {
    return this.value;
  }

  equals(other: Did): boolean {
    return this.value === other.value;
  }

  asString(): string {
    return this.value;
  }
}
