# TypeScript SDK errors

The SDK facade exports `OpenAgentError`, its subclasses and `ErrorCode` from
`@openagentid/sdk`. Match the stable `code` value rather than the message.
These are the literal strings shipped in SDK 0.8.0:

| Exported constant | Value |
| --- | --- |
| `ErrorCode.INVALID_CONFIG` | `openagent/invalid-config` |
| `ErrorCode.INVALID_INPUT` | `openagent/invalid-input` |
| `ErrorCode.NOT_INITIALIZED` | `openagent/not-initialized` |
| `ErrorCode.IDENTITY_CREATE_FAILED` | `openagent/identity/create-failed` |
| `ErrorCode.IDENTITY_RESOLVE_FAILED` | `openagent/identity/resolve-failed` |
| `ErrorCode.IDENTITY_SIGNATURE_INVALID` | `openagent/identity/signature-invalid` |
| `ErrorCode.IDENTITY_LINEAGE_INVALID` | `openagent/identity/lineage-invalid` |
| `ErrorCode.CREDENTIAL_FETCH_FAILED` | `openagent/credentials/fetch-failed` |
| `ErrorCode.CREDENTIAL_SCOPE_DENIED` | `openagent/credentials/scope-denied` |
| `ErrorCode.CREDENTIAL_PROVIDER_UNKNOWN` | `openagent/credentials/provider-unknown` |
| `ErrorCode.CREDENTIAL_EXPIRED` | `openagent/credentials/expired` |
| `ErrorCode.VERIFICATION_FAILED` | `openagent/verification/failed` |
| `ErrorCode.AUTH_REQUIRED` | `openagent/verification/auth-required` |
| `ErrorCode.AUTH_CHALLENGE_INVALID` | `openagent/verification/challenge-invalid` |
| `ErrorCode.SKILL_DENIED` | `openagent/skills/denied` |
| `ErrorCode.SKILL_UNKNOWN` | `openagent/skills/unknown` |
| `ErrorCode.NETWORK_ERROR` | `openagent/network-error` |
| `ErrorCode.SERIALIZATION_ERROR` | `openagent/serialization-error` |
| `ErrorCode.UNKNOWN` | `openagent/unknown` |

```ts
import { OpenAgentError, ErrorCode } from '@openagentid/sdk';

export function describeFailure(error: unknown): string {
  if (!(error instanceof OpenAgentError)) return 'Unexpected application failure';
  if (error.code === ErrorCode.CREDENTIAL_EXPIRED) return 'Obtain a new credential';
  return error.message;
}
```

`OpenAgentError` exposes `name`, `message`, `code`, optional `cause` and optional
`context`. `toJSON()` returns name, code, message and context. Context can contain
application input; redact it before sending logs to another system.

The facade does not assign a universal HTTP status or automatically retry every
failed operation. Applications choose their response and retry policy; retry
only when the operation is safe or uses an idempotency contract. Revocation,
scope denial and signature failure must be enforced by the receiver.

Other modules have their own exported error contracts. For example, identity
verification uses `IdentityVerificationError`, local storage uses
`LocalWorkspaceError`, and the HTTP/MCP/SCIM integrations translate failures into
their own protocol responses. Use the exact module's API reference when handling
those errors. Rust and other language SDKs keep their own error types.

`LocalWorkspaceError.code` is one of `invalid_input`, `invalid_state`,
`unavailable`, `locked`, `untrusted_identity`, `no_signer`, `revoked` or
`capacity`. A workspace path that passes through a symlink is refused with
`unavailable` ("Workspace paths may not contain symlinks"); on macOS this
includes the system temporary directory, where `/var` links to `/private/var`.
Pass a real directory, or resolve the path with `fs.realpath` first.
