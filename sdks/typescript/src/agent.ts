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
  StubIdentityProvider,
  toIdentityProvider,
  type Did,
} from './identity.js';
import {
  StubVerificationClient,
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

/** Internal resolver bundle. */
interface Subsystems {
  config: ResolvedOpenAgentConfig;
  identity: IdentityProvider;
  arsenal: ArsenalClient;
  verification: VerificationClient;
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
    return this.#subsystems.identity;
  }

  /** Credentials / Arsenal escape hatch. */
  arsenal(): ArsenalClient {
    return this.#subsystems.arsenal;
  }

  /** Verification / AEGIS escape hatch. */
  verification(): VerificationClient {
    return this.#subsystems.verification;
  }

  /**
   * Create a new agent identity and return a ready-to-use instance.
   *
   * This is a single call that performs identity minting, key generation,
   * scope validation, and skills policy construction.
   */
  async createAgent(input: CreateAgentInput): Promise<OpenAgentInstance> {
    const parsed = parseCreateAgentInput(input);
    let document: IdentityDocument;
    try {
      document = await this.#subsystems.identity.createAgentIdentity(parsed);
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
    let document: IdentityDocument;
    try {
      document = await this.#subsystems.identity.resolve(did);
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
    try {
      return await this.#subsystems.verification.verifyRequest(req, options);
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

  const identityClient = resolved.clients.identity;
  const identity: IdentityProvider =
    identityClient === undefined
      ? new StubIdentityProvider(resolved.namespace)
      : toIdentityProvider(identityClient);

  const arsenalClient = resolved.clients.credentials;
  const arsenal: ArsenalClient =
    arsenalClient === undefined ? stubArsenalClient(resolved) : (arsenalClient as ArsenalClient);

  const verificationClient = resolved.clients.verification;
  const verification: VerificationClient =
    verificationClient === undefined
      ? new StubVerificationClient()
      : toVerificationClient(verificationClient);

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
    credentialsFor: async (provider: string, scopes?: readonly string[]) =>
      createCredentialHandle({
        agentDid: document.did,
        provider,
        arsenal: subsystems.arsenal,
        fetchImpl: subsystems.config.fetch,
        requestTimeoutMs: subsystems.config.requestTimeoutMs,
        ...(scopes !== undefined ? { scopes } : {}),
      }),
    identity: () => subsystems.identity,
  };
}

/**
 * Minimal fallback Arsenal client for tests and offline dev. It echoes a
 * deterministic proxy URL per provider without actually minting credentials.
 */
function stubArsenalClient(_resolved: ResolvedOpenAgentConfig): ArsenalClient {
  return {
    async requestCredential({ agentDid, provider }) {
      const now = Math.floor(Date.now() / 1000);
      return {
        provider,
        proxyUrl: `https://stub.arsenal.invalid/proxy?agent=${encodeURIComponent(agentDid)}&provider=${provider}`,
        expiresAt: now + 300,
      };
    },
    async release() {
      // no-op
    },
  };
}
