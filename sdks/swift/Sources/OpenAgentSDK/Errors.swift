import Foundation

/// Errors for the OpenAgent SDK, mirroring the canonical ACT error surface
/// (act/SPECIFICATION.md section 4) so a forged token reports distinctly
/// from an expired one.
public enum OpenAgentError: Error, Equatable {
    // Configuration
    case config(String)

    // ACT verification failures (spec section 4)
    case tooLarge(size: Int, maximum: Int)
    case envelopeDecode(String)
    case unsupportedVersion(Int)
    case unsupportedAlgorithm(String)
    case malformedSignature(String)
    case signatureInvalid(trustedKeyCount: Int)
    case claimsDecode(String)
    case expired(exp: Int64, now: Int64)
    case notYetValid(nbf: Int64, now: Int64)
    case issuerMismatch(expected: String, actual: String)
    case audienceMismatch(expected: String)
    case missingScope(String)
    case malformedScope(String, reason: String)
}

extension OpenAgentError: CustomStringConvertible {
    public var description: String {
        switch self {
        case .config(let detail):
            return "config error: \(detail)"
        case .tooLarge(let size, let maximum):
            return "token is \(size) bytes, exceeding the \(maximum)-byte maximum"
        case .envelopeDecode(let detail):
            return "envelope decode failed: \(detail)"
        case .unsupportedVersion(let version):
            return "unsupported ACT format version \(version); this verifier implements version 1"
        case .unsupportedAlgorithm(let alg):
            return "unsupported ACT signature algorithm: \(alg)"
        case .malformedSignature(let detail):
            return "malformed signature: \(detail)"
        case .signatureInvalid(let count):
            return "signature verification failed against all \(count) trusted keys"
        case .claimsDecode(let detail):
            return "invalid claim set: \(detail)"
        case .expired(let exp, let now):
            return "token expired at \(exp) (now \(now))"
        case .notYetValid(let nbf, let now):
            return "token not valid until \(nbf) (now \(now))"
        case .issuerMismatch(let expected, let actual):
            return "issuer mismatch: expected \"\(expected)\", got \"\(actual)\""
        case .audienceMismatch(let expected):
            return "audience mismatch: \"\(expected)\" is not among the token audiences"
        case .missingScope(let scope):
            return "missing required scope: \(scope)"
        case .malformedScope(let scope, let reason):
            return "malformed scope \"\(scope)\": \(reason)"
        }
    }
}
