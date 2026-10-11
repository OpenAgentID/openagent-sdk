import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdapterConstructor, AdapterPayload, ClientMetadata, Configuration, JWK, KoaContextWithOIDC, Provider } from 'oidc-provider';
import { LifeIdFederation, type LifeIdFederationOptions } from './federation.js';
import {
  assertAgentIdentity, identityRoot, sameIdentityBinding, type AgentIdentityProof, type VerifiedAgentIdentity, type VerifyAgentContext,
} from './identity-types.js';

export interface AgentOidcProviderOptions {
  readonly issuer: string;
  readonly clients: readonly ClientMetadata[];
  /** Private RSA/Ed25519 JWKs, supplied by the deployment's protected key custody. */
  readonly jwks: { readonly keys: readonly JWK[] };
  /** Explicit rotating cookie signing keys, each at least 32 bytes. */
  readonly cookieKeys: readonly string[];
  /** Shared persistent storage for oidc-provider models and AgentGrantIdentity. */
  readonly adapter: AdapterConstructor;
  readonly persistent: boolean;
  readonly mode?: 'production' | 'test';
  readonly trustProxy?: boolean;
  readonly tokenTtlSeconds?: number;
  readonly verifyAgent: (proof: AgentIdentityProof, context: VerifyAgentContext) => Promise<VerifiedAgentIdentity>;
  /** Rechecks the signed chain, current root authorization and every revocation through authoritative server sources. */
  readonly resolveIdentity: (did: string) => Promise<VerifiedAgentIdentity>;
  readonly lifeId?: LifeIdFederationOptions;
  /** Requires LifeID owner authentication for owned identities. */
  readonly requireLifeId?: boolean;
  /** Explicit server opt-in; the verifier must still independently authorize every self root. */
  readonly allowSelfRooted?: boolean;
}

export interface AgentInteraction {
  readonly nonce: string;
  readonly audience: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

function assertConfiguration(options: AgentOidcProviderOptions): void {
  const issuer = new URL(options.issuer);
  const test = options.mode === 'test';
  if (!['https:', 'http:'].includes(issuer.protocol)
    || issuer.username || issuer.password || issuer.search || issuer.hash
    || (test ? process.env.NODE_ENV !== 'test'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(issuer.hostname)
      : issuer.protocol !== 'https:' || !options.persistent)) {
    throw new Error('Production OIDC requires HTTPS and a persistent storage adapter; test mode is loopback only');
  }
  if (typeof options.adapter !== 'function' || typeof options.verifyAgent !== 'function'
    || typeof options.resolveIdentity !== 'function') {
    throw new Error('OIDC requires storage, possession verification and authoritative identity resolution');
  }
  if (!options.cookieKeys.length || options.cookieKeys.some((key) => Buffer.byteLength(key) < 32)) {
    throw new Error('Explicit cookie signing keys of at least 32 bytes are required');
  }
  if (!options.jwks.keys.length
    || new Set(options.jwks.keys.map((key) => key.kid)).size !== options.jwks.keys.length
    || options.jwks.keys.some((key) => !key.kid || !key.d
    || !((key.kty === 'RSA' && key.alg === 'RS256')
      || (key.kty === 'OKP' && key.crv === 'Ed25519' && key.alg === 'EdDSA')))) {
    throw new Error('Private RSA/Ed25519 signing JWKs with kid and alg are required');
  }
  if (!options.clients.length || new Set(options.clients.map((client) => client.client_id)).size !== options.clients.length) {
    throw new Error('Unique registered OIDC clients are required');
  }
  for (const client of options.clients) {
    if (!client.client_id || !client.redirect_uris?.length
      || client.grant_types?.some((grant) => grant !== 'authorization_code')
      || client.response_types?.some((response) => response !== 'code')
      || (client.id_token_signed_response_alg !== undefined
        && !['RS256', 'EdDSA'].includes(client.id_token_signed_response_alg))
      || !options.jwks.keys.some((key) => key.alg === (client.id_token_signed_response_alg ?? 'RS256'))) {
      throw new Error('Clients must register redirect URIs and the signed authorization code flow');
    }
    for (const redirect of client.redirect_uris) {
      const url = new URL(redirect);
      if (['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:'].includes(url.protocol)
        || url.hash || url.username || url.password || (!test && url.protocol !== 'https:'
        && !(client.application_type === 'native' && (url.protocol !== 'http:'
          || ['127.0.0.1', '[::1]'].includes(url.hostname))))) {
        throw new Error('Client redirect URI is not secure');
      }
    }
  }
  if (options.requireLifeId && !options.lifeId) throw new Error('LifeID federation configuration is required');
  const ttl = options.tokenTtlSeconds ?? 300;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 3600) throw new Error('OIDC token TTL must be 1–3600 seconds');
}

