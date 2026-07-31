package id.openagent.sdk

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * ACT (Agent Capability Token) verification, per act/SPECIFICATION.md.
 *
 * Verification follows the normative procedure of section 4.1 *in order* —
 * most importantly, signature verification precedes every claim check,
 * because until the signature verifies the claim set is attacker-controlled.
 */
public object Act {
    /** The implemented format version (`v` field). */
    public const val FORMAT_VERSION: Int = 1

    /** The implemented signature algorithm (`alg` field). */
    public const val ALGORITHM_ED25519: String = "Ed25519"

    /** Hard cap on the envelope size (spec section 2.2). */
    public const val MAX_ACT_BYTES: Int = 16 * 1024

    /** The verified claim set (spec section 3). */
    public data class Claims(
        val jti: String,
        val sub: String,
        val iss: String,
        val aud: List<String>,
        val iat: Long,
        val nbf: Long,
        val exp: Long,
        val tenantId: String,
        val scopes: List<Scope>,
        val ext: Map<String, String>,
    )

    /** The decoded (but unverified) envelope. */
    public data class Envelope(
        val version: Int,
        val alg: String,
        val claims: ByteArray,
        val sig: ByteArray,
        val kid: String?,
    ) {
        public companion object {
            /** Decode the envelope per spec section 4.1 steps 1-3. */
            public fun decode(token: ByteArray): Envelope {
                if (token.size > MAX_ACT_BYTES) {
                    throw OpenAgentError.TooLarge(token.size, MAX_ACT_BYTES)
                }
                val root = CborDecoder(token).decode()
                if (root !is CborValue.Map) {
                    throw OpenAgentError.EnvelopeDecode("envelope is not a map")
                }

                val version = root.lookup("v")?.asInt()
                    ?: throw OpenAgentError.EnvelopeDecode("envelope has no integer 'v'")
                if (version != FORMAT_VERSION.toLong()) {
                    throw OpenAgentError.UnsupportedVersion(version.toInt())
                }

                val alg = root.lookup("alg")?.asText()
                    ?: throw OpenAgentError.EnvelopeDecode("envelope has no text 'alg'")
                if (alg != ALGORITHM_ED25519) {
                    throw OpenAgentError.UnsupportedAlgorithm(alg)
                }

                val claims = root.lookup("claims")?.asBytes()
                    ?: throw OpenAgentError.EnvelopeDecode("envelope 'claims' is not a byte string")
                val sig = root.lookup("sig")?.asBytes()
                    ?: throw OpenAgentError.EnvelopeDecode("envelope 'sig' is not a byte string")
                if (sig.size != 64) {
                    throw OpenAgentError.MalformedSignature(
                        "signature must be exactly 64 bytes, got ${sig.size}")
                }

                return Envelope(version.toInt(), alg, claims, sig, root.lookup("kid")?.asText())
            }
        }
    }

    /**
     * An ACT verifier: trusted keys plus policy bindings.
     *
     * An empty trusted key set fails at construction (spec section 4.2):
     * such a verifier would reject every token, and a startup error must
     * not disguise a misconfiguration as an attack.
     */
    public class Verifier(
        trustedKeys: List<ByteArray>,
        public val expectedIssuer: String,
        public val expectedAudience: String,
        private val requiredScopes: List<Scope> = emptyList(),
        private val leewaySeconds: Long = 0,
        private val clock: () -> Long = { System.currentTimeMillis() / 1000 },
    ) {
        private val trustedRaw: List<ByteArray> =
            trustedKeys.mapIndexed { index, raw ->
                if (raw.size != 32) {
                    throw OpenAgentError.Config("trusted key $index must be 32 bytes, got ${raw.size}")
                }
                raw.copyOf()
            }

        private val keys: List<java.security.PublicKey> =
            trustedRaw.mapIndexed { index, raw ->
                try {
                    KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(ed25519RawToX509(raw)))
                } catch (e: Exception) {
                    throw OpenAgentError.Config("trusted key $index is not a valid Ed25519 key: $e")
                }
            }

        init {
            if (trustedKeys.isEmpty()) {
                throw OpenAgentError.Config("at least one trusted key is required")
            }
            if (expectedIssuer.isEmpty()) {
                throw OpenAgentError.Config("expected issuer is required")
            }
            if (expectedAudience.isEmpty()) {
                throw OpenAgentError.Config("expected audience is required")
            }
        }

        /** Return a verifier with an additional scope requirement. */
        public fun requiringScopes(scopes: List<Scope>): Verifier =
            Verifier(
                trustedRaw,
                expectedIssuer,
                expectedAudience,
                requiredScopes = requiredScopes + scopes,
                leewaySeconds = leewaySeconds,
                clock = clock,
            )

        /** Return a verifier with a pinned clock (tests, decision replay). */
        public fun withClock(nowUnixSeconds: Long): Verifier =
            Verifier(
                trustedRaw,
                expectedIssuer,
                expectedAudience,
                requiredScopes = requiredScopes,
                leewaySeconds = leewaySeconds,
                clock = { nowUnixSeconds },
            )

