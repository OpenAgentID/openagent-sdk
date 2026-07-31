import Foundation
import Testing
@testable import OpenAgentSDK

// The canonical ACT conformance vectors (conformance/vectors/arsenal/
// act-verify.json) — the same 13 vectors that gate Rust, TypeScript, Python,
// and Go. Swift verifies through its own spec-exact implementation, and
// the vectors prove it agrees with the canonical crate.

private struct VectorFile: Decodable {
    let vectors: [Vector]
}

private struct Vector: Decodable {
    let name: String
    let input: Input
    let expectedOutput: ExpectedOutput

    enum CodingKeys: String, CodingKey {
        case name, input
        case expectedOutput = "expected_output"
    }
}

private struct Input: Decodable {
    let envelopeHex: String
    let trustedKeyHex: String
    let issuer: String
    let audience: String
    let scopes: [String]?
    let leewaySeconds: Int64?
    let now: Int64

    enum CodingKeys: String, CodingKey {
        case envelopeHex = "envelope_hex"
        case trustedKeyHex = "trusted_key_hex"
        case issuer, audience, scopes
        case leewaySeconds = "leeway_seconds"
        case now = "now_unix_seconds"
    }
}

private struct ExpectedOutput: Decodable {
    let verdict: String
    let sub: String?
    let jti: String?
    let tenantId: String?
    let reasonClass: String?

    enum CodingKeys: String, CodingKey {
        case verdict, sub, jti
        case tenantId = "tenant_id"
        case reasonClass = "reason_class"
    }
}

private func hexDecode(_ hex: String) -> [UInt8] {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        bytes.append(UInt8(hex[index..<next], radix: 16)!)
        index = next
    }
    return bytes
}

private func loadVectors() throws -> [Vector] {
    // sdks/swift/Tests/OpenAgentSDKTests -> repo/conformance/vectors/arsenal
    let testFile = URL(fileURLWithPath: #filePath)
    let repoRoot = testFile
        .deletingLastPathComponent() // OpenAgentSDKTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // swift
        .deletingLastPathComponent() // sdks
        .deletingLastPathComponent() // openagent-sdk
    let vectorsURL = repoRoot
        .appendingPathComponent("conformance/vectors/arsenal/act-verify.json")
    let data = try Data(contentsOf: vectorsURL)
    return try JSONDecoder().decode(VectorFile.self, from: data).vectors
}

@Test("canonical ACT vectors", .enabled(if: vectorsAvailable))
func actVectors() throws {
    for vector in try loadVectors() {
        try runVector(vector)
    }
}

var vectorsAvailable: Bool {
    let testFile = URL(fileURLWithPath: #filePath)
    let vectorsURL = testFile
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("conformance/vectors/arsenal/act-verify.json")
    return FileManager.default.fileExists(atPath: vectorsURL.path)
}

private func runVector(_ vector: Vector) throws {
    let envelope = hexDecode(vector.input.envelopeHex)
    let trustedKey = hexDecode(vector.input.trustedKeyHex)
    let scopes = try (vector.input.scopes ?? []).map { try Scope.parse($0) }

    let base = try ACT.Verifier(
        trustedKeys: [trustedKey],
        expectedIssuer: vector.input.issuer,
        expectedAudience: vector.input.audience,
        leewaySeconds: vector.input.leewaySeconds ?? 0
    ).withClock(vector.input.now)
    let verifier = scopes.isEmpty ? base : base.requiringScopes(scopes)

    var claims: ACT.Claims?
    var failure: OpenAgentError?
    do {
        claims = try verifier.verify(envelope)
    } catch let error as OpenAgentError {
        failure = error
    }

    switch vector.expectedOutput.verdict {
    case "accept":
        guard let claims else {
            Issue.record("expected accept, verification failed: \(failure?.description ?? "?") [\(vector.name)]")
            return
        }
        if let expected = vector.expectedOutput.sub {
            #expect(claims.sub == expected, "\(vector.name)")
        }
        if let expected = vector.expectedOutput.jti {
            #expect(claims.jti == expected, "\(vector.name)")
        }
        if let expected = vector.expectedOutput.tenantId {
            #expect(claims.tenantId == expected, "\(vector.name)")
        }
    case "reject":
        guard let failure else {
            Issue.record("expected reject, token verified (sub \(claims?.sub ?? "?")) [\(vector.name)]")
            return
        }
        let reasonClass = vector.expectedOutput.reasonClass ?? ""
        if !reasonClass.isEmpty {
            #expect(
                failure.description.contains(reasonClass),
                "\(vector.name): error \"\(failure.description)\" does not contain \"\(reasonClass)\"")
        }
    default:
        Issue.record("unknown verdict \(vector.expectedOutput.verdict) [\(vector.name)]")
    }
}
