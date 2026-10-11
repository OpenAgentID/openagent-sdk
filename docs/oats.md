# OATS verified-ingestion profile 0.2.0

OATS scores evidence about an OAS identity. It does not establish identity or
grant access. This SDK profile implements the existing Rust OATS scoring model
and adds a strict ingestion boundary so unsigned JSON cannot become trusted
score evidence.

The algorithm comes from `OpenAgentID/oats` revision
`5587a0f5cd9629d63d16243fec407c509b6297a9`: `oats-score/src/compute.rs`,
`decay.rs`, `confidence.rs`, and `oats-oracle/src/ingest.rs` / `oracle.rs`.
This document is the normative contract for the SDK's verified-ingestion
profile. It does not declare a new transport, registry, consensus mechanism or
universal trust policy.

## API and trust boundary

`VerifiedOatsScorer` requires both an explicit `trustedIssuers` DID allowlist
and a `verifyEvidence` adapter. `score(entityDid, credentials)` verifies every
credential before returning an aggregate. One rejected credential rejects the
entire batch. The SDK exports no function that scores unverified input.

The adapter receives a detached, deeply frozen credential and an immutable
context with the exact credential ID, issuer DID, subject DID and evaluation
time. It must:

1. Resolve the issuer's assertion key from an authoritative source. A public
   key, issuer URL or owner claim supplied in the credential is not authority.
2. Verify the complete credential body using the submitted proof, including
   its ID, issuer, subject, evidence type, score, issuance/expiry dates and any
   signed extensions. Pin allowed algorithms and proof purposes. Refuse a
   missing, malformed or invalid signature.
3. Verify the current issuer and subject trust roots, including every signed
   delegation and every ancestor's revocation state. An owned root must bind to a
   real authenticated person or organization. `IdentityVerifier.verifyLineage`
   provides this check; declared lineage arrays alone do not.
4. Check the attestation ID against the authoritative credential revocation
   source. An unknown or unavailable authority must refuse verification.
5. Return a `VerifiedOatsEvidence` binding the exact credential ID and DIDs,
   `signatureVerified: true`, `credentialRevocationChecked: true`, and the
   `VerifiedAgentIdentity` results for both principals.

The adapter is a trusted integration boundary. Returning these flags without
performing the checks violates this contract. They are not proof by
themselves. Self-rooted issuer/subject identities require an explicit current
authority grant and `owner: null`; an empty path or caller-declared self root
is insufficient. The scorer checks returned bindings, root/owner records, paths and
current chain expiry; it never interprets a signature flag from the credential
as a verification result.

The package supplies the concrete `createOatsEvidenceVerifier` adapter; callers
do not need to implement signature verification. Configure it with a fixed
delegation audience, the shared `IdentityVerifierConfig` with a required
authoritative `resolveDelegations`, and
`resolveIssuerAssertionMethods`. The latter returns an exact issuer document
with assertion-authorized methods, their controllers and public JWKs. It must
enforce the OAS document's key-purpose rules before returning those methods.

```ts
const verifyEvidence = createOatsEvidenceVerifier({
  audience,
  identity: identityAuthority,
  resolveIssuerAssertionMethods: assertionResolver,
});
const scorer = new VerifiedOatsScorer({ trustedIssuers, verifyEvidence });
const score = await scorer.score(agentDid, signedCredentials);
```

This concrete adapter supports the existing OAS `Ed25519Signature2020`
baseline: remove only the top-level `proof`, serialize the entire remaining
credential as RFC 8785 JCS, verify its raw Ed25519 signature, and decode
`proofValue` as `z`-prefixed base58btc. This follows the OAS TypeScript
`oas-attestation/src/sign.ts` / `verify.ts` and the pinned Rust attestation
implementation. It does not implement a JSON-LD normalization or claim
compatibility with every external proof suite using a similar type name.
The supported baseline omits `cryptosuite`, uses `assertionMethod`, requires
proof creation to equal the signed issuance time, and requires the W3C VC and
OAS attestation contexts. The SDK profile additionally requires a signed
credential ID for deduplication and authoritative revocation.

Keys must be public Ed25519 JWKs uniquely bound to the issuer and authorized for
assertion; private/symmetric material, unrelated controllers and malformed
keys are refused. Native WebCrypto performs Ed25519 verification and is
required for this adapter. Invalid Unicode, non-finite numbers and malformed
JSON are rejected before JCS serialization.

The adapter loads both agent-principal trust roots and signed chains from the configured
authority using `IdentityVerifier.resolve`. Submitted lineage extensions do
not provide authority. It then checks the attestation ID's current revocation
state; stale, unknown or unavailable authority refuses the whole batch. The
evaluation clock must match the current authority clock within the configured
revocation freshness window (60 seconds by default, at most 300).

For JWT-backed evidence, pin the intended audience and verify the JWT issuer,
subject, token type, ID and temporal window in addition to its signature. The
decoded signed VC body must equal the credential being scored. For OAS data
integrity proofs, use the canonical OAS credential verifier and key-purpose
rules. This profile does not substitute JSON stringification for an OAS
canonicalization or proof suite.