        /** Verify an ACT envelope (spec section 4.1, in order). */
        public fun verify(token: ByteArray): Claims {
            // Steps 1-3: size, decode, version/algorithm, signature shape.
            val envelope = Envelope.decode(token)

            // Step 4: the signature, BEFORE any claim check. `kid` is a hint
            // for audit and rotation, never authoritative for key selection -
            // every trusted key is tried.
            val signed = keys.any { key ->
                val engine = Signature.getInstance("Ed25519")
                engine.initVerify(key)
                engine.update(envelope.claims)
                engine.verify(envelope.sig)
            }
            if (!signed) {
                throw OpenAgentError.SignatureInvalid(keys.size)
            }

            // Step 5: decode and structurally validate the claim set.
            val claims = decodeClaims(envelope.claims)

            // Step 6: temporal checks with leeway.
            val now = clock()
            if (claims.exp <= now - leewaySeconds) {
                throw OpenAgentError.Expired(claims.exp, now)
            }
            if (claims.nbf > now + leewaySeconds) {
                throw OpenAgentError.NotYetValid(claims.nbf, now)
            }

            // Steps 7-8: issuer and audience.
            if (claims.iss != expectedIssuer) {
                throw OpenAgentError.IssuerMismatch(expectedIssuer, claims.iss)
            }
            if (expectedAudience !in claims.aud) {
                throw OpenAgentError.AudienceMismatch(expectedAudience)
            }

            // Step 9: required scopes covered per section 5.2 (directional).
            for (required in requiredScopes) {
                if (claims.scopes.none { it.covers(required) }) {
                    throw OpenAgentError.MissingScope(required.toString())
                }
            }

            return claims
        }
    }

    private fun decodeClaims(raw: ByteArray): Claims {
        val root =
            try {
                CborDecoder(raw).decode()
            } catch (e: OpenAgentError.EnvelopeDecode) {
                throw OpenAgentError.ClaimsDecode(e.message ?: "claims are not valid CBOR")
            }
        if (root !is CborValue.Map) {
            throw OpenAgentError.ClaimsDecode("claim set is not a map")
        }

        fun needText(name: String): String =
            root.lookup(name)?.asText()?.takeIf { it.isNotEmpty() }
                ?: throw OpenAgentError.ClaimsDecode("missing or blank required claim '$name'")

        fun needInt(name: String): Long =
            root.lookup(name)?.asInt()
                ?: throw OpenAgentError.ClaimsDecode("missing or non-integer required claim '$name'")

        val jti = needText("jti")
        val sub = needText("sub")
        val iss = needText("iss")
        val iat = needInt("iat")
        val nbf = root.lookup("nbf")?.asInt() ?: 0
        val exp = needInt("exp")
        val tenantId = needText("tenant_id")

        val aud: List<String> =
            when {
                root.lookup("aud")?.asText() != null -> listOf(root.lookup("aud")!!.asText()!!)
                root.lookup("aud")?.asArray() != null ->
                    root.lookup("aud")!!.asArray()!!.map {
                        it.asText()
                            ?: throw OpenAgentError.ClaimsDecode("claim 'aud' entries must be strings")
                    }
                else -> throw OpenAgentError.ClaimsDecode("claim 'aud' must be a string or an array of strings")
            }
        if (aud.isEmpty()) {
            throw OpenAgentError.ClaimsDecode("claim 'aud' must be non-empty")
        }

        val scopeItems = root.lookup("scope")?.asArray()
            ?: throw OpenAgentError.ClaimsDecode("claim 'scope' must be a non-empty flat array of strings")
        if (scopeItems.isEmpty()) {
            throw OpenAgentError.ClaimsDecode("claim 'scope' must be non-empty")
        }
        val scopes = scopeItems.map {
            Scope.parse(it.asText()
                ?: throw OpenAgentError.ClaimsDecode("claim 'scope' entries must be strings"))
        }

        if (nbf >= exp) {
            throw OpenAgentError.ClaimsDecode("nbf ($nbf) is not before exp ($exp)")
        }

        val ext = mutableMapOf<String, String>()
        (root.lookup("ext") as? CborValue.Map)?.value?.forEach { (key, value) ->
            key.asText()?.let { ext[it] = render(value) }
        }

        return Claims(jti, sub, iss, aud, iat, nbf, exp, tenantId, scopes, ext)
    }

    private fun render(value: CborValue): String =
        when (value) {
            is CborValue.Uint -> value.value.toString()
            is CborValue.Nint -> (-1 - (value.value.toLong())).toString()
            is CborValue.Bytes -> value.value.joinToString("") { "%02x".format(it) }
            is CborValue.Text -> value.value
            is CborValue.Array -> "[" + value.value.joinToString(",") { render(it) } + "]"
            is CborValue.Map ->
                "{" + value.value.joinToString(",") { (k, v) -> "${k.asText() ?: "?"}:${render(v)}" } + "}"
            is CborValue.Simple -> value.value?.toString() ?: "null"
            is CborValue.Other -> "simple(${value.tag})"
        }

    /** Decode claims WITHOUT verifying the signature, for diagnostics. */
    public fun decodeUnverified(token: ByteArray): Claims? {
        val envelope = Envelope.decode(token)
        return decodeClaims(envelope.claims)
    }

    // X.509 SubjectPublicKeyInfo prefix for a raw Ed25519 public key
    // (RFC 8410): SEQUENCE(SEQUENCE(OID 1.3.101.112), BIT STRING<key>).
    private fun ed25519RawToX509(raw: ByteArray): ByteArray =
        byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ) + raw
}
