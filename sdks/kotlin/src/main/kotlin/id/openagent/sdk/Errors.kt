package id.openagent.sdk

/**
 * Errors for the OpenAgent SDK, mirroring the canonical ACT error surface
 * (act/SPECIFICATION.md section 4) so a forged token reports distinctly
 * from an expired one.
 */
public sealed class OpenAgentError(message: String) : Exception(message) {

    public class Config(detail: String) : OpenAgentError("config error: $detail")

    public class TooLarge(size: Int, maximum: Int) :
        OpenAgentError("token is $size bytes, exceeding the $maximum-byte maximum")

    public class EnvelopeDecode(detail: String) : OpenAgentError("envelope decode failed: $detail")

    public class UnsupportedVersion(version: Int) :
        OpenAgentError("unsupported ACT format version $version; this verifier implements version 1")

    public class UnsupportedAlgorithm(alg: String) :
        OpenAgentError("unsupported ACT signature algorithm: $alg")

    public class MalformedSignature(detail: String) : OpenAgentError("malformed signature: $detail")

    public class SignatureInvalid(trustedKeyCount: Int) :
        OpenAgentError("signature verification failed against all $trustedKeyCount trusted keys")

    public class ClaimsDecode(detail: String) : OpenAgentError("invalid claim set: $detail")

    public class Expired(exp: Long, now: Long) : OpenAgentError("token expired at $exp (now $now)")

    public class NotYetValid(nbf: Long, now: Long) :
        OpenAgentError("token not valid until $nbf (now $now)")

    public class IssuerMismatch(expected: String, actual: String) :
        OpenAgentError("issuer mismatch: expected \"$expected\", got \"$actual\"")

    public class AudienceMismatch(expected: String) :
        OpenAgentError("audience mismatch: \"$expected\" is not among the token audiences")

    public class MissingScope(scope: String) : OpenAgentError("missing required scope: $scope")

    public class MalformedScope(scope: String, reason: String) :
        OpenAgentError("malformed scope \"$scope\": $reason")
}
