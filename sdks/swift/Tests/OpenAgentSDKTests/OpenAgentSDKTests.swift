import Foundation
import Testing
@testable import OpenAgentSDK

@Test("scope grammar: three segments")
func scopeParse() throws {
    let scope = try Scope.parse("tools:calendar:invoke")
    #expect(scope.service == "tools")
    #expect(scope.resource == "calendar")
    #expect(scope.action == "invoke")
    #expect(scope.description == "tools:calendar:invoke")
}

@Test("scope grammar: rejections")
func scopeRejections() {
    for bad in ["", "tools:invoke", "tools::invoke", "a:b:c:d"] {
        #expect(throws: OpenAgentError.self) {
            _ = try Scope.parse(bad)
        }
    }
}

@Test("scope matching: wildcard expands in grant, never in request")
func scopeMatching() throws {
    let grant = try Scope.parse("tools:*:invoke")
    #expect(grant.covers(try Scope.parse("tools:calendar:invoke")))
    #expect(!grant.covers(try Scope.parse("tools:calendar:delete")))

    // The non-widening rule: holding tools:calendar:invoke must NOT
    // authorize a request for tools:calendar:*.
    let narrow = try Scope.parse("tools:calendar:invoke")
    #expect(!narrow.covers(try Scope.parse("tools:calendar:*")))
}

@Test("verifier construction: empty keys fail at construction")
func verifierEmptyKeys() {
    #expect(throws: OpenAgentError.self) {
        _ = try ACT.Verifier(trustedKeys: [], expectedIssuer: "iss", expectedAudience: "aud")
    }
}

@Test("verifier construction: blank issuer/audience fail")
func verifierBlankBindings() {
    let key = Array(repeating: UInt8(7), count: 32)
    #expect(throws: OpenAgentError.self) {
        _ = try ACT.Verifier(trustedKeys: [key], expectedIssuer: "", expectedAudience: "aud")
    }
    #expect(throws: OpenAgentError.self) {
        _ = try ACT.Verifier(trustedKeys: [key], expectedIssuer: "iss", expectedAudience: "")
    }
}

@Test("envelope: oversized input refused")
func envelopeOversize() {
    let big = Array(repeating: UInt8(0), count: ACT.maxActBytes + 1)
    #expect(throws: OpenAgentError.self) {
        _ = try ACT.Envelope.decode(big)
    }
}

@Test("key custody: deterministic restore")
func keyCustodyDeterministic() throws {
    let seed = Data(0..<32)
    let a = try Keys.fromSeed(seed)
    let b = try Keys.fromSeed(seed)
    #expect(a.signingKey == b.signingKey)
    #expect(a.verifyingKey == b.verifyingKey)
    #expect(a.encryptionSecretKey == b.encryptionSecretKey)
    #expect(a.encryptionSecretKey != a.signingKey)
}

@Test("key custody: hex round trip")
func keyCustodyHex() throws {
    let keys = try Keys.generate()
    let hex = Keys.seedToHex(keys.seed)
    #expect(hex.count == 64)
    let restored = try Keys.fromSeedHex(hex)
    #expect(restored.verifyingKey == keys.verifyingKey)
}

@Test("key custody: sign and verify round trip")
func keyCustodySign() throws {
    let keys = try Keys.generate()
    let message = Data("openagent swift test".utf8)
    let signature = try keys.sign(message)
    let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: keys.verifyingKey)
    #expect(publicKey.isValidSignature(signature, for: message))
}

@Test("canonical challenge bytes: JCS shape")
func canonicalChallenge() {
    let challenge: [String: Any] = [
        "type": "openagent-challenge-v1",
        "nonce": String(repeating: "a", count: 64),
        "timestamp": "2026-03-21T12:00:00Z",
        "origin": "https://api.example.com",
    ]
    let payload = canonicalChallengeBytes(challenge)
    let expected = "{\"nonce\":\"\(String(repeating: "a", count: 64))\",\"origin\":\"https://api.example.com\",\"timestamp\":\"2026-03-21T12:00:00Z\",\"type\":\"openagent-challenge-v1\"}"
    #expect(String(decoding: payload, as: UTF8.self) == expected)
}

@Test("canonical challenge bytes: realm in sorted position")
func canonicalChallengeRealm() {
    let challenge: [String: Any] = [
        "type": "openagent-challenge-v1",
        "nonce": "n",
        "timestamp": "t",
        "origin": "o",
        "realm": "admin",
    ]
    let text = String(decoding: canonicalChallengeBytes(challenge), as: UTF8.self)
    let realmAt = text.range(of: "\"realm\"")!.lowerBound
    let timestampAt = text.range(of: "\"timestamp\"")!.lowerBound
    let typeAt = text.range(of: "\"type\"")!.lowerBound
    #expect(realmAt < timestampAt && timestampAt < typeAt)
}

import Crypto
