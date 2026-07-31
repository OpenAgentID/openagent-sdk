package id.openagent.sdk

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationPlugin
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.header
import io.ktor.server.response.respond
import io.ktor.util.AttributeKey
import java.util.Base64

/**
 * Ktor server plugin for ACT verification.
 *
 * ```kotlin
 * val verifier = Act.Verifier(listOf(brokerKey), "arsenal:broker:prod-1", "my-service")
 * install(ActAuth) {
 *     this.verifier = verifier
 *     scopes = listOf(Scope.parse("tools:calendar:invoke"))
 * }
 * ```
 *
 * A request with a missing, forged, expired, wrong-audience, or
 * under-scoped token gets a 401 with the reason and the route never runs;
 * verified claims land in `call.attributes[ActClaimsKey]`.
 */
public val ActClaimsKey: AttributeKey<Act.Claims> = AttributeKey("ActClaims")

public class ActAuthConfig {
    public lateinit var verifier: Act.Verifier
    public var scopes: List<Scope> = emptyList()
}

public val ActAuth: ApplicationPlugin<ActAuthConfig> =
    createApplicationPlugin("ActAuth", ::ActAuthConfig) {
        val configured = pluginConfig.verifier
        val bound =
            if (pluginConfig.scopes.isEmpty()) configured
            else configured.requiringScopes(pluginConfig.scopes)

        onCall { call ->
            val token = extractToken(call.request.header("Authorization"))
            if (token == null) {
                call.respondUnauthorized("missing or malformed capability token")
                return@onCall
            }

            val claims =
                try {
                    bound.verify(token)
                } catch (e: OpenAgentError) {
                    call.respondUnauthorized("ACT verification failed: ${e.message}")
                    return@onCall
                }

            call.attributes.put(ActClaimsKey, claims)
        }
    }

private suspend fun ApplicationCall.respondUnauthorized(reason: String) {
    response.headers.append("WWW-Authenticate", "OpenAgent")
    respond(HttpStatusCode.Unauthorized, mapOf("error" to reason))
}

internal fun extractToken(authorization: String?): ByteArray? {
    if (authorization == null) return null
    val parts = authorization.trim().split(' ', limit = 2)
    if (parts.size != 2) return null
    val (scheme, token) = parts
    if (!scheme.equals("Bearer", ignoreCase = true) && !scheme.equals("OpenAgent", ignoreCase = true)) {
        return null
    }
    val trimmed = token.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.any { it !in 'A'..'Z' && it !in 'a'..'z' && it !in '0'..'9' && it != '-' && it != '_' }) {
        return null
    }
    return try {
        Base64.getUrlDecoder().decode(trimmed)
    } catch (_: IllegalArgumentException) {
        null
    }
}
