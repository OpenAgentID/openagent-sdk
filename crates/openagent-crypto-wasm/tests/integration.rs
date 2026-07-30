//! Integration tests for `openagent-crypto-wasm`.
//!
//! Exercises the full primitives surface together to catch any cross-module
//! regressions. Each module also has its own unit tests.

use hex_literal::hex;
use openagent_crypto_wasm::{
    aead, blake3_hash, ct, ed25519, encoding, frost, hkdf_sha256, jcs, kdf_password, sha, x25519,
};

#[test]
fn ed25519_full_workflow() {
    let kp = ed25519::generate_keypair();
    let sig = ed25519::sign(&kp.signing_key_bytes(), b"openagent integration").unwrap();
    ed25519::verify(&kp.verifying_key_bytes(), b"openagent integration", &sig).unwrap();
    assert!(ed25519::verify(&kp.verifying_key_bytes(), b"different", &sig).is_err());
}

#[test]
fn x25519_dh_then_hkdf_chain() {
    let alice = x25519::generate_keypair();
    let bob = x25519::generate_keypair();
    let alice_dh =
        x25519::diffie_hellman(&alice.secret_key_bytes(), &bob.public_key_bytes()).unwrap();
    let bob_dh =
        x25519::diffie_hellman(&bob.secret_key_bytes(), &alice.public_key_bytes()).unwrap();
    assert_eq!(alice_dh, bob_dh);

    let session_key = hkdf_sha256::derive(
        b"openagent-crypto-wasm v0.1.0 session",
        &alice_dh,
        b"alice<->bob",
        32,
    )
    .unwrap();
    assert_eq!(session_key.len(), 32);

    // Use the derived session key with AES-256-GCM.
    let nonce = [0u8; 12];
    let pt = b"the autonomous agent has arrived";
    let ct = aead::aes256gcm_encrypt(&session_key, &nonce, pt, b"openagent").unwrap();
    let recovered = aead::aes256gcm_decrypt(&session_key, &nonce, &ct, b"openagent").unwrap();
    assert_eq!(recovered.as_slice(), pt.as_slice());
}

#[test]
fn jcs_then_blake3_then_sign_then_verify() {
    let json = r#"{"parentDid":"did:oas:test:hmr:alice","childDid":"did:oas:test:agent:bob","derivationPath":"/agent-bob"}"#;
    let canonical = jcs::canonicalize(json).unwrap();

    // Hashing the canonical bytes is what an AEGIS signing surface would do.
    let hash = blake3_hash::hash(&canonical);
    assert_eq!(hash.len(), 32);

    let kp = ed25519::generate_keypair();
    let sig = ed25519::sign(&kp.signing_key_bytes(), &canonical).unwrap();
    ed25519::verify(&kp.verifying_key_bytes(), &canonical, &sig).unwrap();
}

#[test]
fn argon2id_round_trip_via_public_api() {
    let encoded = kdf_password::hash_password(b"strong passphrase").unwrap();
    assert!(kdf_password::verify_password(b"strong passphrase", &encoded).unwrap());
    assert!(!kdf_password::verify_password(b"wrong passphrase", &encoded).unwrap());
}

#[test]
fn multibase_encoding_round_trip_with_real_pubkey() {
    let kp = ed25519::generate_keypair();
    let encoded = encoding::encode(&kp.verifying_key_bytes());
    assert!(encoded.starts_with('z'));
    let decoded = encoding::decode(&encoded).unwrap();
    assert_eq!(decoded, kp.verifying_key_bytes());
}

#[test]
fn ct_eq_distinguishes_real_signatures() {
    let kp = ed25519::generate_keypair();
    let sig_a = ed25519::sign(&kp.signing_key_bytes(), b"a").unwrap();
    let sig_b = ed25519::sign(&kp.signing_key_bytes(), b"b").unwrap();
    assert!(!ct::ct_eq(&sig_a, &sig_b));
    assert!(ct::ct_eq(&sig_a, &sig_a));
}

#[test]
fn sha256_and_sha512_match_known_digest_for_abc() {
    let expected_256 = hex!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert_eq!(sha::sha256(b"abc"), expected_256);

    let expected_512 = hex!(
        "ddaf35a193617abacc417349ae204131"
        "12e6fa4e89a97ea20a9eeee64b55d39a"
        "2192992a274fc1a836ba3c23a3feebbd"
        "454d4423643ce80e2a9ac94fa54ca49f"
    );
    assert_eq!(sha::sha512(b"abc"), expected_512);
}

#[test]
fn xchacha20poly1305_round_trip_through_session_key() {
    let kp_a = x25519::generate_keypair();
    let kp_b = x25519::generate_keypair();
    let dh = x25519::diffie_hellman(&kp_a.secret_key_bytes(), &kp_b.public_key_bytes()).unwrap();
    let key = hkdf_sha256::derive(b"openagent xchacha test", &dh, b"shared key", 32).unwrap();

    let nonce = [0xAAu8; 24];
    let ct = aead::xchacha20poly1305_encrypt(&key, &nonce, b"top secret", b"context").unwrap();
    let pt = aead::xchacha20poly1305_decrypt(&key, &nonce, &ct, b"context").unwrap();
    assert_eq!(pt.as_slice(), b"top secret".as_slice());

    // Wrong context fails.
    let bad = aead::xchacha20poly1305_decrypt(&key, &nonce, &ct, b"different");
    assert!(bad.is_err());
}

#[test]
fn frost_2_of_3_full_pipeline() {
    let bundle = frost::trusted_keygen(2, 3).unwrap();
    assert_eq!(bundle.key_packages.len(), 3);
    assert_eq!(bundle.group_public_key.len(), 32);

    let signers = [1u16, 3];
    let message = b"approve identity creation";

    let r1_signer1 = frost::sign_round1(&bundle.key_packages[0]).unwrap();
    let r1_signer3 = frost::sign_round1(&bundle.key_packages[2]).unwrap();

    let commitments = vec![
        frost::ParticipantCommitments {
            identifier: signers[0],
            commitments: r1_signer1.commitments.clone(),
        },
        frost::ParticipantCommitments {
            identifier: signers[1],
            commitments: r1_signer3.commitments.clone(),
        },
    ];

    let share1 = frost::sign_round2(
        &bundle.key_packages[0],
        &r1_signer1.nonces,
        message,
        &commitments,
    )
    .unwrap();
    let share3 = frost::sign_round2(
        &bundle.key_packages[2],
        &r1_signer3.nonces,
        message,
        &commitments,
    )
    .unwrap();

    let shares = vec![
        frost::ParticipantShare {
            identifier: signers[0],
            share: share1,
        },
        frost::ParticipantShare {
            identifier: signers[1],
            share: share3,
        },
    ];

    let signature =
        frost::aggregate(message, &commitments, &shares, &bundle.public_key_package).unwrap();
    assert_eq!(signature.len(), 64);

    // FROST signatures must verify as standard Ed25519 signatures.
    frost::verify(message, &signature, &bundle.group_public_key).unwrap();
    ed25519::verify(&bundle.group_public_key, message, &signature).unwrap();
}
