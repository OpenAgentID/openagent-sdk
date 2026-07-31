package id.openagent.sdk

import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OpenAgentTest {

    @Test
    fun `scope grammar - three segments`() {
        val scope = Scope.parse("tools:calendar:invoke")
        assertEquals("tools", scope.service)
        assertEquals("calendar", scope.resource)
        assertEquals("invoke", scope.action)
        assertEquals("tools:calendar:invoke", scope.toString())
    }

    @Test
    fun `scope grammar - rejections`() {
        for (bad in listOf("", "tools:invoke", "tools::invoke", "a:b:c:d")) {
            assertFailsWith<OpenAgentError.MalformedScope> { Scope.parse(bad) }
        }
    }

    @Test
    fun `scope matching - wildcard expands in grant, never in request`() {
        val grant = Scope.parse("tools:*:invoke")
        assertTrue(grant.covers(Scope.parse("tools:calendar:invoke")))
        assertFalse(grant.covers(Scope.parse("tools:calendar:delete")))

        // The non-widening rule: holding tools:calendar:invoke must NOT
        // authorize a request for tools:calendar:*.
        val narrow = Scope.parse("tools:calendar:invoke")
        assertFalse(narrow.covers(Scope.parse("tools:calendar:*")))
    }

    @Test
    fun `verifier construction - empty keys fail at construction`() {
        assertFailsWith<OpenAgentError.Config> {
            Act.Verifier(emptyList(), "iss", "aud")
        }
    }

    @Test
    fun `verifier construction - blank bindings fail`() {
        val key = ByteArray(32)
        assertFailsWith<OpenAgentError.Config> { Act.Verifier(listOf(key), "", "aud") }
        assertFailsWith<OpenAgentError.Config> { Act.Verifier(listOf(key), "iss", "") }
    }

    @Test
    fun `envelope - oversized input refused`() {
        assertFailsWith<OpenAgentError.TooLarge> {
            Act.Envelope.decode(ByteArray(Act.MAX_ACT_BYTES + 1))
        }
    }

    @Test
    fun `key custody - deterministic restore`() {
        val seed = ByteArray(32) { it.toByte() }
        val a = Keys.fromSeed(seed)
        val b = Keys.fromSeed(seed)
        assertContentEquals(a.signingKey, b.signingKey)
        assertContentEquals(a.verifyingKey, b.verifyingKey)
        assertContentEquals(a.encryptionSecretKey, b.encryptionSecretKey)
        assertFalse(a.encryptionSecretKey.contentEquals(a.signingKey))
    }

    @Test
    fun `key custody - hex round trip`() {
        val keys = Keys.generate()
        val hex = Keys.seedToHex(keys.seed)
        assertEquals(64, hex.length)
        val restored = Keys.fromSeedHex(hex)
        assertContentEquals(keys.verifyingKey, restored.verifyingKey)
    }

    @Test
    fun `key custody - sign and verify round trip`() {
        val keys = Keys.generate()
        val message = "openagent kotlin test".toByteArray()
        val signature = keys.sign(message)
        assertTrue(keys.verify(message, signature))
        assertFalse(keys.verify("tampered".toByteArray(), signature))
    }

    @Test
    fun `key custody - seed file round trip with owner-only permissions`() {
        val keys = Keys.generate()
        val dir = createTempDirectory("openagent-keys")
        val path = dir.resolve("agent.seed")
        Keys.saveSeed(keys, path)
        val restored = Keys.fromSeedFile(path)
        assertContentEquals(keys.signingKey, restored.signingKey)
    }

    @Test
    fun `ktor token extraction - bearer and openagent schemes`() {
        val token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("token-bytes".toByteArray())
        assertContentEquals("token-bytes".toByteArray(), extractToken("Bearer $token"))
        assertContentEquals("token-bytes".toByteArray(), extractToken("OpenAgent $token"))
    }

    @Test
    fun `ktor token extraction - rejections`() {
        assertNull(extractToken(null))
        assertNull(extractToken(""))
        assertNull(extractToken("Basic abc"))
        assertNull(extractToken("Bearer"))
        assertNull(extractToken("Bearer !!!bad!!!"))
    }
}
