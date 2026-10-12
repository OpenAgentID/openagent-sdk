# Core concepts

OpenAgentID separates identity, receiver trust, application permissions and
presentation. Start with the [working developer path](../developer-tooling.md)
when you want to run the complete flow.

## Identity and DIDs

A DID identifies a principal. New local agents use the namespaced form
`did:oas:<namespace>:agent:<identifier>`; the Node workspace generates the
identifier from its real Ed25519 public key. The namespace is a label, not proof
of organization membership. Other providers can use document-resolved or opaque
identifiers. Legacy `did:l1fe` identifiers remain readable where supported.

A public-key fingerprint does not contain a recoverable public key. A verifier
needs authoritative public key material, its current DID binding and allowed
key purpose. The local receiver obtains that material through an explicitly
approved public identity document. Never use a caller's proposed key as the
authority for that same request.

Avatar rendering additionally accepts literal existing IAM
`did:oas:agent-instance:<ULID>` identities without changing their bytes. This is
display compatibility, not a change to authentication admission.

## Possession, trust and ownership

A signed proof establishes possession only after signature and claim checks.
Receiver trust answers whether this application accepts the identity now.
Application authorization then decides the requested operation and tenant.

There are two supported root modes:

- An **owned root** terminates at an approved person or organization. The
  configured authority must verify the actual owner and its current DID binding.
  Life deployments can use LifeID; the public SDK does not register a human.
- A **self root** is an agent explicitly approved by the receiver's own root
  policy. Its verification result has `owner: null`. The default generic verifier
  denies this mode unless an authoritative `authorizeSelfRoot` adapter approves it.

Self roots are not automatically a reduced permission tier. Each application
controls its permissions. The local workspace implements direct self roots
through receiver-controlled public-key pins; no human ownership is fabricated.

## Signed lineage and revocation

The portable `IdentityVerifier` accepts a possession JWT and signed root-to-leaf
delegation JWTs. Each link must bind the exact parent, child, audience, key purpose
and lifetime. Verification checks the current root authority and revocation of
every link, including ancestors; unavailable authority fails closed.

Lineage establishes an identity relationship, not arbitrary application scopes.
The verifier prevents lifetime amplification. Capability delegation has its own
scope and policy checks; do not assume a valid identity chain grants a provider
credential or org membership.

Signatures can be checked using pinned local material, but current revocation
and external owner authority still need the receiver's authoritative state.
An old successful proof is not a continuing status check. See
[identity verification](../identity-verification.md) and
[anchor authority](../architecture/lineage-finality.md).

## Challenges and replay

The receiver issues a short-lived challenge bound to the intended agent and
audience. The signer returns a proof with that nonce. The receiver verifies it
and atomically claims both the nonce and issuer/proof ID before accepting it.

The Node workspace persists this decision alongside current trust/revocation
under one cross-process lock. Another receiver has separate trust. Distributed
applications need shared durable atomic replay storage, not independent process
caches or a read followed by a separate write.

## Capabilities, credentials and skills

Identity asks who authenticated; an ACT or service policy asks what that caller
may do. Creating a local identity or calling the configured provider facade does
not automatically mint an ACT. ACT verification pins the broker issuer, intended
audience, signing keys and required scopes. Credential proxying requires a real
configured broker; custody and permitted routes belong to that integration.

The facade's skills policy is an application-supplied allow/deny hook. A skill
name or presentation profile does not supply approval, rate limits, spending
authority or an audit system automatically. Applications integrate those checks
with their actual authoritative services.

## Avatars and current activity

The DID deterministically selects identity pixels. A skin/shape, plush/flat
finish, face/raised eyes and optional wearables select appearance. Expressions
and current status select the shared live eye state. Changing appearance preserves
the mounted eye nodes and timeline; changing status changes no identity or scope.

Autos is the default character; explicit `avatarSkin: null` selects OAS Glyph.
A safe `avatarOverride` takes precedence. Saved expressions are preferences;
only the host's authorized activity source should supply real status. A renderer
cannot infer reasoning from a running process or grant public access to a private
owner observation.
