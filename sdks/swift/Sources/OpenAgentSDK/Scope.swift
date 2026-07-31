import Foundation

/// The ACT scope grammar (act/SPECIFICATION.md section 5).
///
/// A scope is exactly three non-empty, colon-separated segments:
/// `service ":" resource ":" action`.
///
/// Matching is directional: `*` expands in a GRANT and is literal in a
/// REQUEST. Otherwise a holder of `tools:calendar:invoke` could request
/// `tools:calendar:*` and be authorized for actions it was never granted.
public struct Scope: Equatable, Hashable, Sendable, CustomStringConvertible {
    public static let segmentCount = 3
    public static let wildcard = "*"

    public let service: String
    public let resource: String
    public let action: String

    private init(service: String, resource: String, action: String) {
        self.service = service
        self.resource = resource
        self.action = action
    }

    /// Parse a scope string of exactly three non-empty segments.
    public static func parse(_ text: String) throws -> Scope {
        guard !text.isEmpty, text.count <= 512 else {
            throw OpenAgentError.malformedScope(text, reason: "empty or over 512 characters")
        }
        let parts = text.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == segmentCount else {
            throw OpenAgentError.malformedScope(
                text, reason: "must have exactly \(segmentCount) segments, got \(parts.count)")
        }
        guard parts.allSatisfy({ !$0.isEmpty }) else {
            throw OpenAgentError.malformedScope(text, reason: "segments must be non-empty")
        }
        return Scope(service: parts[0], resource: parts[1], action: parts[2])
    }

    /// Whether this GRANT covers the REQUESTED scope.
    ///
    /// `*` expands in the grant only. A `*` in the request matches literally
    /// (a grant must literally contain `*` in that segment).
    public func covers(_ requested: Scope) -> Bool {
        let granted = [service, resource, action]
        let wanted = [requested.service, requested.resource, requested.action]
        return zip(granted, wanted).allSatisfy { g, w in g == Scope.wildcard || g == w }
    }

    public var description: String {
        "\(service):\(resource):\(action)"
    }
}
