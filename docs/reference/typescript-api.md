# TypeScript API Reference

This page documents every public export of `@openagent/sdk`. For conceptual docs and task-oriented walkthroughs, see the [guides](../guides/creating-an-agent.md). For the underlying wire formats, see [wire-formats.md](wire-formats.md).

## Module: `@openagent/sdk`

### `OpenAgent` (namespace)

The static facade. Stateless (or holds a process-wide cached resolver). Every method is async unless noted.

#### `OpenAgent.createAgent(options): Promise<Agent>`

Mint a new agent under a parent identity.

```ts
interface CreateAgentOptions {
  parent: Did;                        // HMR or agent DID
  name: string;                       // human-readable; forms part of the child DID
  scopes: Scope[];                    // strict subset of parent's scopes
  namespace?: string;                 // defaults to parent's namespace
  expiresInHours?: number;            // defaults to 1
  conditions?: PolicyConditions;      // attached AEGIS policies
}
```

Returns an `Agent`. Throws `OpenAgentError` on parent verification failure, scope amplification, broker unreachable, or namespace mismatch.

#### `OpenAgent.loadAgent(did, options?): Promise<Agent>`

Load an existing agent. The calling process must hold either the agent's private key (identified by `OPENAGENT_AGENT_KEY_PATH` or passed in `options.keyMaterial`) or a bearer ACT.

```ts
interface LoadAgentOptions {
  act?: string;                         // bearer ACT
  keyMaterial?: Uint8Array;             // raw private key bytes
  keyPath?: string;                     // path to a PEM key file
  skillsPolicyPath?: string;            // SKILLS.md path
}
```

#### `OpenAgent.authenticate(request): Promise<Context>`

Authenticate an inbound request. `request` is one of: `IncomingMessage`, `Request` (Fetch API), a plain `{ headers, method, url }` object, or any framework type for which an adapter has been installed.

Returns a `Context` on success. Throws `OpenAgentError` on any failure — check `err.code` to differentiate `UNAUTHENTICATED`, `INVALID_TOKEN`, `EXPIRED`, `LINEAGE_BROKEN`, `POLICY_DENIED`, etc.

#### `OpenAgent.authenticateHandshake(mcpInitRequest): Promise<Context>`

Same as `authenticate`, but reads from an MCP `initialize` request's `clientInfo.openagent` field instead of HTTP headers.

#### `OpenAgent.revoke(did, options?): Promise<void>`

Revoke an agent and (by default) all of its descendants. Requires the caller to hold either an ancestor key or a policy admin credential.

```ts
interface RevokeOptions {
  reason?: string;
  cascadeDescendants?: boolean;    // defaults to true
}
```

#### `OpenAgent.audit(agentDid?): AuditQuery`

Returns a fluent audit query builder. Passing a DID scopes the query to one agent; omitting it queries across the whole tenant (requires policy admin).

#### `OpenAgent.healthCheck(): Promise<HealthResult>`

Self-test the crypto core and the broker connection.

#### `OpenAgent.configure(config): void`

Set process-wide configuration. Must be called before any other SDK method.

```ts
interface OpenAgentConfig {
  brokerUrl?: string;
  aegisUrl?: string;
  namespace?: string;
  audit?: AuditConfig;
  cache?: CacheConfig;
}
```

#### `OpenAgent.scopeMatches(held, required): boolean`

Utility. Checks whether the list of `held` scopes satisfies the list of `required` scopes, honoring hierarchy and negations.

---

### `Agent` (class)

Returned by `createAgent` and `loadAgent`.

```ts
class Agent {
  readonly did: Did;
  readonly scopes: readonly Scope[];
  readonly expiresAt: Date;
  readonly lineage: readonly Did[];
  readonly actCompactString: string;

  credentialsFor(service: string, options?: CredentialOptions): Promise<Credentials>;
  rawCredential(service: string): Promise<string>;     // escape hatch

  delegate(options: DelegateOptions): Promise<Agent>;
  refresh(): Promise<void>;
  startAutoRefresh(intervalSeconds: number): AbortController;

  wallet(options?: WalletOptions): Promise<Wallet>;

  skillsPolicy(): SkillsPolicy;

  sign(message: Uint8Array): Promise<Uint8Array>;      // raw Ed25519 sign
  verify(message: Uint8Array, sig: Uint8Array): Promise<boolean>;

  hasScope(scope: Scope): boolean;
  requireScope(scope: Scope): void;                    // throws on miss
}
```

