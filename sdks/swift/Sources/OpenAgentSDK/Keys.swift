import Foundation
import Crypto

/// Key custody — everything derives deterministically from one 32-byte
/// seed: persist the seed, restore the whole identity.
public struct AgentKeys: Sendable {
    public let seed: Data
    public let signingKey: Data
    public let verifyingKey: Data
    public let encryptionSecretKey: Data
    public let encryptionPublicKey: Data

    /// Sign with the Ed25519 signing key.
    public func sign(_ message: Data) throws -> Data {
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: signingKey)
        return try key.signature(for: message)
    }
}

/// The derivation context for the encryption keypair (matches Arsenal).
public let encryptionDeriveContext = "arsenal.agent.encryption_key"

public enum Keys {
    /// Derive a 32-byte sub-key with context separation. Swift custody uses
    /// HMAC-SHA256 keyed with the context; the canonical cross-SDK
    /// derivation is BLAKE3. Swift custody is self-consistent.
    private static func deriveSeed(_ context: String, seed: Data) -> Data {
        let key = SymmetricKey(data: Data(context.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: seed, using: key)
        return Data(mac)
    }

    /// Restore an identity from its 32-byte seed.
    public static func fromSeed(_ seed: Data) throws -> AgentKeys {
        guard seed.count == 32 else {
            throw OpenAgentError.config("seed must be exactly 32 bytes, got \(seed.count)")
        }

        // The signing keypair IS the seed (Ed25519 signing keys are 32-byte seeds).
        let signing = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
        let verifying = signing.publicKey.rawRepresentation

        // The encryption keypair is derived, deterministically.
        let derived = deriveSeed(encryptionDeriveContext, seed: seed)
        let encryptionSecret = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: derived)

        return AgentKeys(
            seed: seed,
            signingKey: seed,
            verifyingKey: verifying,
            encryptionSecretKey: derived,
            encryptionPublicKey: encryptionSecret.publicKey.rawRepresentation)
    }

    /// Generate a fresh identity. The seed is the only thing to persist.
    public static func generate() throws -> AgentKeys {
        // Swift's portable CSPRNG (SecRandomCopyBytes on Apple platforms,
        // getrandom/urandom elsewhere).
        var rng = SystemRandomNumberGenerator()
        let seed = Data((0..<32).map { _ in UInt8.random(in: 0...255, using: &rng) })
        return try fromSeed(seed)
    }

    /// Restore from a 64-character hex seed.
    public static func fromSeedHex(_ hex: String) throws -> AgentKeys {
        let trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 64 else {
            throw OpenAgentError.config("seed must be 64 hex characters")
        }
        var bytes = Data()
        bytes.reserveCapacity(32)
        var index = trimmed.startIndex
        while index < trimmed.endIndex {
            let next = trimmed.index(index, offsetBy: 2)
            guard let byte = UInt8(trimmed[index..<next], radix: 16) else {
                throw OpenAgentError.config("seed is not valid hex")
            }
            bytes.append(byte)
            index = next
        }
        return try fromSeed(bytes)
    }

    /// Restore from an environment variable holding the hex seed.
    public static func fromEnv(_ envVar: String) throws -> AgentKeys {
        guard let value = ProcessInfo.processInfo.environment[envVar], !value.isEmpty else {
            throw OpenAgentError.config("environment variable \(envVar) is not set")
        }
        return try fromSeedHex(value)
    }

    /// Persist the seed to a file with owner-only (0600) permissions, in
    /// Arsenal's seed-file format (raw 32 bytes).
    public static func saveSeed(_ keys: AgentKeys, to path: URL) throws {
        try keys.seed.write(to: path, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600], ofItemAtPath: path.path)
    }

    /// Restore from a seed file written by `saveSeed`.
    public static func fromSeedFile(_ path: URL) throws -> AgentKeys {
        try fromSeed(Data(contentsOf: path))
    }

    /// Hex-encode a seed for env vars and config files.
    public static func seedToHex(_ seed: Data) -> String {
        seed.map { String(format: "%02x", $0) }.joined()
    }
}
