/**
 * OpenAgent — top-level developer API. "Clerk for autonomous agents."
 *
 * Three lines to get an authenticated, credential-injecting agent:
 *
 * ```ts
 * import { OpenAgent } from '@openagent/sdk';
 *
 * OpenAgent.configure({ endpoints: { ... } });
 *
 * const agent = await OpenAgent.createAgent({
 *   parent: 'did:oas:l1fe:hmr:alice',
 *   name: 'my-bot',
 *   scopes: ['openai:chat:completions'],
 * });
 *
 * const creds = await agent.credentialsFor('openai');
 * const res   = await creds.fetch('https://api.openai.com/v1/chat/completions', { body });
 * ```
 */

import {
  createAgentInputSchema,
  type CreateAgentInput,
  type OpenAgentConfig,
  type ResolvedOpenAgentConfig,
  resolveConfig,
} from './config.js';
import { ConfigError, ErrorCode, IdentityError, wrapError } from './errors.js';
import {
  type ArsenalClient,
  type CredentialHandle,
  createCredentialHandle,
} from './credentials.js';
import {
  type IdentityDocument,
  type IdentityProvider,
  toIdentityProvider,
  type Did,
} from './identity.js';
import {
  toVerificationClient,
  type AuthContext,
  type VerificationClient,
  type VerifyRequestOptions,
} from './verification.js';
import {
  InMemorySkillsPolicy,
  type SkillsPolicy,
  type SkillId,
} from './skills.js';

/**
 * Internal resolver bundle.
 *
 * Each subsystem is optional at construction and required at use: a call that
 * needs an unconfigured subsystem fails closed with a `ConfigError` naming the
 * missing client. The production SDK has no fallback implementations - test
 * backends live in `@openagent/sdk-testing`, behind an explicit import,
 * because a silent fake-signature fallback is the class of bug that ships
 * "working" identity to production with no one having chosen it.
 */
interface Subsystems {
  config: ResolvedOpenAgentConfig;
  identity: IdentityProvider | undefined;
  arsenal: ArsenalClient | undefined;
  verification: VerificationClient | undefined;
}

/** The package a real production client for a subsystem comes from. */
const SUBSYSTEM_PACKAGES = {
  identity: '@openagent/oas-sdk',
  credentials: '@openagent/arsenal-sdk',
  verification: '@openagent/aegis-sdk',
} as const;

/**
 * Require a subsystem or fail closed.
 *
 * The error names the missing client, the package a real one comes from, and
 * the testing package for unit tests - so the failure itself teaches the fix.
 */
function requireSubsystem<T>(
  subsystem: T | undefined,
  name: keyof typeof SUBSYSTEM_PACKAGES,
): T {
  if (subsystem === undefined) {
    throw new ConfigError(
      `OpenAgent: no ${name} client configured. ` +
        `Production: pass a ${SUBSYSTEM_PACKAGES[name]} client via ` +
        `OpenAgentConfig.clients.${name}. Tests: use @openagent/sdk-testing.`,
      { code: ErrorCode.INVALID_CONFIG, context: { subsystem: name } },
    );
  }
  return subsystem;
}

/** A live, fully-authenticated agent handle. */
export interface OpenAgentInstance {
  /** The agent's DID. */
  readonly did: Did;
  /** The raw OAS identity document. */
  readonly document: IdentityDocument;
  /** Skills policy bound to this agent. */
  skillsPolicy(): SkillsPolicy;
  /** Replace the agent's skills policy (immutable — returns a new instance). */
  withSkillsPolicy(policy: SkillsPolicy): OpenAgentInstance;
  /** Fetch a credential handle for `provider`. */
  credentialsFor(provider: string, scopes?: readonly string[]): Promise<CredentialHandle>;
  /** Underlying identity provider (escape hatch). */
  identity(): IdentityProvider;
}

/**
 * Global, lazily-initialized OpenAgent runtime.
 *
 * The default instance is populated by {@link OpenAgent.configure}. Callers
 * who need multiple runtimes in one process can instantiate `OpenAgentRuntime`
 * directly.
 */
export class OpenAgentRuntime {
  readonly #subsystems: Subsystems;

  constructor(config: OpenAgentConfig = {}) {
    this.#subsystems = buildSubsystems(config);
  }

  /** Access the resolved config. */
  config(): Readonly<ResolvedOpenAgentConfig> {
    return this.#subsystems.config;
  }

