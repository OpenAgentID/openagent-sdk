package id.openagent.sdk

/**
 * The ACT scope grammar (act/SPECIFICATION.md section 5).
 *
 * A scope is exactly three non-empty, colon-separated segments:
 * `service ":" resource ":" action`.
 *
 * Matching is directional: `*` expands in a GRANT and is literal in a
 * REQUEST. Otherwise a holder of `tools:calendar:invoke` could request
 * `tools:calendar:*` and be authorized for actions it was never granted.
 */
public class Scope private constructor(
    public val service: String,
    public val resource: String,
    public val action: String,
) {
    init {
        require(service.isNotEmpty() && resource.isNotEmpty() && action.isNotEmpty())
    }

    override fun equals(other: Any?): Boolean =
        other is Scope && service == other.service && resource == other.resource && action == other.action

    override fun hashCode(): Int = listOf(service, resource, action).hashCode()

    /** Whether this GRANT covers the [requested] scope. `*` expands in the grant only. */
    public fun covers(requested: Scope): Boolean {
        val granted = listOf(service, resource, action)
        val wanted = listOf(requested.service, requested.resource, requested.action)
        return granted.zip(wanted).all { (g, w) -> g == WILDCARD || g == w }
    }

    override fun toString(): String = "$service:$resource:$action"

    public companion object {
        public const val SEGMENT_COUNT: Int = 3
        public const val WILDCARD: String = "*"

        /** Parse a scope string of exactly three non-empty segments. */
        public fun parse(text: String): Scope {
            if (text.isEmpty() || text.length > 512) {
                throw OpenAgentError.MalformedScope(text, "empty or over 512 characters")
            }
            val parts = text.split(':')
            if (parts.size != SEGMENT_COUNT) {
                throw OpenAgentError.MalformedScope(
                    text, "must have exactly $SEGMENT_COUNT segments, got ${parts.size}")
            }
            if (parts.any { it.isEmpty() }) {
                throw OpenAgentError.MalformedScope(text, "segments must be non-empty")
            }
            return Scope(parts[0], parts[1], parts[2])
        }
    }
}