/** Complete OIDC code-flow provider with a mandatory verified agent login boundary. */
export class AgentOidcProvider {
  readonly provider: Provider;
  private readonly bindings;
  private readonly federation?: LifeIdFederation;

  private constructor(provider: Provider, private readonly options: AgentOidcProviderOptions) {
    this.provider = provider;
    this.bindings = new options.adapter('AgentGrantIdentity');
    this.federation = options.lifeId ? new LifeIdFederation(options.lifeId) : undefined;
  }

  static async create(options: AgentOidcProviderOptions): Promise<AgentOidcProvider> {
    assertConfiguration(options);
    // Dynamic import keeps the package's CJS facade compatible with the ESM provider.
    const { Provider: OidcProvider } = await import('oidc-provider');
    const bindings = new options.adapter('AgentGrantIdentity');
    const currentIdentity = async (did: string, grantId?: string) => {
      const identity = await options.resolveIdentity(did);
      assertAgentIdentity(identity, did, options.allowSelfRooted === true);
      if (grantId) {
        const binding = await bindings.find(grantId);
        const original = (binding as { identity?: VerifiedAgentIdentity } | undefined)?.identity;
        if (!original) throw new Error('Agent grant has no verified root binding');
        assertAgentIdentity(original, did, options.allowSelfRooted === true);
        if (!sameIdentityBinding(original, identity)) throw new Error('Agent root authorization or ownership changed');
        return { ...identity, expiresAt: Math.min(identity.expiresAt, original.expiresAt) };
      }
      return identity;
    };
    const ttl = (ctx: KoaContextWithOIDC) => {
      const expiresAt = ctx.oidc.account?.identityExpiresAt;
      if (typeof expiresAt !== 'number') throw new Error('Agent identity expiry is unavailable');
      const seconds = Math.min(options.tokenTtlSeconds ?? 300, expiresAt - Math.floor(Date.now() / 1000));
      if (seconds < 1) throw new Error('Agent identity expired');
      return seconds;
    };
    const config: Configuration = {
      adapter: options.adapter,
      clients: options.clients.map((client) => ({
        ...client, grant_types: ['authorization_code'], response_types: ['code'],
      })),
      jwks: options.jwks,
      cookies: { keys: [...options.cookieKeys], long: { signed: true, httpOnly: true, sameSite: 'lax' }, short: { signed: true, httpOnly: true, sameSite: 'lax' } },
      features: { devInteractions: { enabled: false }, registration: { enabled: false }, rpInitiatedLogout: { enabled: false }, userinfo: { enabled: true } },
      responseTypes: ['code'],
      pkce: { required: () => true },
      scopes: ['openid', 'profile'],
      claims: { openid: ['sub', 'kind', 'did', 'owner', 'root', 'lineage'], profile: ['name', 'picture'] },
      routes: { authorization: '/authorize', token: '/token', userinfo: '/userinfo', jwks: '/jwks' },
      ttl: { AccessToken: ttl, IdToken: ttl, AuthorizationCode: 60, Interaction: 300, Session: 3600, Grant: 3600 },
      interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
      async findAccount(_ctx, did, token) {
        try {
          if (token && !token.grantId) return undefined;
          const identity = await currentIdentity(did, token?.grantId);
          return {
            accountId: identity.did, identityExpiresAt: identity.expiresAt,
            async claims() {
              const fresh = await currentIdentity(did, token?.grantId);
              return { sub: fresh.did, did: fresh.did, kind: 'agent', owner: fresh.owner,
                root: identityRoot(fresh), lineage: fresh.lineage };
            },
          };
        } catch { return undefined; }
      },
      async loadExistingGrant(ctx) {
        const { session, client, result } = ctx.oidc;
        if (!session?.accountId || !client) return undefined;
        // A freshly completed interaction has not yet attached the grant to its session.
        const id = result?.consent?.grantId ?? session.grantIdFor(client.clientId);
        if (!id) return undefined;
        try {
          await currentIdentity(session.accountId, id);
          const grant = await ctx.oidc.provider.Grant.find(id);
          if (!grant || grant.accountId !== session.accountId || grant.clientId !== client.clientId) return undefined;
          return grant;
        } catch { return undefined; }
      },
    };
    const provider = new OidcProvider(options.issuer, config);
    provider.proxy = options.trustProxy ?? false;
    return new AgentOidcProvider(provider, options);
  }

