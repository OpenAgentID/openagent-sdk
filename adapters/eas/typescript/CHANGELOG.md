# Changelog

## 0.2.0 — 2026-10-12

- Route native Node imports and requires through the maintained CommonJS dependency path, while preserving browser ESM and matching declarations.
- Require an explicit trusted-attester allowlist; schema and recipient alone do not establish lineage authority.
- Recognize EAS native revocation and expiration, and refuse mismatched subjects, unsafe block numbers and invalid authority data.
- Remove the encoder's Node Buffer requirement and expose the maintained EAS SDK's actual signer type.
- Exercise publish, resolution and native revocation against the released EAS contracts on a real local EVM.

Migration: pass `trustedAttesters` to every `EasAnchorResolver`. Use only addresses your application authorizes to attest lineage roots.
