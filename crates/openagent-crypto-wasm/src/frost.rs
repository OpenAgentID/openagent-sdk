//! FROST-Ed25519 threshold signatures (RFC 9591).
//!
//! Implements t-of-n threshold signing using [`frost_ed25519`]. The output of a
//! successful threshold signing operation is a standard 64-byte Ed25519
//! signature, verifiable by [`crate::ed25519::verify`] (or any RFC 8032
//! verifier) against the group's public verifying key.
//!
//! The exposed API is intentionally chunked into the four operations the
//! OpenAgent SDKs need to expose to TS:
//!
//! 1. [`trusted_keygen`] — single-dealer key generation, producing a
//!    serialized [`KeyShareBundle`] that bundles all participants' key
//!    packages with the group public key package.
//! 2. [`sign_round1`] — for one participant, generate the per-signature
//!    nonces and commitments. Returns a [`Round1Output`].
//! 3. [`sign_round2`] — for one participant, given the aggregated commitments
//!    from all selected signers and the message, produce that participant's
//!    signature share.
//! 4. [`aggregate`] — combine all signature shares into a single Ed25519
//!    signature.
//!
//! [`verify`] is a convenience wrapper that delegates to [`crate::ed25519::verify`].
//!
//! All inputs and outputs are byte vectors so the same code path serializes
//! cleanly across the WASM boundary. Internally we use FROST's
//! `Ciphersuite::serialize`/`deserialize` so the byte format is exactly what
//! [`frost_ed25519`] expects.

use std::collections::BTreeMap;

use frost_ed25519 as frost;
use frost_ed25519::round1::SigningCommitments;
use frost_ed25519::round2::SignatureShare;
use frost_ed25519::Identifier;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::error::CryptoError;

/// A complete bundle of FROST key shares produced by [`trusted_keygen`].
///
/// Contains every participant's serialized [`KeyPackage`](frost::keys::KeyPackage)
/// and the shared [`PublicKeyPackage`](frost::keys::PublicKeyPackage). In
/// production deployments, the dealer SHOULD distribute exactly one
/// `key_packages[i]` entry to participant `i` and then destroy the bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyShareBundle {
    /// Threshold `t` — minimum number of signers required.
    pub min_signers: u16,
    /// Total participants `n`.
    pub max_signers: u16,
    /// One serialized `KeyPackage` per participant, in identifier order.
    pub key_packages: Vec<Vec<u8>>,
    /// Serialized `PublicKeyPackage` shared by every participant.
    pub public_key_package: Vec<u8>,
    /// Group verifying (public) key, raw 32 bytes.
    pub group_public_key: Vec<u8>,
}

/// Output of [`sign_round1`] for a single participant.
///
/// Contains the participant's `nonces` (kept secret, used in round 2) and
/// `commitments` (sent to the coordinator and broadcast to other signers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Round1Output {
    /// Serialized `SigningNonces` — KEEP SECRET on the participant's machine.
    pub nonces: Vec<u8>,
    /// Serialized `SigningCommitments` — broadcast to all signers + coordinator.
    pub commitments: Vec<u8>,
}

/// A pairing of (participant identifier, that participant's serialized commitments).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantCommitments {
    /// 1-based participant identifier (matches the position in `key_packages`).
    pub identifier: u16,
    /// Serialized `SigningCommitments` from `sign_round1`.
    pub commitments: Vec<u8>,
}

/// A pairing of (participant identifier, that participant's signature share).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantShare {
    /// 1-based participant identifier (matches the position in `key_packages`).
    pub identifier: u16,
    /// Serialized `SignatureShare` from `sign_round2`.
    pub share: Vec<u8>,
}

