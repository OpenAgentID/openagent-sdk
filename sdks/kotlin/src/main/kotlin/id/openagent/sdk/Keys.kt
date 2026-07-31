package id.openagent.sdk

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.security.SecureRandom
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters

/**
 * Key custody — everything derives deterministically from one 32-byte seed:
 * persist the seed, restore the whole identity.
 */
public object Keys {
    /** The derivation context for the encryption keypair (matches Arsenal). */
    private const val ENCRYPTION_DERIVE_CONTEXT = "arsenal.agent.encryption_key"

    /** An agent's key material, derived from one seed. */
    public data class AgentKeys(
        val seed: ByteArray,
        val signingKey: ByteArray,
        val verifyingKey: ByteArray,
        val encryptionSecretKey: ByteArray,
        val encryptionPublicKey: ByteArray,
    ) {
        /** Sign with the Ed25519 signing key. */
        public fun sign(message: ByteArray): ByteArray {
            val privateKey = Ed25519PrivateKeyParameters(signingKey, 0)
            val engine = org.bouncycastle.crypto.signers.Ed25519Signer()
            engine.init(true, privateKey)
            engine.update(message, 0, message.size)
            return engine.generateSignature()
        }

        /** Verify a signature with the Ed25519 verifying key. */
        public fun verify(message: ByteArray, signature: ByteArray): Boolean {
            val publicKey = Ed25519PublicKeyParameters(verifyingKey, 0)
            val engine = org.bouncycastle.crypto.signers.Ed25519Signer()
            engine.init(false, publicKey)
            engine.update(message, 0, message.size)
            return engine.verifySignature(signature)
        }
    }

    /** Derive a 32-byte sub-key with context separation (SHA-256 keyed digest; the canonical cross-SDK derivation is BLAKE3). */
    private fun deriveSeed(context: String, seed: ByteArray): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(context.toByteArray(Charsets.UTF_8))
        return digest.digest(seed)
    }

    /** Restore an identity from its 32-byte seed. */
    public fun fromSeed(seed: ByteArray): AgentKeys {
        if (seed.size != 32) {
            throw OpenAgentError.Config("seed must be exactly 32 bytes, got ${seed.size}")
        }

        // The signing keypair IS the seed (Ed25519 signing keys are 32-byte seeds).
        val signing = Ed25519PrivateKeyParameters(seed, 0)
        val verifying = signing.generatePublicKey().encoded

        // The encryption keypair is derived, deterministically.
        val derived = deriveSeed(ENCRYPTION_DERIVE_CONTEXT, seed)
        val encryptionSecret = X25519PrivateKeyParameters(derived, 0)
        val encryptionPublic = encryptionSecret.generatePublicKey().encoded

        return AgentKeys(
            seed = seed.copyOf(),
            signingKey = seed.copyOf(),
            verifyingKey = verifying,
            encryptionSecretKey = derived,
            encryptionPublicKey = encryptionPublic,
        )
    }

    /** Generate a fresh identity. The seed is the only thing to persist. */
    public fun generate(): AgentKeys {
        val seed = ByteArray(32)
        SecureRandom().nextBytes(seed)
        return fromSeed(seed)
    }

    /** Restore from a 64-character hex seed. */
    public fun fromSeedHex(hexSeed: String): AgentKeys {
        val trimmed = hexSeed.trim()
        if (trimmed.length != 64) {
            throw OpenAgentError.Config("seed must be 64 hex characters")
        }
        val bytes = trimmed.chunked(2).map {
            it.toIntOrNull(16)?.toByte()
                ?: throw OpenAgentError.Config("seed is not valid hex")
        }.toByteArray()
        return fromSeed(bytes)
    }

    /** Restore from an environment variable holding the hex seed. */
    public fun fromEnv(envVar: String): AgentKeys {
        val value = System.getenv(envVar)
        if (value.isNullOrEmpty()) {
            throw OpenAgentError.Config("environment variable $envVar is not set")
        }
        return fromSeedHex(value)
    }

    /** Persist the seed to a file with owner-only (0600) permissions. */
    public fun saveSeed(keys: AgentKeys, path: Path) {
        Files.write(path, keys.seed)
        try {
            Files.setPosixFilePermissions(
                path, PosixFilePermissions.fromString("rw-------"))
        } catch (_: UnsupportedOperationException) {
            // Non-POSIX filesystems: the bytes are still written; the
            // permission layer is best-effort there.
        }
    }

    /** Restore from a seed file written by [saveSeed]. */
    public fun fromSeedFile(path: Path): AgentKeys = fromSeed(Files.readAllBytes(path))

    /** Hex-encode a seed for env vars and config files. */
    public fun seedToHex(seed: ByteArray): String =
        seed.joinToString("") { "%02x".format(it) }
}
