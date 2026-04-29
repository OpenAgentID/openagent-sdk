import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ArgumentConstraintError,
  ConsentRequiredError,
  Did,
  InvocationContext,
  NotAllowedError,
  OutsideTimeWindowError,
  RateLimitExceededError,
  SkillsManifest,
  SkillsPolicy,
} from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "SKILLS.md");

const POLICY_YAML = `
version: 1
agent: did:oas:l1fe:agent:my-bot
description: Policy authored against fixtures/SKILLS.md
skills:
  frontend-design:
    allow: true
    rate_limit:
      window: 1h
      max: 5
    arg_constraints:
      type: object
      required: [component]
      properties:
        component:
          type: string
    audit_level: hash
  backend-scaffold:
    allow: true
    audit_level: full
  deploy-production:
    allow: true
    require_consent: true
    audit_level: full
  run-migrations:
    allow: true
    require_consent: true
    rate_limit:
      window: 1d
      max: 3
    audit_level: full
  rm-rf:
    allow: false
  read-logs:
    allow: true
    audit_level: none
  send-email:
    allow: true
    rate_limit:
      window: 1h
      max: 10
    audit_level: hash
default:
  allow: false
  audit_level: hash
`;

const agent = () => Did.parse("did:oas:l1fe:agent:my-bot");

const ctx = (args: unknown, opts: { at?: Date; consent?: boolean } = {}) =>
  new InvocationContext({
    agentDid: agent(),
    sessionId: "session-test",
    arguments: args,
    invokedAt: opts.at,
    consentGranted: opts.consent,
  });

describe("SkillsManifest", () => {
  it("parses the real SKILLS.md fixture", async () => {
    const manifest = await SkillsManifest.fromFile(FIXTURE);
    expect(manifest.length).toBe(7);
    const names = manifest.names();
    expect(names).toContain("frontend-design");
    expect(names).toContain("deploy-production");
    expect(names).toContain("rm-rf");
    expect(names).toContain("read-logs");
    const frontend = manifest.get("frontend-design");
    expect(frontend?.description).toContain(
      "Generate production-grade React components",
    );
  });

  it("rejects empty manifests", () => {
    expect(() => SkillsManifest.fromMarkdown("# Skills\n\nNone.\n")).toThrow();
  });

  it("rejects duplicate skill names", () => {
    expect(() =>
      SkillsManifest.fromMarkdown("## foo\n\nA\n\n## foo\n\nB\n"),
    ).toThrow();
  });

  it("ignores H3 headings", () => {
    const m = SkillsManifest.fromMarkdown(
      "## foo\n\n### not-a-skill\n\nNested\n",
    );
    expect(m.length).toBe(1);
    expect(m.names()).toEqual(["foo"]);
  });
});

describe("SkillsPolicy — policy dimensions", () => {
  it("covers every skill in the real SKILLS.md fixture", async () => {
    const manifest = await SkillsManifest.fromFile(FIXTURE);
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    for (const name of manifest.names()) {
      expect(policy.hasRule(name), `missing rule for ${name}`).toBe(true);
    }
  });

  it("denies rm-rf via explicit deny rule", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    expect(() => policy.canInvoke("rm-rf", ctx({}))).toThrow(NotAllowedError);
  });

  it("default-denies unknown skills", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    expect(() => policy.canInvoke("not-real", ctx({}))).toThrow(
      NotAllowedError,
    );
  });

  it("enforces require_consent on deploy-production", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const c = ctx({ manifest_path: "k8s/prod.yaml" });
    expect(() => policy.canInvoke("deploy-production", c)).toThrow(
      ConsentRequiredError,
    );
    expect(() =>
      policy.canInvoke("deploy-production", c.withConsent()),
    ).not.toThrow();
  });

  it("enforces JSON Schema arg constraints", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    expect(() => policy.canInvoke("frontend-design", ctx({}))).toThrow(
      ArgumentConstraintError,
    );
    expect(() =>
      policy.canInvoke("frontend-design", ctx({ component: "Button" })),
    ).not.toThrow();
  });

  it("agent-binding mismatch rejects invocation", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const wrong = new InvocationContext({
      agentDid: Did.parse("did:oas:l1fe:agent:other"),
      sessionId: "s",
      arguments: {},
    });
    expect(() => policy.canInvoke("frontend-design", wrong)).toThrow(
      NotAllowedError,
    );
  });

  it("enforces rate limits across record_invocation calls", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const at = new Date("2024-01-01T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      policy.recordInvocation(
        "frontend-design",
        ctx({ component: "Button" }, { at }),
      );
    }
    expect(() =>
      policy.recordInvocation(
        "frontend-design",
        ctx({ component: "Button" }, { at }),
      ),
    ).toThrow(RateLimitExceededError);
  });

  it("enforces time windows", () => {
    const yaml = `
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  biz-hours:
    allow: true
    time_windows:
      - start_hour: 9
        end_hour: 17
default:
  allow: false
`;
    const policy = SkillsPolicy.fromYaml(yaml);
    const morning = new Date("2024-01-02T10:00:00.000Z");
    const evening = new Date("2024-01-02T22:00:00.000Z");
    expect(() =>
      policy.canInvoke("biz-hours", ctx({}, { at: morning })),
    ).not.toThrow();
    expect(() =>
      policy.canInvoke("biz-hours", ctx({}, { at: evening })),
    ).toThrow(OutsideTimeWindowError);
  });
});

