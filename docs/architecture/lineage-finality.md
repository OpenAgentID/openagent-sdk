# Lineage Finality

OAS SDK is the upstream lineage contract. Downstream products consume the OAS verifier result; they do not define lineage independently.

## Invariant

No privileged agent action is valid unless the required authority path can be reconstructed from finalized Sigil GAL state through the OAS SDK verifier contract.

Local DID and signature checks are still useful. They prove key possession, document integrity, and offline identity material. They do not authorize privileged ecosystem actions by themselves.

## Downstream Responsibilities

| System | Responsibility |
| --- | --- |
| OAS SDKs | Own the verifier interface, local identity checks, Sigil-backed authority result shape, and fail-closed error model. |
| OpenAgent SDK | Call OAS verification before creating sessions, accepting ACTs, or returning privileged `AuthContext` values. |
| OpenAgentID | Admit unknown agents at the anonymous/key-possession tier; require OAS + Sigil lineage before issuing durable identity, elevated trust, or ecosystem access. |
| AEGIS | Apply policy to the OAS verification result. Do not maintain an independent lineage definition. |
| Arsenal | Issue ACTs and broker credentials only after the OAS result proves the required Sigil lineage path. |
| Forge SDKs | Bind runtime identity to the OAS result before tool execution, collaboration, wallet, or capability flows. |
| Kin | Treat agent/social/workspace authority as OAS-verified lineage plus Kin-specific policy. |
| Aut0 | Treat org, department, team, position, and agent membership as OAS-verified lineage plus Aut0 workflow policy. |
| OATS | Score only the authority and behavior paths that can be tied to the OAS verification result. |
| MARS | Resolve and index OAS documents, then require Sigil-backed OAS verification for privileged registry claims. |

## Modes

**Portable identity mode** verifies:

- DID syntax and entity kind
- DID document schema
- document signatures
- local lineage proof structure
- attestations and presentations

**Privileged authority mode** additionally verifies:

- HMR, MHR, and ENR root anchors on Sigil
- typed lineage edges for the required path
- org lineage roots and membership proofs where applicable
- edge scope and expiry
- revocation-first status from Sigil GAL
- finalized block height and metadata commitments

## Fail-Closed Rule

If a downstream system needs privileged authority and cannot verify Sigil-backed lineage through OAS, it must reject the action. It may still return an anonymous or low-trust identity result for discovery, onboarding, or account creation.