  /** Identity / OAS escape hatch. */
  identity(): IdentityProvider {
    return requireSubsystem(this.#subsystems.identity, 'identity');
  }

  /** Credentials / Arsenal escape hatch. */
  arsenal(): ArsenalClient {
    return requireSubsystem(this.#subsystems.arsenal, 'credentials');
  }

  /** Verification / AEGIS escape hatch. */
  verification(): VerificationClient {
    return requireSubsystem(this.#subsystems.verification, 'verification');
  }

  /**
   * Create a new agent identity and return a ready-to-use instance.
   *
   * This is a single call that performs identity minting, key generation,
   * scope validation, and skills policy construction.
   */
  async createAgent(input: CreateAgentInput): Promise<OpenAgentInstance> {
    const parsed = parseCreateAgentInput(input);
    const identity = requireSubsystem(this.#subsystems.identity, 'identity');
    let document: IdentityDocument;
    try {
      document = await identity.createAgentIdentity(parsed);
    } catch (err) {
      throw err instanceof IdentityError
        ? err
        : new IdentityError('Failed to create OAS agent identity', {
            code: ErrorCode.IDENTITY_CREATE_FAILED,
            cause: err,
            context: { parent: parsed.parent, name: parsed.name },
          });
    }
    const skills = parsed.skills ? new InMemorySkillsPolicy(parsed.skills) : new InMemorySkillsPolicy();
    return buildInstance(this.#subsystems, document, skills);
  }

  /**
   * Resolve an existing DID into an {@link OpenAgentInstance}. Useful when
   * the agent was created out-of-band (e.g. by a parent orchestrator).
   */
  async loadAgent(did: Did, skills?: readonly SkillId[]): Promise<OpenAgentInstance> {
    const identity = requireSubsystem(this.#subsystems.identity, 'identity');
    let document: IdentityDocument;
    try {
      document = await identity.resolve(did);
    } catch (err) {
      throw err instanceof IdentityError
        ? err
        : new IdentityError('Failed to resolve agent DID', {
            code: ErrorCode.IDENTITY_RESOLVE_FAILED,
            cause: err,
            context: { did },
          });
    }
    const policy = new InMemorySkillsPolicy(skills ?? []);
    return buildInstance(this.#subsystems, document, policy);
  }

  /** One-call authentication over a WHATWG `Request`. */
  async authenticate(req: Request, options?: VerifyRequestOptions): Promise<AuthContext> {
    const verification = requireSubsystem(this.#subsystems.verification, 'verification');
    try {
      return await verification.verifyRequest(req, options);
    } catch (err) {
      throw wrapError(err, 'Authentication failed');
    }
  }
}

// ─── Singleton convenience API ────────────────────────────────────────────

let defaultRuntime: OpenAgentRuntime | undefined;

function getDefaultRuntime(): OpenAgentRuntime {
  if (!defaultRuntime) {
    defaultRuntime = new OpenAgentRuntime();
  }
  return defaultRuntime;
}

/**
 * `OpenAgent` — the public namespace. All calls delegate to a singleton
 * runtime created lazily on first use. Most apps never need more than this.
 */
export const OpenAgent = {
  /**
   * Configure the global OpenAgent runtime. Safe to call multiple times —
   * a fresh runtime is constructed on each call.
   */
  configure(config: OpenAgentConfig = {}): OpenAgentRuntime {
    defaultRuntime = new OpenAgentRuntime(config);
    return defaultRuntime;
  },

  /** The current runtime (creating it on first access). */
  runtime(): OpenAgentRuntime {
    return getDefaultRuntime();
  },

  /** One-call agent creation. */
  createAgent(input: CreateAgentInput): Promise<OpenAgentInstance> {
    return getDefaultRuntime().createAgent(input);
  },

  /** Load an existing agent by DID. */
  loadAgent(did: Did, skills?: readonly SkillId[]): Promise<OpenAgentInstance> {
    return getDefaultRuntime().loadAgent(did, skills);
  },

  /** One-call authentication. */
  authenticate(req: Request, options?: VerifyRequestOptions): Promise<AuthContext> {
    return getDefaultRuntime().authenticate(req, options);
  },
} as const;

// ─── Internals ────────────────────────────────────────────────────────────

function parseCreateAgentInput(input: CreateAgentInput): CreateAgentInput {
  try {
    return createAgentInputSchema.parse(input);
  } catch (err) {
    throw new ConfigError('Invalid createAgent input', { cause: err });
  }
}

function buildSubsystems(config: OpenAgentConfig): Subsystems {
  const resolved = resolveConfig(config);

  // No fallbacks: an unconfigured subsystem stays undefined until a call
  // needs it, and fails closed there with a `ConfigError` naming the client.
  const identityClient = resolved.clients.identity;
  const identity: IdentityProvider | undefined =
    identityClient === undefined ? undefined : toIdentityProvider(identityClient);

  const arsenalClient = resolved.clients.credentials;
  const arsenal: ArsenalClient | undefined =
    arsenalClient === undefined ? undefined : (arsenalClient as ArsenalClient);

  const verificationClient = resolved.clients.verification;
  const verification: VerificationClient | undefined =
    verificationClient === undefined ? undefined : toVerificationClient(verificationClient);

  return { config: resolved, identity, arsenal, verification };
}

function buildInstance(
  subsystems: Subsystems,
  document: IdentityDocument,
  skills: SkillsPolicy,
): OpenAgentInstance {
  return {
    did: document.did,
    document,
    skillsPolicy: () => skills,
    withSkillsPolicy: (policy: SkillsPolicy) => buildInstance(subsystems, document, policy),
    credentialsFor: async (provider: string, scopes?: readonly string[]) => {
      const arsenal = requireSubsystem(subsystems.arsenal, 'credentials');
      return createCredentialHandle({
        agentDid: document.did,
        provider,
        arsenal,
        fetchImpl: subsystems.config.fetch,
        requestTimeoutMs: subsystems.config.requestTimeoutMs,
        ...(scopes !== undefined ? { scopes } : {}),
      });
    },
    identity: () => requireSubsystem(subsystems.identity, 'identity'),
  };
}