  callback(): ReturnType<Provider['callback']> { return this.provider.callback(); }

  async interaction(req: IncomingMessage, res: ServerResponse): Promise<AgentInteraction> {
    const details = await this.provider.interactionDetails(req, res);
    return {
      nonce: details.uid, audience: this.options.issuer,
      clientId: String(details.params.client_id),
      scopes: String(details.params.scope ?? '').split(' ').filter(Boolean),
    };
  }

  /** The host supplies its interaction route/UI. No arbitrary account-id login exists. */
  async completeInteraction(req: IncomingMessage, res: ServerResponse, input: {
    proof: AgentIdentityProof;
    /** Explicit approval of this registered client and the requested identity claims. */
    consent: true;
    lifeIdToken?: string;
  }): Promise<void> {
    const details = await this.provider.interactionDetails(req, res);
    if (input.consent !== true) throw new Error('Explicit agent consent is required');
    const identity = await this.options.verifyAgent(input.proof, {
      audience: this.options.issuer, nonce: details.uid,
    });
    assertAgentIdentity(identity, undefined, this.options.allowSelfRooted === true);
    const current = await this.options.resolveIdentity(identity.did);
    assertAgentIdentity(current, identity.did, this.options.allowSelfRooted === true);
    if (!sameIdentityBinding(identity, current)) throw new Error('Agent root authorization or owner changed during login');
    if (identity.owner === null) {
      if (input.lifeIdToken !== undefined) throw new Error('Self-rooted authentication does not accept a LifeID owner assertion');
    } else {
      if (this.options.requireLifeId && !input.lifeIdToken) throw new Error('LifeID owner authentication is required');
      if (input.lifeIdToken) {
        if (!this.federation) throw new Error('LifeID federation is not configured');
        await this.federation.verifyHumanToken(input.lifeIdToken, identity.owner);
      }
    }
    const clientId = String(details.params.client_id);
    if (!this.options.clients.some((client) => client.client_id === clientId)) throw new Error('Unregistered OIDC client');
    const scopes = String(details.params.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.includes('openid') || scopes.some((scope) => !['openid', 'profile'].includes(scope))) {
      throw new Error('Unsupported agent identity scope');
    }
    const expiresAt = Math.min(identity.expiresAt, current.expiresAt);
    assertAgentIdentity({ ...identity, expiresAt }, undefined, this.options.allowSelfRooted === true);
    const grant = new this.provider.Grant({ accountId: identity.did, clientId });
    grant.addOIDCScope(scopes.join(' '));
    grant.addOIDCClaims(['kind', 'did', 'owner', 'root', 'lineage']);
    const grantId = await grant.save();
    await this.bindings.upsert(grantId, {
      identity: { ...identity, expiresAt }, grantId,
    } as AdapterPayload, expiresAt - Math.floor(Date.now() / 1000));
    await this.provider.interactionFinished(req, res, {
      login: { accountId: identity.did, amr: ['agent_signature'], remember: false },
      consent: { grantId },
    }, { mergeWithLastSubmission: false });
  }
}

export const createAgentOidcProvider = AgentOidcProvider.create;