/// Generates a t-of-n FROST key share bundle via the trusted-dealer protocol.
///
/// # Arguments
///
/// * `min_signers` — threshold `t`. Must be >= 2.
/// * `max_signers` — total participants `n`. Must be >= `min_signers`.
///
/// # Errors
///
/// - [`CryptoError::FrostKeygenFailed`] if the parameters are invalid or the
///   underlying FROST keygen fails.
/// - [`CryptoError::SerializationFailed`] if any serialized output cannot be
///   produced (should never happen with valid keygen output).
pub fn trusted_keygen(min_signers: u16, max_signers: u16) -> Result<KeyShareBundle, CryptoError> {
    if min_signers < 2 {
        return Err(CryptoError::FrostKeygenFailed {
            min_signers,
            max_signers,
            reason: "min_signers must be >= 2 — use plain Ed25519 for single-signer operation"
                .into(),
        });
    }
    if max_signers < min_signers {
        return Err(CryptoError::FrostKeygenFailed {
            min_signers,
            max_signers,
            reason: format!("max_signers ({max_signers}) must be >= min_signers ({min_signers})"),
        });
    }

    let (shares, pubkey_package) = frost::keys::generate_with_dealer(
        max_signers,
        min_signers,
        frost::keys::IdentifierList::Default,
        OsRng,
    )
    .map_err(|e| CryptoError::FrostKeygenFailed {
        min_signers,
        max_signers,
        reason: e.to_string(),
    })?;

    // Sort by identifier so positional indexing in `key_packages` is deterministic.
    let mut sorted: Vec<(Identifier, frost::keys::SecretShare)> =
        shares.into_iter().collect();
    sorted.sort_by_key(|(id, _)| id.serialize());

    let mut key_packages_serialized = Vec::with_capacity(sorted.len());
    for (id, share) in &sorted {
        let kp = frost::keys::KeyPackage::try_from(share.clone()).map_err(|e| {
            CryptoError::FrostKeygenFailed {
                min_signers,
                max_signers,
                reason: format!("KeyPackage construction failed for participant {id:?}: {e}"),
            }
        })?;
        let bytes = kp.serialize().map_err(|e| CryptoError::SerializationFailed {
            what: "FROST KeyPackage",
            reason: e.to_string(),
        })?;
        key_packages_serialized.push(bytes);
    }

    let pubkey_serialized =
        pubkey_package
            .serialize()
            .map_err(|e| CryptoError::SerializationFailed {
                what: "FROST PublicKeyPackage",
                reason: e.to_string(),
            })?;

    let group_pk = pubkey_package
        .verifying_key()
        .serialize()
        .map_err(|e| CryptoError::SerializationFailed {
            what: "FROST group VerifyingKey",
            reason: e.to_string(),
        })?;

    Ok(KeyShareBundle {
        min_signers,
        max_signers,
        key_packages: key_packages_serialized,
        public_key_package: pubkey_serialized,
        group_public_key: group_pk,
        // group_public_key is the raw 32-byte ed25519 verifying key, suitable
        // for any RFC 8032 verifier.
    })
}

/// Round-1 of the FROST protocol for a single participant.
///
/// Generates that participant's signing nonces and commitments. The nonces
/// MUST be kept secret and passed verbatim into [`sign_round2`]. The
/// commitments are broadcast to all other selected signers and to the
/// coordinator.
///
/// # Errors
///
/// - [`CryptoError::SerializationFailed`] if the input key package cannot be
///   parsed or the outputs cannot be serialized.
pub fn sign_round1(serialized_key_package: &[u8]) -> Result<Round1Output, CryptoError> {
    let kp = frost::keys::KeyPackage::deserialize(serialized_key_package).map_err(|e| {
        CryptoError::SerializationFailed {
            what: "FROST KeyPackage",
            reason: e.to_string(),
        }
    })?;

    let mut rng = OsRng;
    let (nonces, commitments) = frost::round1::commit(kp.signing_share(), &mut rng);

    let nonces_bytes = nonces.serialize().map_err(|e| CryptoError::SerializationFailed {
        what: "FROST SigningNonces",
        reason: e.to_string(),
    })?;
    let commitments_bytes =
        commitments
            .serialize()
            .map_err(|e| CryptoError::SerializationFailed {
                what: "FROST SigningCommitments",
                reason: e.to_string(),
            })?;

    Ok(Round1Output {
        nonces: nonces_bytes,
        commitments: commitments_bytes,
    })
}

/// Round-2 of the FROST protocol for a single participant.
///
/// Given the participant's serialized key package, their secret nonces from
/// round 1, the message to sign, and the aggregated commitments from all
/// signers, produces this participant's signature share.
///
/// # Arguments
///
/// * `serialized_key_package` — this participant's key package bytes.
/// * `serialized_nonces` — the `nonces` field from this participant's
///   [`Round1Output`].
/// * `message` — the message bytes being signed.
/// * `commitments` — every selected signer's commitments (including this one),
///   tagged with their 1-based identifier.
///
/// # Errors
///
/// - [`CryptoError::SerializationFailed`] for any deserialization failure.
/// - [`CryptoError::FrostStageFailed`] (stage = `"round2"`) if the round-2
///   signing operation rejects the inputs.
pub fn sign_round2(
    serialized_key_package: &[u8],
    serialized_nonces: &[u8],
    message: &[u8],
    commitments: &[ParticipantCommitments],
) -> Result<Vec<u8>, CryptoError> {
    let kp = frost::keys::KeyPackage::deserialize(serialized_key_package).map_err(|e| {
        CryptoError::SerializationFailed {
            what: "FROST KeyPackage",
            reason: e.to_string(),
        }
    })?;

    let nonces = frost::round1::SigningNonces::deserialize(serialized_nonces).map_err(|e| {
        CryptoError::SerializationFailed {
            what: "FROST SigningNonces",
            reason: e.to_string(),
        }
    })?;

    let commitments_map = commitments_to_map(commitments)?;
    let signing_package = frost::SigningPackage::new(commitments_map, message);

    let share = frost::round2::sign(&signing_package, &nonces, &kp).map_err(|e| {
        CryptoError::FrostStageFailed {
            stage: "round2",
            reason: e.to_string(),
        }
    })?;

    Ok(share.serialize().to_vec())
}

