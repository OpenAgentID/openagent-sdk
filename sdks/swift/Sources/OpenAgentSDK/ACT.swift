import Foundation
import Crypto

/// ACT (Agent Capability Token) verification, per act/SPECIFICATION.md.
///
/// Verification follows the normative procedure of section 4.1 *in order* —
/// most importantly, signature verification precedes every claim check,
/// because until the signature verifies the claim set is attacker-controlled.
public enum ACT {
    /// The implemented format version (`v` field).
    public static let formatVersion = 1
    /// The implemented signature algorithm (`alg` field).
    public static let algorithmEd25519 = "Ed25519"
    /// Hard cap on the envelope size (spec section 2.2).
    public static let maxActBytes = 16 * 1024

    /// The verified claim set (spec section 3). `ext` carries issuer-defined
    /// policy this verifier does not evaluate; its contents are
    /// signature-covered and passed through intact as raw values.
    public struct Claims: Sendable {
        public let jti: String
        public let sub: String
        public let iss: String
        public let aud: [String]
        public let iat: Int64
        public let nbf: Int64
        public let exp: Int64
        public let tenantId: String
        public let scopes: [Scope]
        public let ext: [String: String]
    }

    /// The decoded (but unverified) envelope.
    public struct Envelope {
        public let version: Int
        public let alg: String
        public let claims: [UInt8]
        public let sig: [UInt8]
        public let kid: String?

        /// Decode the envelope per spec section 4.1 steps 1-3: size cap,
        /// decode, version and algorithm checks, signature shape.
        public static func decode(_ token: [UInt8]) throws -> Envelope {
            if token.count > maxActBytes {
                throw OpenAgentError.tooLarge(size: token.count, maximum: maxActBytes)
            }
            var decoder = CBORDecoder(token)
            let root = try decoder.decode()
            guard case .map = root else {
                throw OpenAgentError.envelopeDecode("envelope is not a map")
            }

            guard let version = root.lookup("v")?.asInt else {
                throw OpenAgentError.envelopeDecode("envelope has no integer 'v'")
            }
            guard version == formatVersion else {
                throw OpenAgentError.unsupportedVersion(Int(version))
            }

            guard let alg = root.lookup("alg")?.asText else {
                throw OpenAgentError.envelopeDecode("envelope has no text 'alg'")
            }
            guard alg == algorithmEd25519 else {
                throw OpenAgentError.unsupportedAlgorithm(alg)
            }

            guard let claims = root.lookup("claims")?.asBytes else {
                throw OpenAgentError.envelopeDecode("envelope 'claims' is not a byte string")
            }
            guard let sig = root.lookup("sig")?.asBytes else {
                throw OpenAgentError.envelopeDecode("envelope 'sig' is not a byte string")
            }
            guard sig.count == 64 else {
                throw OpenAgentError.malformedSignature(
                    "signature must be exactly 64 bytes, got \(sig.count)")
            }

            return Envelope(
                version: Int(version), alg: alg, claims: claims, sig: sig,
                kid: root.lookup("kid")?.asText)
        }
    }

    /// An ACT verifier: trusted keys plus policy bindings.
    ///
    /// An empty trusted key set fails at construction (spec section 4.2):
    /// such a verifier would reject every token, and a startup error must
    /// not disguise a misconfiguration as an attack.
    public struct Verifier: Sendable {
        public typealias Clock = @Sendable () -> Int64

        private let keys: [Curve25519.Signing.PublicKey]
        private let issuer: String
        private let audience: String
        private let requiredScopes: [Scope]
        private let leeway: Int64
        private let clock: Clock

        public init(
            trustedKeys: [[UInt8]],
            expectedIssuer: String,
            expectedAudience: String,
            requiredScopes: [Scope] = [],
            leewaySeconds: Int64 = 0,
            clock: @escaping Clock = { Int64(Date().timeIntervalSince1970) }
        ) throws {
            guard !trustedKeys.isEmpty else {
                throw OpenAgentError.config("at least one trusted key is required")
            }
            var parsed: [Curve25519.Signing.PublicKey] = []
            for (index, key) in trustedKeys.enumerated() {
                guard key.count == 32 else {
                    throw OpenAgentError.config("trusted key \(index) must be 32 bytes, got \(key.count)")
                }
                do {
                    parsed.append(try Curve25519.Signing.PublicKey(rawRepresentation: key))
                } catch {
                    throw OpenAgentError.config("trusted key \(index) is not a valid Ed25519 key")
                }
            }
            guard !expectedIssuer.isEmpty else {
                throw OpenAgentError.config("expected issuer is required")
            }
            guard !expectedAudience.isEmpty else {
                throw OpenAgentError.config("expected audience is required")
            }
            self.keys = parsed
            self.issuer = expectedIssuer
            self.audience = expectedAudience
            self.requiredScopes = requiredScopes
            self.leeway = abs(leewaySeconds)
            self.clock = clock
        }

        /// Return a verifier with an additional scope requirement.
        public func requiringScopes(_ scopes: [Scope]) -> Verifier {
            // Reconstructed rather than mutated: verifiers are value types.
            try! Verifier( // construction already validated once; cannot fail here
                trustedKeys: keys.map { Array($0.rawRepresentation) },
                expectedIssuer: issuer,
                expectedAudience: audience,
                requiredScopes: requiredScopes + scopes,
                leewaySeconds: leeway,
                clock: clock)
        }

