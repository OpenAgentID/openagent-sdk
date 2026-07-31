import Foundation

/// The Agent façade — identity, authentication, and capability grants.
///
/// The façade composes the pieces: key custody (`Keys`), the Core Protocol
/// challenge-response flow, and ACT verification (`ACT.Verifier`). Protocol
/// internals stay reachable underneath — the façade is the front door, not
/// a reduced API.
public struct Agent: Sendable {
    public let keys: AgentKeys
    public let did: String?

    private init(keys: AgentKeys, did: String?) {
        self.keys = keys
        self.did = did
    }

    /// Create a fresh identity (keys, not network).
    public static func create(name: String, did: String? = nil) throws -> Agent {
        Agent(keys: try Keys.generate(), did: did ?? "did:oas:l1fe:agent:\(name)")
    }

    /// Restore an identity from its seed.
    public static func fromSeed(_ seed: Data, did: String? = nil) throws -> Agent {
        Agent(keys: try Keys.fromSeed(seed), did: did)
    }

    /// An authenticated session from the Core Protocol identity flow.
    public struct Session: Sendable {
        public let baseURL: URL
        public let sessionToken: String
        public let did: String
        public let expiresAt: Int64
        public let trustTier: String
        public let capabilities: [String]

        /// The Authorization header value for subsequent requests.
        public var authorizationHeader: String {
            "OpenAgent \(sessionToken)"
        }
    }

    /// Run the Core Protocol identity flow against a server: fetch an
    /// `openagent-challenge-v1`, sign the JCS-canonical challenge bytes,
    /// prove, and hold the session.
    public func authenticate(baseURL: URL) async throws -> Session {
        guard let did else {
            throw OpenAgentError.config("this agent has no DID bound; pass did: to create()")
        }

        // Step 1: fetch the challenge.
        let authURL = baseURL.appendingPathComponent(".well-known/openagent/auth")
        var challengeRequest = URLRequest(url: authURL)
        challengeRequest.httpMethod = "POST"
        challengeRequest.setValue("application/json", forHTTPHeaderField: "accept")
        let (challengeData, challengeResponse) = try await URLSession.shared.data(for: challengeRequest)
        guard let http = challengeResponse as? HTTPURLResponse, http.statusCode == 200 else {
            throw OpenAgentError.config("challenge request failed")
        }

        guard let challenge = try JSONSerialization.jsonObject(with: challengeData) as? [String: Any],
              challenge["type"] as? String == "openagent-challenge-v1",
              let nonce = challenge["nonce"] as? String
        else {
            throw OpenAgentError.config("malformed challenge in response")
        }

        // Step 2: sign the canonical bytes and prove.
        let payload = canonicalChallengeBytes(challenge)
        let signature = try keys.sign(payload)
        let proof: [String: String] = [
            "signature": base64URLEncode(signature),
            "public_key": base64URLEncode(keys.verifyingKey),
            "key_type": "ed25519",
            "nonce": nonce,
        ]

        let proveURL = baseURL.appendingPathComponent(".well-known/openagent/auth/prove")
        var proveRequest = URLRequest(url: proveURL)
        proveRequest.httpMethod = "POST"
        proveRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        proveRequest.setValue("application/json", forHTTPHeaderField: "accept")
        proveRequest.httpBody = try JSONSerialization.data(withJSONObject: proof)
        let (verifiedData, verifiedResponse) = try await URLSession.shared.data(for: proveRequest)
        guard let http = verifiedResponse as? HTTPURLResponse, http.statusCode == 200 else {
            throw OpenAgentError.config("prove request failed")
        }

        guard let verified = try JSONSerialization.jsonObject(with: verifiedData) as? [String: Any],
              let sessionToken = verified["session_token"] as? String,
              let expiresRaw = verified["session_expires"] as? String
        else {
            throw OpenAgentError.config("malformed verified response")
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let expiresDate = formatter.date(from: expiresRaw) else {
            throw OpenAgentError.config("invalid session_expires in response: \(expiresRaw)")
        }

        return Session(
            baseURL: baseURL,
            sessionToken: sessionToken,
            did: did,
            expiresAt: Int64(expiresDate.timeIntervalSince1970),
            trustTier: verified["trust_tier"] as? String ?? "anonymous",
            capabilities: verified["capabilities"] as? [String] ?? [])
    }
}

/// JCS-canonical (RFC 8785) UTF-8 bytes of the challenge object.
///
/// Scoped to the challenge shape: a flat object whose values are strings
/// (or absent). JCS for that shape is lexicographic key order, no
/// whitespace, JSON string escaping.
func canonicalChallengeBytes(_ challenge: [String: Any]) -> Data {
    let body = challenge.keys.sorted().map { key -> String in
        let value = challenge[key] as? String ?? ""
        return "\(jsonString(key)):\(jsonString(value))"
    }.joined(separator: ",")
    return Data("{\(body)}".utf8)
}

private func jsonString(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        default: out.unicodeScalars.append(scalar)
        }
    }
    return out + "\""
}

private func base64URLEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