/// Aggregates per-participant signature shares into a single Ed25519 signature.
///
/// # Arguments
///
/// * `message` — the same message bytes that were signed in round 2.
/// * `commitments` — every selected signer's commitments (must match the set
///   used in round 2).
/// * `shares` — every selected signer's `SignatureShare` from round 2.
/// * `serialized_public_key_package` — the bundle's `public_key_package` field.
///
/// Returns a 64-byte Ed25519 signature.
///
/// # Errors
///
/// - [`CryptoError::SerializationFailed`] for any deserialization failure.
/// - [`CryptoError::FrostStageFailed`] (stage = `"aggregate"`) if FROST
///   aggregation fails.
pub fn aggregate(
    message: &[u8],
    commitments: &[ParticipantCommitments],
    shares: &[ParticipantShare],
    serialized_public_key_package: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let pubkey_package = frost::keys::PublicKeyPackage::deserialize(serialized_public_key_package)
        .map_err(|e| CryptoError::SerializationFailed {
            what: "FROST PublicKeyPackage",
            reason: e.to_string(),
        })?;

    let commitments_map = commitments_to_map(commitments)?;
    let signing_package = frost::SigningPackage::new(commitments_map, message);

    let mut shares_map: BTreeMap<Identifier, SignatureShare> = BTreeMap::new();
    for entry in shares {
        let id = identifier_from_u16(entry.identifier)?;
        let share = SignatureShare::deserialize(&entry.share).map_err(|e| {
            CryptoError::SerializationFailed {
                what: "FROST SignatureShare",
                reason: e.to_string(),
            }
        })?;
        if shares_map.insert(id, share).is_some() {
            return Err(CryptoError::FrostInvalidParticipants {
                reason: format!("duplicate signature share for identifier {}", entry.identifier),
            });
        }
    }

    let sig = frost::aggregate(&signing_package, &shares_map, &pubkey_package).map_err(|e| {
        CryptoError::FrostStageFailed {
            stage: "aggregate",
            reason: e.to_string(),
        }
    })?;

    sig.serialize().map_err(|e| CryptoError::SerializationFailed {
        what: "FROST aggregated Signature",
        reason: e.to_string(),
    })
}

