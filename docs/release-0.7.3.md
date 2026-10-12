# Current SDK compatibility release

This coordinated release makes the supported integrations work with SDK 0.7.3.
The adapter suites also run against published SDK 0.7.2, with installed archives
and real keys. The source tree and its generated package archives are qualified
before publication. This file describes release contents, not publication status.

| Package | Release | Changes |
| --- | --- | --- |
| `@openagentid/sdk` | 0.7.3 | Fresh ACT clocks, deterministic seed recovery, Request preservation, component adapters, correct VERSION |
| `@openagentid/crypto-wasm` | 0.1.2 | Working ACT clock and X25519 public-key recovery in WASM |
| `@openagentid/http` | 0.2.0 | Authoritative identity/key binding, atomic replay prevention, Express/SDK bridge |
| `@openagentid/mcp` | 0.2.0 | Current workspace signer/receiver adapters and bound tool arguments |
| `@openagentid/claude-agent` | 0.2.0 | Official typed hooks, actual SDK signing custody and explicit scope enforcement |
| `@openagentid/scim` | 0.2.0 | Real injected provisioning and fail-closed deprovisioning |
| `@openagentid/anchor-eas` | 0.2.0 | Trusted attesters, DID binding and native on-chain revocation |
| `@openagentid/sdk-testing` | 0.1.2 | Current SDK type and runtime compatibility |
| `create-openagent` | 0.5.3 | Working app pinned to SDK 0.7.3 |

OIDC stays at 0.2.0. Its new compatibility test completes an authorization-code
and PKCE flow with the real SDK verifier, signed ID token, JWKS, UserInfo and
revocation. OAS 1.0.2, Arsenal 0.1.1, AEGIS 0.1.1 and skills-policy 0.1.1 are
consumed through their actual published contracts.

The Node runtime minimum is 20.19.0; use a supported Node 20 or 22 patch release.

## Migrate the integrations

- **HTTP:** provide the receiver's `origin` and authoritative `resolveIdentityKey`.
  The SDK resolver bridge can reuse your configured `IdentityVerifier`. Custom
  session stores must implement atomic `take`; proof-supplied keys never establish
  authority. See [the complete Express example](../adapters/http/typescript/examples/express-sdk.mjs).
- **MCP:** use `createWorkspaceMcpServer` and `createWorkspaceMcpClient`. The
  receiver issues a challenge bound to the caller, tool and arguments; it grants
  scopes from application policy. See [the stdio example](../examples/typescript/02-mcp-server).
- **Claude Agent SDK:** use the native hook adapter with the official SDK's
  `options.hooks`. The framework-independent audit controller remains available.
  See [the hook and signing example](../examples/typescript/03-claude-agent-plugin).
- **SCIM:** inject actual identity provisioning and revocation backends. Failed
  provisioning does not create a made-up identity; failed revocation does not
  report successful deprovisioning. See [the bridge configuration](../bridges/scim/typescript/README.md).
- **EAS:** configure `trustedAttesters` explicitly. Both decoded lineage status
  and EAS-native revocation are checked, with DID and attester binding.
  See [the adapter](../adapters/eas/typescript).

## Seed recovery

Restoring a seed now preserves both Ed25519 and X25519 public keys. SDK 0.7.3
works with the new WASM public-from-secret export and with 0.1.1's RFC 7748
base-point operation. Bindings missing both operations fail closed.

The older random X25519 fallback did not derive its encryption secret from the
seed. Existing encryption keys created by that fallback require their original
key material; this release cannot recover those older random keys from a seed.
Signing-key recovery is unchanged.

## Verification and examples

[The compatibility runner](../tools/compatibility) installs and tests the
packages, packs them, repeats integration checks with the candidate SDK, and
installs all supported packages together in a clean consumer. It checks real
ESM/CommonJS entry points and runs the complete examples. The generated app's
browser test separately verifies signed requests, replay/revocation, animated
eyes, Autos by default and SpaceX selection.

The [deployment templates](../deploy) use real ACT verification with explicit
issuer, audience, tenant, scopes and trusted public keys. Runtime differences
are handled explicitly: Vercel runs the Node route handler, while Cloudflare
bundles and initializes its WASM module. There is no production stub fallback.

The local workspace remains a single-host storage option. Production operators
still choose their storage, trust authority, key custody and permitted scopes.
This release does not silently trust caller-submitted identities or grant access
based on avatar or status fields.