        /// Return a verifier with a pinned clock (tests, decision replay).
        public func withClock(_ nowUnixSeconds: Int64) -> Verifier {
            try! Verifier(
                trustedKeys: keys.map { Array($0.rawRepresentation) },
                expectedIssuer: issuer,
                expectedAudience: audience,
                requiredScopes: requiredScopes,
                leewaySeconds: leeway,
                clock: { nowUnixSeconds })
        }

        /// Verify an ACT envelope (spec section 4.1, in order).
        public func verify(_ token: [UInt8]) throws -> Claims {
            // Steps 1-3: size, decode, version/algorithm, signature shape.
            let envelope = try Envelope.decode(token)

            // Step 4: the signature, BEFORE any claim check. `kid` is a hint
            // for audit and rotation, never authoritative for key selection -
            // every trusted key is tried.
            let claimsData = Data(envelope.claims)
            let signature = Data(envelope.sig)
            let signed = keys.contains { $0.isValidSignature(signature, for: claimsData) }
            guard signed else {
                throw OpenAgentError.signatureInvalid(trustedKeyCount: keys.count)
            }

            // Step 5: decode and structurally validate the claim set.
            let claims = try decodeClaims(envelope.claims)

            // Step 6: temporal checks with leeway.
            let now = clock()
            if claims.exp <= now - leeway {
                throw OpenAgentError.expired(exp: claims.exp, now: now)
            }
            if claims.nbf > now + leeway {
                throw OpenAgentError.notYetValid(nbf: claims.nbf, now: now)
            }

            // Steps 7-8: issuer and audience.
            guard claims.iss == issuer else {
                throw OpenAgentError.issuerMismatch(expected: issuer, actual: claims.iss)
            }
            guard claims.aud.contains(audience) else {
                throw OpenAgentError.audienceMismatch(expected: audience)
            }

            // Step 9: required scopes covered per section 5.2 (directional).
            for required in requiredScopes {
                guard claims.scopes.contains(where: { $0.covers(required) }) else {
                    throw OpenAgentError.missingScope(required.description)
                }
            }

            return claims
        }
    }

    /// Decode and structurally validate the claim set (spec section 3).
    static func decodeClaims(_ raw: [UInt8]) throws -> Claims {
        var decoder = CBORDecoder(raw)
        let root: CBORValue
        do {
            root = try decoder.decode()
        } catch let error as OpenAgentError {
            if case let .envelopeDecode(detail) = error {
                throw OpenAgentError.claimsDecode(detail)
            }
            throw error
        }
        guard case .map = root else {
            throw OpenAgentError.claimsDecode("claim set is not a map")
        }

        func needText(_ name: String) throws -> String {
            guard let value = root.lookup(name)?.asText, !value.isEmpty else {
                throw OpenAgentError.claimsDecode("missing or blank required claim '\(name)'")
            }
            return value
        }

        func needInt(_ name: String) throws -> Int64 {
            guard let value = root.lookup(name)?.asInt else {
                throw OpenAgentError.claimsDecode("missing or non-integer required claim '\(name)'")
            }
            return value
        }

        let jti = try needText("jti")
        let sub = try needText("sub")
        let iss = try needText("iss")
        let iat = try needInt("iat")
        let nbf = root.lookup("nbf")?.asInt ?? 0
        let exp = try needInt("exp")
        let tenantId = try needText("tenant_id")

        let aud: [String]
        if let single = root.lookup("aud")?.asText {
            aud = [single]
        } else if let items = root.lookup("aud")?.asArray {
            var parsed: [String] = []
            for item in items {
                guard let s = item.asText else {
                    throw OpenAgentError.claimsDecode("claim 'aud' entries must be strings")
                }
                parsed.append(s)
            }
            aud = parsed
        } else {
            throw OpenAgentError.claimsDecode("claim 'aud' must be a string or an array of strings")
        }
        guard !aud.isEmpty else {
            throw OpenAgentError.claimsDecode("claim 'aud' must be non-empty")
        }

        guard let scopeItems = root.lookup("scope")?.asArray, !scopeItems.isEmpty else {
            throw OpenAgentError.claimsDecode("claim 'scope' must be a non-empty flat array of strings")
        }
        var scopes: [Scope] = []
        for item in scopeItems {
            guard let text = item.asText else {
                throw OpenAgentError.claimsDecode("claim 'scope' entries must be strings")
            }
            scopes.append(try Scope.parse(text))
        }

        guard nbf < exp else {
            throw OpenAgentError.claimsDecode("nbf (\(nbf)) is not before exp (\(exp))")
        }

        // ext is preserved, not interpreted: render nested values to a
        // stable string form so the caller can pass them through intact.
        var ext: [String: String] = [:]
        if case let .map(entries)? = root.lookup("ext") {
            for (key, value) in entries {
                guard let name = key.asText else { continue }
                ext[name] = render(value)
            }
        }

        return Claims(
            jti: jti, sub: sub, iss: iss, aud: aud, iat: iat, nbf: nbf, exp: exp,
            tenantId: tenantId, scopes: scopes, ext: ext)
    }

    private static func render(_ value: CBORValue) -> String {
        switch value {
        case let .uint(u): return String(u)
        case let .nint(n): return String(-1 - Int64(min(n, UInt64(Int64.max))))
        case let .bytes(b): return b.map { String(format: "%02x", $0) }.joined()
        case let .text(t): return t
        case let .array(items): return "[" + items.map(render).joined(separator: ",") + "]"
        case let .map(entries):
            return "{" + entries.map { "\($0.0.asText ?? "?"):\(render($0.1))" }.joined(separator: ",") + "}"
        case let .simple(v): return v.map(String.init) ?? "null"
        case let .other(byte): return "simple(\(byte))"
        }
    }
}