describe("SkillsPolicy — audit chain", () => {
  it("extends and verifies on every recorded invocation", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const c1 = ctx({ component: "Header" });
    const c2 = ctx({ component: "Footer" });
    const r1 = policy.recordInvocation("frontend-design", c1);
    const r2 = policy.recordInvocation("frontend-design", c2);
    expect(r1.sequence).toBe(0);
    expect(r2.sequence).toBe(1);
    expect(r2.previousHash).toBe(r1.receiptHash);
    expect(policy.auditChain().length).toBe(2);
    expect(policy.auditChain().verify()).toBe(true);
  });

  it("full audit level includes arguments", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const r = policy.recordInvocation(
      "backend-scaffold",
      ctx({ service_name: "payments" }),
    );
    expect(r.auditLevel).toBe("full");
    expect(r.arguments).toEqual({ service_name: "payments" });
  });

  it("none audit level does not extend the chain", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const before = policy.auditChain().length;
    const r = policy.recordInvocation("read-logs", ctx({ service: "foundry" }));
    expect(r.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(policy.auditChain().length).toBe(before);
  });

  it("rate-limit denial does not extend the audit chain", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    const c = ctx({ component: "X" });
    for (let i = 0; i < 5; i++) {
      policy.recordInvocation("frontend-design", c);
    }
    const before = policy.auditChain().length;
    expect(() => policy.recordInvocation("frontend-design", c)).toThrow(
      RateLimitExceededError,
    );
    expect(policy.auditChain().length).toBe(before);
  });

  it("detects tampering", () => {
    const policy = SkillsPolicy.fromYaml(POLICY_YAML);
    policy.recordInvocation("backend-scaffold", ctx({ a: 1 }));
    policy.recordInvocation("backend-scaffold", ctx({ a: 2 }));
    expect(policy.auditChain().verify()).toBe(true);
    // Mutate a receipt in place and confirm verification fails.
    const mutable = policy.auditChain() as unknown as {
      receipts: Array<{ skill: string }>;
    };
    mutable.receipts[0]!.skill = "evil";
    expect(policy.auditChain().verify()).toBe(false);
  });
});

describe("SkillsPolicy — loader", () => {
  it("rejects malformed YAML", () => {
    expect(() => SkillsPolicy.fromYaml(":::not yaml")).toThrow();
  });

  it("rejects unknown version", () => {
    const yaml = `
version: 999
agent: did:oas:l1fe:agent:my-bot
default:
  allow: false
`;
    expect(() => SkillsPolicy.fromYaml(yaml)).toThrow();
  });

  it("rejects broken JSON Schema constraints", () => {
    const yaml = `
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    arg_constraints:
      type: not-a-real-type
default:
  allow: false
`;
    expect(() => SkillsPolicy.fromYaml(yaml)).toThrow();
  });

  it("rejects invalid rate_limit.window", () => {
    const yaml = `
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    rate_limit:
      window: not-a-duration
      max: 1
default:
  allow: false
`;
    expect(() => SkillsPolicy.fromYaml(yaml)).toThrow();
  });
});
