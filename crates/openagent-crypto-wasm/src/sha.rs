//! SHA-256 and SHA-512 hash functions (FIPS 180-4).
//!
//! These are intentionally minimal — both functions take any byte slice and
//! return a fixed-size hash. There is no streaming API in the WASM-facing
//! surface; if you need streaming, use the crate via its native Rust target.

use sha2::{Digest, Sha256, Sha512};

/// Length of a SHA-256 hash in bytes.
pub const SHA256_LEN: usize = 32;
/// Length of a SHA-512 hash in bytes.
pub const SHA512_LEN: usize = 64;

/// Computes the SHA-256 hash of `data`.
pub fn sha256(data: &[u8]) -> [u8; SHA256_LEN] {
    let mut h = Sha256::new();
    h.update(data);
    let out = h.finalize();
    let mut result = [0u8; SHA256_LEN];
    result.copy_from_slice(&out);
    result
}

/// Computes the SHA-512 hash of `data`.
pub fn sha512(data: &[u8]) -> [u8; SHA512_LEN] {
    let mut h = Sha512::new();
    h.update(data);
    let out = h.finalize();
    let mut result = [0u8; SHA512_LEN];
    result.copy_from_slice(&out);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex_literal::hex;

    // FIPS 180-4 / NIST CAVP test vectors for SHA-256.
    #[test]
    fn sha256_empty_string() {
        let expected = hex!("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256(b""), expected);
    }

    #[test]
    fn sha256_abc() {
        let expected = hex!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(sha256(b"abc"), expected);
    }

    #[test]
    fn sha256_56_byte_message() {
        let msg = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        let expected = hex!("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        assert_eq!(sha256(msg), expected);
    }

    // FIPS 180-4 / NIST CAVP test vectors for SHA-512.
    #[test]
    fn sha512_empty_string() {
        let expected = hex!(
            "cf83e1357eefb8bdf1542850d66d8007"
            "d620e4050b5715dc83f4a921d36ce9ce"
            "47d0d13c5d85f2b0ff8318d2877eec2f"
            "63b931bd47417a81a538327af927da3e"
        );
        assert_eq!(sha512(b""), expected);
    }

    #[test]
    fn sha512_abc() {
        let expected = hex!(
            "ddaf35a193617abacc417349ae204131"
            "12e6fa4e89a97ea20a9eeee64b55d39a"
            "2192992a274fc1a836ba3c23a3feebbd"
            "454d4423643ce80e2a9ac94fa54ca49f"
        );
        assert_eq!(sha512(b"abc"), expected);
    }

    #[test]
    fn sha256_deterministic() {
        let a = sha256(b"hello world");
        let b = sha256(b"hello world");
        assert_eq!(a, b);
    }

    #[test]
    fn sha512_deterministic() {
        let a = sha512(b"hello world");
        let b = sha512(b"hello world");
        assert_eq!(a, b);
    }
}
