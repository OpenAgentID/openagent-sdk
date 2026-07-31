package id.openagent.sdk

import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

// The canonical ACT conformance vectors (conformance/vectors/arsenal/
// act-verify.json) — the same 13 vectors that gate Rust, TypeScript,
// Python, Go, and Swift. Kotlin verifies through its own spec-exact
// implementation, and the vectors prove it agrees with the canonical crate.

class VectorTest {

    private fun hexDecode(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private data class Vector(
        val name: String,
        val envelopeHex: String,
        val trustedKeyHex: String,
        val issuer: String,
        val audience: String,
        val scopes: List<String>,
        val leewaySeconds: Long,
        val now: Long,
        val verdict: String,
        val sub: String?,
        val jti: String?,
        val tenantId: String?,
        val reasonClass: String,
    )

    private fun loadVectors(path: Path): List<Vector> {
        // Minimal, dependency-free JSON reading for the known vector shape:
        // the file is machine-generated with a stable layout, so a small
        // regex-based extractor is adequate and keeps the test free of a
        // JSON library dependency.
        val text = path.readText()
        val vectors = mutableListOf<Vector>()
        // Parse only inside the "vectors" array: the file's top-level "name"
        // field ("act-verify") would otherwise be mistaken for a vector.
        // Keys are alphabetized by the generator, so "name" sits after
        // "input" inside each vector object; object boundaries are the
        // reliable split point.
        val arrayStart = text.indexOf("\"vectors\": [")
        if (arrayStart < 0) fail("vectors file has no vectors array")
        val body = text.substring(arrayStart)
        val blocks = body.split("    },\n    {")
        for (block in blocks) {
            fun str(key: String): String? {
                val match = Regex("\"$key\": \"([^\"]*)\"").find(block)
                return match?.groupValues?.get(1)
            }
            fun int(key: String): Long? =
                Regex("\"$key\": (-?\\d+)").find(block)?.groupValues?.get(1)?.toLong()
            fun stringList(key: String): List<String> {
                val match = Regex("\"$key\": \\[([^]]*)\\]").find(block) ?: return emptyList()
                return Regex("\"([^\"]*)\"").findAll(match.groupValues[1]).map { it.groupValues[1] }.toList()
            }

            vectors += Vector(
                name = str("name") ?: fail("vector missing name"),
                envelopeHex = str("envelope_hex") ?: fail("missing envelope_hex"),
                trustedKeyHex = str("trusted_key_hex") ?: fail("missing trusted_key_hex"),
                issuer = str("issuer") ?: "",
                audience = str("audience") ?: "",
                scopes = stringList("scopes"),
                leewaySeconds = int("leeway_seconds") ?: 0,
                now = int("now_unix_seconds") ?: fail("missing now_unix_seconds"),
                verdict = str("verdict") ?: fail("missing verdict"),
                sub = str("sub"),
                jti = str("jti"),
                tenantId = str("tenant_id"),
                reasonClass = str("reason_class") ?: "",
            )
        }
        return vectors
    }

    private fun vectorsPath(): Path {
        // Resolve from the compiled test class location: build/classes/kotlin/test
        // -> sdks/kotlin/build -> sdks/kotlin -> sdks -> openagent-sdk -> repo.
        val codeSource = javaClass.protectionDomain.codeSource.location.toURI().path
        val classDir = Path(codeSource)
        var dir = classDir
        repeat(10) {
            val candidate = dir.resolve("conformance/vectors/arsenal/act-verify.json")
            if (candidate.exists()) return candidate
            dir = dir.parent ?: return@repeat
        }
        fail("could not locate conformance/vectors/arsenal/act-verify.json from $classDir")
    }

    @Test
    fun `canonical ACT vectors`() {
        for (vector in loadVectors(vectorsPath())) {
            runVector(vector)
        }
    }

    private fun runVector(vector: Vector) {
        val envelope = hexDecode(vector.envelopeHex)
        val trustedKey = hexDecode(vector.trustedKeyHex)
        val scopes = vector.scopes.map { Scope.parse(it) }

        val base = Act.Verifier(
            listOf(trustedKey),
            vector.issuer,
            vector.audience,
            leewaySeconds = vector.leewaySeconds,
        ).withClock(vector.now)
        val verifier = if (scopes.isEmpty()) base else base.requiringScopes(scopes)

        var claims: Act.Claims? = null
        var failure: OpenAgentError? = null
        try {
            claims = verifier.verify(envelope)
        } catch (e: OpenAgentError) {
            failure = e
        }

        when (vector.verdict) {
            "accept" -> {
                assertNotNull(claims, "expected accept, verification failed: ${failure?.message} [${vector.name}]")
                vector.sub?.let { assertTrue(claims.sub == it, "${vector.name}: sub mismatch") }
                vector.jti?.let { assertTrue(claims.jti == it, "${vector.name}: jti mismatch") }
                vector.tenantId?.let {
                    assertTrue(claims.tenantId == it, "${vector.name}: tenant_id mismatch")
                }
            }
            "reject" -> {
                assertNull(claims, "expected reject, token verified [${vector.name}]")
                assertNotNull(failure, "expected reject, no failure recorded [${vector.name}]")
                if (vector.reasonClass.isNotEmpty()) {
                    assertTrue(
                        failure.message.orEmpty().contains(vector.reasonClass),
                        "${vector.name}: error \"${failure.message}\" does not contain \"${vector.reasonClass}\"",
                    )
                }
            }
            else -> fail("unknown verdict ${vector.verdict} [${vector.name}]")
        }
    }
}
