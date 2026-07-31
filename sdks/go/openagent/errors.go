// Package openagent provides identity, authentication, and Agent Capability
// Token (ACT) verification for autonomous agents, per act/SPECIFICATION.md.
package openagent

import "fmt"

// ActError is the base class for ACT verification failures (spec section 4).
type ActError struct{ msg string }

func (e *ActError) Error() string { return e.msg }

// Verification failure kinds, mirroring the canonical error surface so a
// forged token reports distinctly from an expired one.
var (
	ErrTooLarge             = &ActError{msg: "token exceeds the size limit"}
	ErrEnvelopeDecode       = &ActError{msg: "envelope decode failed"}
	ErrUnsupportedVersion   = &ActError{msg: "unsupported ACT format version"}
	ErrUnsupportedAlgorithm = &ActError{msg: "unsupported ACT signature algorithm"}
	ErrMalformedSignature   = &ActError{msg: "signature must be exactly 64 bytes"}
	ErrSignatureInvalid     = &ActError{msg: "signature verification failed against all trusted keys"}
	ErrClaimsDecode         = &ActError{msg: "invalid claim set"}
	ErrExpired              = &ActError{msg: "token expired"}
	ErrNotYetValid          = &ActError{msg: "token not valid yet"}
	ErrIssuerMismatch       = &ActError{msg: "issuer mismatch"}
	ErrAudienceMismatch     = &ActError{msg: "audience mismatch"}
	ErrMissingScope         = &ActError{msg: "missing required scope"}
	ErrMalformedScope       = &ActError{msg: "malformed scope"}
)

// actErr wraps a sentinel with detail, preserving the kind for errors.Is.
func actErr(kind *ActError, detail string) error {
	return fmt.Errorf("%w: %s", kind, detail)
}

// ConfigError reports an unusable verifier or client policy.
type ConfigError struct{ msg string }

func (e *ConfigError) Error() string { return e.msg }

func configErr(format string, args ...any) error {
	return &ConfigError{msg: fmt.Sprintf(format, args...)}
}