Life integrations use LifeID for the authenticated owner and the existing
authoritative identity/revocation service. Agent credentials remain brokered
by Blinds; customer secrets remain in Genesis KMS. No private keys or customer
secrets are accepted or persisted by the scorer.

## Credential validation

Each credential must be finite JSON data with a nonempty, unique `id`, exact
issuer DID, `type` array including `VerifiableCredential`, explicit UTC
`issuanceDate`, a nonempty `proof` object, and `credentialSubject.id` exactly
equal to the scored DID. No DID alias normalization occurs during binding:
legacy `did:l1fe` remains readable but cannot be substituted for a signed
`did:oas` identifier.

The evidence category may appear as `<Category>Credential` in the `type`
array, as `oasAttestationType`, or as
`credentialSubject.attestationType`. Every recognized declaration must agree
on exactly one category. Unsupported declarations and conflicting recognized
categories are refused.

Timestamps must represent valid UTC dates, with `Z` and at most three
fractional-second digits. Impossible dates, missing dates, future issuance,
expired evidence and expiry not later than issuance are refused. Missing or
invalid dates never become the current time. One evaluation clock is used for
the whole batch.

For non-bond evidence, numeric score claims use Rust OATS's preference order:
`score`, `aggregateScore`, `result`, `confidence`. A present malformed
higher-priority field is refused rather than skipped. Numeric values must be
finite and within `[0, 1]`; they are never clamped. String `result` values map
as follows:

| Result | Score |
| --- | ---: |
| `pass` | 1 |
| `fail` | 0 |
| `partial` / `warning` | 0.5 |

The issuer allowlist is a separate authorization decision. A valid signature
from an arbitrary identity does not make that identity an approved auditor,
benchmark publisher or endorser.

## Five-component scoring

| Evidence category | Weight |
| --- | ---: |
| `SecurityAudit` | 0.30 |
| `BenchmarkResult` | 0.25 |
| `ExpertEndorsement` | 0.20 |
| `PublisherBond` | 0.15 |
| `CommunityReview` | 0.10 |

For each category, average all verified evidence scores. Decay that average
using the age of the category's **latest** evidence, as the Rust reference
does. Age is truncated to whole seconds before conversion to days:

```text
ageDays = floor((evaluationTime - latestEvidenceTime) / 1000) / 86400
rawScore = mean(evidenceScores) * 0.5 ** (ageDays / 90)
composite = sum(rawScore[category] * weight[category])
confidence = 1 - exp(log(0.05) * totalEvidenceCount / 100)
```

An absent category has raw score and count zero and `latestEvidence: null`.
The 90-day half-life and confidence calibration reproduce Rust OATS. At 100
evidence items the overall confidence is 0.95. Confidence measures evidence
count, not issuer independence or identity authenticity; replaying one
credential ID within a batch is refused.

The original oracle accepts a separately authoritative publisher bond amount
in SIGIL units. This profile carries that assertion as a signed
`PublisherBondCredential` with `credentialSubject.bondAmount`, under the same
trusted issuer and verification boundary. The normalized component input is
`min(bondAmount / 200, 1)`, matching `oats-oracle`'s reference bond conversion.
The amount must be finite and positive. The Rust oracle omits zero bond amounts;
this strict ingestion profile refuses a zero-value bond credential rather than
letting it add evidence-count confidence. This capped economic normalization
does not permit clamping malformed normalized score claims. It is not a
claim that a blockchain bond was independently queried by the SDK.

## Results, policy and operational use

The result contains `entityDid`, `components`, `composite`, `confidence`,
`evidenceCount` and `computedAt`. Components contain `rawScore`, `weight`,
`evidenceCount` and `latestEvidence`. Results and their components are frozen.
`oatsMeetsThreshold` checks both composite and confidence against explicit
finite `[0, 1]` minimums.

The batch is a snapshot, not an append-only evidence store. Recompute from the
complete selected evidence set when evidence changes. Duplicate detection is
batch-local; durable deduplication belongs to the application's evidence
store. Reverify current root authority and revocation state each time the score is used
for a policy decision. A cached score is not evidence of current identity
authority.

This profile refuses empty batches and bounds batches to 10,000 credentials
and JSON nesting to 32 levels. Verification errors return stable
`openagent/oats/*` codes without exposing proof-adapter exception contents.

Tests generate fresh Ed25519 keypairs for owner OIDC tokens, owner-to-agent
delegations, independently signed OAS JCS credentials and custom-adapter
attestation JWTs. The concrete verifier tests sign explicitly ordered JCS
bytes with Node's crypto API and verify reordered credentials through native
WebCrypto. They cover reference weights,
confidence, average/decay behavior, exact binding, altered signatures,
credential/ancestor revocation, missing ownership, malformed scores/dates,
duplicates and complete-batch refusal.

Self-rooted evidence uses the same trusted-issuer allowlist, real Ed25519/JCS
signature, exact credential binding and revocation checks as owned evidence.
The SDK imposes no score discount for self-root status. Tests cover genuine
self-rooted OAS signatures, root/grant revocation and policy withdrawal.