/// Verifies a FROST-Ed25519 threshold signature against the group public key.
///
/// FROST produces standard Ed25519 signatures, so this is a straight delegate
/// to [`crate::ed25519::verify`]. Provided here for API symmetry with the rest
/// of the FROST module.
///
/// # Errors
///
/// - [`CryptoError::FrostStageFailed`] (stage = `"verify"`) on any verification
///   failure (we wrap the underlying Ed25519 error so callers can branch on the
///   FROST-specific stage if needed).
pub fn verify(message: &[u8], signature: &[u8], group_public_key: &[u8]) -> Result<(), CryptoError> {
    crate::ed25519::verify(group_public_key, message, signature).map_err(|e| {
        CryptoError::FrostStageFailed {
            stage: "verify",
            reason: e.to_string(),
        }
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn commitments_to_map(
    commitments: &[ParticipantCommitments],
) -> Result<BTreeMap<Identifier, SigningCommitments>, CryptoError> {
    let mut map: BTreeMap<Identifier, SigningCommitments> = BTreeMap::new();
    for entry in commitments {
        let id = identifier_from_u16(entry.identifier)?;
        let commit = SigningCommitments::deserialize(&entry.commitments).map_err(|e| {
            CryptoError::SerializationFailed {
                what: "FROST SigningCommitments",
                reason: e.to_string(),
            }
        })?;
        if map.insert(id, commit).is_some() {
            return Err(CryptoError::FrostInvalidParticipants {
                reason: format!("duplicate commitments for identifier {}", entry.identifier),
            });
        }
    }
    if map.is_empty() {
        return Err(CryptoError::FrostInvalidParticipants {
            reason: "at least one commitment must be supplied".into(),
        });
    }
    Ok(map)
}

fn identifier_from_u16(id: u16) -> Result<Identifier, CryptoError> {
    if id == 0 {
        return Err(CryptoError::FrostInvalidParticipants {
            reason: "participant identifier must be >= 1 (FROST identifiers are 1-indexed)".into(),
        });
    }
    Identifier::try_from(id).map_err(|e| CryptoError::FrostInvalidParticipants {
        reason: format!("invalid identifier {id}: {e}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_threshold(min_signers: u16, max_signers: u16, signers: &[u16]) {
        let bundle = trusted_keygen(min_signers, max_signers).expect("keygen");
        assert_eq!(bundle.key_packages.len(), max_signers as usize);
        assert_eq!(bundle.group_public_key.len(), 32);

        let message = b"threshold signing test";

        // Round 1: each selected signer generates their nonces + commitments.
        let mut round1_outputs: Vec<(u16, Round1Output)> = Vec::new();
        for &signer in signers {
            let kp_bytes = &bundle.key_packages[(signer - 1) as usize];
            let r1 = sign_round1(kp_bytes).expect("round1");
            round1_outputs.push((signer, r1));
        }

        let commitments: Vec<ParticipantCommitments> = round1_outputs
            .iter()
            .map(|(id, r1)| ParticipantCommitments {
                identifier: *id,
                commitments: r1.commitments.clone(),
            })
            .collect();

        // Round 2: each signer produces their signature share.
        let mut shares: Vec<ParticipantShare> = Vec::new();
        for (id, r1) in &round1_outputs {
            let kp_bytes = &bundle.key_packages[(*id - 1) as usize];
            let share = sign_round2(kp_bytes, &r1.nonces, message, &commitments).expect("round2");
            shares.push(ParticipantShare {
                identifier: *id,
                share,
            });
        }

        // Aggregate.
        let signature =
            aggregate(message, &commitments, &shares, &bundle.public_key_package).expect("aggregate");
        assert_eq!(signature.len(), 64);

        // Verify against the group public key as a standard Ed25519 signature.
        verify(message, &signature, &bundle.group_public_key).expect("verify");
        crate::ed25519::verify(&bundle.group_public_key, message, &signature)
            .expect("ed25519 verify");
    }

    #[test]
    fn keygen_2_of_3_round_trip() {
        run_threshold(2, 3, &[1, 2]);
    }

    #[test]
    fn keygen_3_of_5_round_trip_first_three() {
        run_threshold(3, 5, &[1, 2, 3]);
    }

    #[test]
    fn keygen_3_of_5_round_trip_last_three() {
        run_threshold(3, 5, &[3, 4, 5]);
    }

    #[test]
    fn keygen_min_signers_below_2_fails() {
        let result = trusted_keygen(1, 5);
        assert!(matches!(result, Err(CryptoError::FrostKeygenFailed { .. })));
    }

    #[test]
    fn keygen_max_below_min_fails() {
        let result = trusted_keygen(3, 2);
        assert!(matches!(result, Err(CryptoError::FrostKeygenFailed { .. })));
    }

    #[test]
    fn verify_wrong_message_fails() {
        let bundle = trusted_keygen(2, 3).unwrap();
        let signers = [1u16, 2];

        let mut round1_outputs: Vec<(u16, Round1Output)> = Vec::new();
        for &signer in &signers {
            let kp_bytes = &bundle.key_packages[(signer - 1) as usize];
            round1_outputs.push((signer, sign_round1(kp_bytes).unwrap()));
        }
        let commitments: Vec<ParticipantCommitments> = round1_outputs
            .iter()
            .map(|(id, r1)| ParticipantCommitments {
                identifier: *id,
                commitments: r1.commitments.clone(),
            })
            .collect();

        let mut shares: Vec<ParticipantShare> = Vec::new();
        for (id, r1) in &round1_outputs {
            let kp_bytes = &bundle.key_packages[(*id - 1) as usize];
            let share = sign_round2(kp_bytes, &r1.nonces, b"msg-A", &commitments).unwrap();
            shares.push(ParticipantShare {
                identifier: *id,
                share,
            });
        }
        let sig = aggregate(b"msg-A", &commitments, &shares, &bundle.public_key_package).unwrap();

        let result = verify(b"msg-B", &sig, &bundle.group_public_key);
        assert!(matches!(result, Err(CryptoError::FrostStageFailed { .. })));
    }

    #[test]
    fn duplicate_commitment_identifier_rejected() {
        let bundle = trusted_keygen(2, 3).unwrap();
        let r1_a = sign_round1(&bundle.key_packages[0]).unwrap();
        let dup = vec![
            ParticipantCommitments {
                identifier: 1,
                commitments: r1_a.commitments.clone(),
            },
            ParticipantCommitments {
                identifier: 1,
                commitments: r1_a.commitments,
            },
        ];
        let result = commitments_to_map(&dup);
        assert!(matches!(
            result,
            Err(CryptoError::FrostInvalidParticipants { .. })
        ));
    }

    #[test]
    fn zero_identifier_rejected() {
        let result = identifier_from_u16(0);
        assert!(matches!(
            result,
            Err(CryptoError::FrostInvalidParticipants { .. })
        ));
    }
}
