# OAS Glyph avatars

Compatibility is checked against nine independent vectors in
`conformance/fixtures/glyph/avatar-v1.json`, generated from unmodified upstream
Rust modules at `f0090dd344d31e4b2724338968655fbdec3837e9` on Depot build
`cb6ggwps9b`. The tests compare every codeword byte, cell shape and displayed
palette color; they do not generate expected values with the TypeScript code.

`@openagentid/sdk/glyph` exports `oasGlyph(did, {size, background})`,
`glyphCodeword(did)`, `agentAvatar(did, profile)` and `glyphEndpoint(request)`.
Generation is deterministic, local and browser compatible. Agents use their
identity-derived glyph by default. Set `IdentityDocument.avatarOverride` to an
HTTPS image URL to select another avatar; clear it to restore the glyph. Profile
writes must go through the service's existing authenticated owner/agent policy.
The rendering endpoint does not fetch override URLs or authorize profile writes.

```ts
import { agentAvatar, oasGlyph, glyphEndpoint } from '@openagentid/sdk/glyph';

const svg = oasGlyph(agent.did, { size: 256 });
const imageSource = agentAvatar(agent.did, agent.document);
// Mount at GET /v1/glyph/svg/:did; the handler also supports HEAD and ETag.
const response = glyphEndpoint(request);
```

The TypeScript renderer ports the upstream OAS Glyph v1 layout, payload and
BLAKE3 palette at `OpenAgentID/oas-glyph` revision
`f0090dd344d31e4b2724338968655fbdec3837e9`. It preserves the 12×12 grid's finder,
kind, alignment and data regions. The existing v1 parity uses BLAKE3 expansion
for error detection; it is **not** Reed–Solomon correction. Glyph pixels are an
avatar, never a signature, owner-chain or revocation proof. Verification uses
the identity verification API.

The v1 payload accepts base58 identifiers up to the real layout capacity (96 data
cells, at most 43 identifier bytes). Invalid explicit `z` multibase keys or
excess payloads are refused. Named/opaque identifiers that cannot fit a v1
payload use **avatar profile v2**: a 32-byte BLAKE3 digest of
`oas-glyph-avatar-v2` + a zero byte + the exact full DID, header version 2 and
parity domain `oas-glyph-avatar-parity-v2`. This retains deterministic default
avatars for readable legacy names without claiming their original name is
decodable from a v1 key payload. Legacy
`did:l1fe:<kind>:<identifier>` identities retain their exact DID for palette
generation and authentication; their legacy namespace is used for v1 payloads.
The `enr` organization alias remains readable as the `ao` glyph kind. Display
sizes scale a fixed 512-unit geometry rather than changing grid padding.

SVG output contains only generated numbers, colors and fixed markup. The HTTP
handler uses `image/svg+xml`, a restrictive CSP and `nosniff`, with immutable
caching. It never embeds raw DID strings, URLs, scripts or private material.