### `Context` (interface)

Returned by `authenticate`.

```ts
interface Context {
  readonly did: Did;
  readonly scopes: readonly Scope[];
  readonly lineage: readonly Did[];
  readonly rootHuman: Did;
  readonly actingAs: Did;
  readonly expiresAt: Date;
  readonly policyDecisions: readonly PolicyDecision[];

  hasScope(scope: Scope): boolean;
  requireScope(scope: Scope): void;
}
```

### `Credentials` (interface)

Returned by `agent.credentialsFor`.

```ts
interface Credentials {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  get(url: string, init?: RequestInit): Promise<Response>;
  post(url: string, init?: RequestInit): Promise<Response>;
  put(url: string, init?: RequestInit): Promise<Response>;
  delete(url: string, init?: RequestInit): Promise<Response>;
  patch(url: string, init?: RequestInit): Promise<Response>;
  stream(url: string, init?: RequestInit): Promise<ReadableStream<Uint8Array>>;
  multipart(url: string, parts: MultipartPart[]): Promise<Response>;
}
```

### `SkillsPolicy` (interface)

```ts
interface SkillsPolicy {
  canInvoke(name: string, context?: Record<string, unknown>): PolicyDecision;
  list(): readonly SkillDefinition[];
  reload(): Promise<void>;
}

interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly skill: string;
  readonly requiresApproval: boolean;
  readonly approvalPrompt?: string;
}
```

### `Wallet` (interface)

```ts
interface Wallet {
  address(chain: Chain): Promise<string>;
  balance(chain: Chain): Promise<Balance>;
  signTransaction(tx: UnsignedTransaction): Promise<SignedTransaction>;
  send(tx: UnsignedTransaction): Promise<TransactionReceipt>;
  history(options?: HistoryOptions): Promise<Transaction[]>;
}

type Chain =
  | 'bitcoin' | 'ethereum' | 'optimism' | 'arbitrum' | 'base'
  | 'polygon' | 'bnb' | 'avalanche' | 'solana' | 'cosmos'
  | 'cardano' | 'polkadot' | 'near' | 'aptos' | 'sui'
  | 'stellar' | 'tron' | 'xrpl';
```

### `OpenAgentError` (class)

Single error type for all SDK failures.

```ts
class OpenAgentError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;
}

type ErrorCode =
  | 'UNAUTHENTICATED' | 'INVALID_TOKEN' | 'EXPIRED'
  | 'LINEAGE_BROKEN' | 'LINEAGE_REVOKED'
  | 'SCOPE_DENIED' | 'SCOPE_AMPLIFICATION'
  | 'POLICY_DENIED' | 'POLICY_REQUIRES_APPROVAL'
  | 'BROKER_UNAVAILABLE' | 'UPSTREAM_ERROR'
  | 'INVALID_REQUEST' | 'INTERNAL';
```

The full code table with recommended HTTP status and remediation is in [error-codes.md](error-codes.md).

## Subpath exports

- `@openagent/sdk/express` — `expressMiddleware(options)` for Express/Connect.
- `@openagent/sdk/fastify` — `fastifyPlugin(options)` for Fastify.
- `@openagent/sdk/hono` — `honoMiddleware(options)` for Hono.
- `@openagent/sdk/claude-agent` — `openagentPlugin(options)` for the Claude Agent SDK.
- `@openagent/sdk/mcp` — helpers for MCP server integration (`authenticateTransport`, `filterTools`).
- `@openagent/sdk/testing` — a test double (`FakeBroker`, `stubAgent`, `stubContext`).

Each subpath has a small dedicated API surface — the common case is a single function that returns a middleware.
