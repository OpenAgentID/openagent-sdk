// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
// openagent-crypto-wasm — foundational cryptographic primitives for the OpenAgent
// ecosystem (Arsenal-TS, AEGIS-TS, OpenAgent SDK TS, OAS reference implementations).
//
// This crate exists to be the *single source of truth* for crypto correctness across
// Rust and TypeScript. The same Rust code compiles to native and to WebAssembly so
// that downstream SDKs in any language receive byte-identical results from byte-identical
// inputs. There is no JavaScript fallback path. There is no "best effort" port. There
// is one implementation, audited once, deployed everywhere.
//
//! # openagent-crypto-wasm
//!
//! Foundational cryptographic primitives for the OpenAgent ecosystem.
//!
//! ## Design
//!
//! - **Pure Rust**, no C FFI, no `openssl`, no `unsafe` (`#![forbid(unsafe_code)]`).
//! - **Dual target**: builds as a native `rlib` for downstream Rust crates AND as a
//!   `cdylib` for `wasm-bindgen` / `wasm-pack` so the same logic ships to JS hosts.
//! - **Result-typed APIs**: every fallible primitive returns
//!   [`Result<T, CryptoError>`]. No panics on user input.
//! - **Constant-time secret comparisons** via [`subtle`].
//! - **Zeroizing** key material — secret bytes are wiped before deallocation.
//! - **Test-vector backed** — RFC 8032 (Ed25519), RFC 5869 (HKDF), RFC 7693 (BLAKE2),
//!   NIST AES-GCM CAVP vectors, RFC 7748 (X25519), RFC 8439 (ChaCha20-Poly1305),
//!   IETF JCS draft test vectors.
//!
//! ## Exported Primitives
//!
//! | Family                 | Operations                                              |
//! |------------------------|---------------------------------------------------------|
//! | Ed25519                | `generate_keypair`, `sign`, `verify`, `public_from_private` |
//! | X25519                 | `generate_keypair`, `diffie_hellman`                    |
//! | FROST-Ed25519          | `trusted_keygen`, `sign_round1`, `sign_round2`, `aggregate`, `verify` |
//! | HKDF-SHA256            | `extract`, `expand`, `derive`                           |
//! | BLAKE3                 | `hash`, `keyed_hash`, `derive_key`                      |
//! | SHA-256 / SHA-512      | `hash`                                                  |
//! | AES-256-GCM            | `encrypt`, `decrypt`                                    |
//! | XChaCha20-Poly1305     | `encrypt`, `decrypt`                                    |
//! | Argon2id               | `hash_password`, `verify_password`                      |
//! | JCS (RFC 8785)         | `canonicalize`                                          |
//! | Multibase base58btc    | `encode`, `decode`                                      |
//! | Constant-time          | `ct_eq`                                                 |
//!
//! ## Native vs WASM
//!
//! ```text
//! cargo build                                            # native, default features
//! cargo test                                             # native unit + integration tests
//! wasm-pack build --target bundler -- \
//!     --no-default-features --features wasm              # browser/bundler WASM
//! wasm-pack build --target nodejs -- \
//!     --no-default-features --features wasm              # Node.js WASM
//! ```
//!
//! The `wasm` feature unlocks `#[wasm_bindgen]` exports defined in [`crate::wasm_api`].
//! The default `native` feature exposes the same primitives as plain Rust functions.
//!
//! ## Quick start (Rust)
//!
//! ```
//! use openagent_crypto_wasm::ed25519;
//!
//! let kp = ed25519::generate_keypair();
//! let sig = ed25519::sign(&kp.signing_key_bytes(), b"hello").unwrap();
//! ed25519::verify(&kp.verifying_key_bytes(), b"hello", &sig).unwrap();
//! ```
//!
//! ## Quick start (TypeScript, via `wasm-pack` build output)
//!
//! ```text
//! import init, * as crypto from "openagent-crypto-wasm";
//!
//! await init();
//! const kp = crypto.ed25519_generate_keypair();
//! const sig = crypto.ed25519_sign(kp.signing_key, new TextEncoder().encode("hello"));
//! crypto.ed25519_verify(kp.verifying_key, new TextEncoder().encode("hello"), sig);
//! ```

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub mod aead;
pub mod blake3_hash;
pub mod ct;
pub mod ed25519;
pub mod encoding;
pub mod error;
pub mod frost;
pub mod hkdf_sha256;
pub mod jcs;
pub mod kdf_password;
pub mod sha;
pub mod x25519;

#[cfg(feature = "wasm")]
#[cfg_attr(docsrs, doc(cfg(feature = "wasm")))]
pub mod wasm_api;

pub use error::CryptoError;

/// Crate version, sourced from `Cargo.toml` at compile time.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
