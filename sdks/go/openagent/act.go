package openagent

import (
	"crypto/ed25519"
	"fmt"
	"time"

	"github.com/fxamacker/cbor/v2"
)

// FormatVersion is the implemented ACT envelope version (`v` field).
const FormatVersion = 1

// AlgorithmEd25519 is the implemented signature algorithm (`alg` field).
const AlgorithmEd25519 = "Ed25519"

// MaxActBytes is the hard cap on the envelope size (spec section 2.2).
const MaxActBytes = 16 * 1024

// ActClaims is the verified claim set (spec section 3). Ext carries
// issuer-defined policy this verifier does not evaluate; its contents are
// signature-covered and passed through intact.
type ActClaims struct {
	JTI        string         `cbor:"jti"`
	Sub        string         `cbor:"sub"`
	Iss        string         `cbor:"iss"`
	Aud        []string       `cbor:"aud"`
	Iat        int64          `cbor:"iat"`
	Nbf        int64          `cbor:"nbf"`
	Exp        int64          `cbor:"exp"`
	TenantID   string         `cbor:"tenant_id"`
	ScopeRaw   []string       `cbor:"scope"`
	Cnf        map[string]any `cbor:"cnf,omitempty"`
	Delegation map[string]any `cbor:"delegation,omitempty"`
	Ext        map[string]any `cbor:"ext,omitempty"`

	// Scopes is the parsed scope set, populated by verification.
	Scopes []Scope `cbor:"-"`
}

// ActEnvelope is the decoded (but unverified) envelope.
type ActEnvelope struct {
	Version int
	Alg     string
	Claims  []byte
	Sig     []byte
	Kid     string
}

// DecodeEnvelope decodes the envelope per spec section 4.1 steps 1-3:
// size cap, decode, version and algorithm checks, signature shape.
func DecodeEnvelope(token []byte) (*ActEnvelope, error) {
	if len(token) > MaxActBytes {
		return nil, actErr(ErrTooLarge,
			fmt.Sprintf("token is %d bytes, exceeding the %d-byte maximum", len(token), MaxActBytes))
	}
	var raw map[string]any
	if err := cbor.Unmarshal(token, &raw); err != nil {
		return nil, actErr(ErrEnvelopeDecode, err.Error())
	}

	versionF, ok := raw["v"]
	if !ok {
		return nil, actErr(ErrEnvelopeDecode, "envelope has no 'v'")
	}
	version, ok := versionF.(uint64)
	if !ok {
		return nil, actErr(ErrEnvelopeDecode, "envelope 'v' is not an integer")
	}
	if version != FormatVersion {
		return nil, actErr(ErrUnsupportedVersion,
			fmt.Sprintf("unsupported ACT format version %d; this verifier implements version %d",
				version, FormatVersion))
	}

	alg, ok := raw["alg"].(string)
	if !ok {
		return nil, actErr(ErrEnvelopeDecode, "envelope has no text 'alg'")
	}
	if alg != AlgorithmEd25519 {
		return nil, actErr(ErrUnsupportedAlgorithm, alg)
	}

	claims, ok := raw["claims"].([]byte)
	if !ok {
		return nil, actErr(ErrEnvelopeDecode, "envelope 'claims' is not a byte string")
	}
	sig, ok := raw["sig"].([]byte)
	if !ok {
		return nil, actErr(ErrEnvelopeDecode, "envelope 'sig' is not a byte string")
	}
	if len(sig) != 64 {
		return nil, actErr(ErrMalformedSignature,
			fmt.Sprintf("signature must be exactly 64 bytes, got %d", len(sig)))
	}

	kid, _ := raw["kid"].(string)
	return &ActEnvelope{Version: int(version), Alg: alg, Claims: claims, Sig: sig, Kid: kid}, nil
}

// Verifier verifies ACT envelopes: trusted keys plus policy bindings.
//
// An empty trusted key set fails at construction (spec section 4.2): such a
// verifier would reject every token, and a startup error must not disguise
// a misconfiguration as an attack.
type Verifier struct {
	keys     []ed25519.PublicKey
	issuer   string
	audience string
	scopes   []Scope
	leeway   int64
	now      *int64
}

// NewVerifier constructs a verifier. issuer and audience are required,
// deliberately: a verifier that does not bind the token's intended audience
// accepts tokens meant for someone else.
func NewVerifier(trustedKeys [][]byte, issuer, audience string) (*Verifier, error) {
	if len(trustedKeys) == 0 {
		return nil, configErr("at least one trusted key is required")
	}
	keys := make([]ed25519.PublicKey, 0, len(trustedKeys))
	for i, k := range trustedKeys {
		if len(k) != ed25519.PublicKeySize {
			return nil, configErr("trusted key %d must be 32 bytes, got %d", i, len(k))
		}
		keys = append(keys, ed25519.PublicKey(k))
	}
	if issuer == "" {
		return nil, configErr("expected issuer is required")
	}
	if audience == "" {
		return nil, configErr("expected audience is required")
	}
	return &Verifier{keys: keys, issuer: issuer, audience: audience}, nil
}

// WithClock pins the verification clock (tests, decision replay).
func (v *Verifier) WithClock(nowUnixSeconds int64) *Verifier {
	clone := *v
	clone.now = &nowUnixSeconds
	return &clone
}

// WithLeeway allows `seconds` of clock skew on temporal checks.
func (v *Verifier) WithLeeway(seconds int64) *Verifier {
	clone := *v
	if seconds < 0 {
		seconds = -seconds
	}
	clone.leeway = seconds
	return &clone
}

// RequiringScopes returns a verifier that additionally requires these scopes.
func (v *Verifier) RequiringScopes(scopes ...Scope) *Verifier {
	clone := *v
	clone.scopes = append(append([]Scope{}, v.scopes...), scopes...)
	return &clone
}

func (v *Verifier) time() int64 {
	if v.now != nil {
		return *v.now
	}
	return time.Now().Unix()
}

// Verify verifies an ACT envelope per spec section 4.1, in order.
func (v *Verifier) Verify(token []byte) (*ActClaims, error) {
	// Steps 1-3: size, decode, version/algorithm, signature shape.
	envelope, err := DecodeEnvelope(token)
	if err != nil {
		return nil, err
	}

	// Step 4: the signature, BEFORE any claim check. `kid` is a hint for
	// audit and rotation, never authoritative for key selection - every
	// trusted key is tried.
	signed := false
	for _, key := range v.keys {
		if ed25519.Verify(key, envelope.Claims, envelope.Sig) {
			signed = true
			break
		}
	}
	if !signed {
		return nil, actErr(ErrSignatureInvalid,
			fmt.Sprintf("signature verification failed against all %d trusted keys", len(v.keys)))
	}

	// Step 5: decode and structurally validate the claim set.
	var claims ActClaims
	if err := claims.UnmarshalCBOR(envelope.Claims); err != nil {
		return nil, err
	}
	if err := claims.validate(); err != nil {
		return nil, err
	}

	// Step 6: temporal checks with leeway.
	now := v.time()
	if claims.Exp <= now-v.leeway {
		return nil, actErr(ErrExpired, fmt.Sprintf("token expired at %d (now %d)", claims.Exp, now))
	}
	if claims.Nbf > now+v.leeway {
		return nil, actErr(ErrNotYetValid, fmt.Sprintf("token not valid until %d (now %d)", claims.Nbf, now))
	}

	// Steps 7-8: issuer and audience.
	if claims.Iss != v.issuer {
		return nil, actErr(ErrIssuerMismatch,
			fmt.Sprintf("expected %q, got %q", v.issuer, claims.Iss))
	}
	audienceOK := false
	for _, a := range claims.Aud {
		if a == v.audience {
			audienceOK = true
			break
		}
	}
	if !audienceOK {
		return nil, actErr(ErrAudienceMismatch,
			fmt.Sprintf("%q is not among the token audiences", v.audience))
	}

	// Step 9: required scopes covered per section 5.2 (directional).
	for _, required := range v.scopes {
		covered := false
		for _, granted := range claims.Scopes {
			if granted.Covers(required) {
				covered = true
				break
			}
		}
		if !covered {
			return nil, actErr(ErrMissingScope, required.String())
		}
	}

	return &claims, nil
}

// UnmarshalCBOR decodes the claim set, accepting `aud` as either a single
// string or an array of strings (spec section 3: the single-audience case is
// the conventional shorthand).
func (c *ActClaims) UnmarshalCBOR(data []byte) error {
	var raw struct {
		JTI        string         `cbor:"jti"`
		Sub        string         `cbor:"sub"`
		Iss        string         `cbor:"iss"`
		Aud        any            `cbor:"aud"`
		Iat        int64          `cbor:"iat"`
		Nbf        int64          `cbor:"nbf"`
		Exp        int64          `cbor:"exp"`
		TenantID   string         `cbor:"tenant_id"`
		ScopeRaw   []string       `cbor:"scope"`
		Cnf        map[string]any `cbor:"cnf,omitempty"`
		Delegation map[string]any `cbor:"delegation,omitempty"`
		Ext        map[string]any `cbor:"ext,omitempty"`
	}
	if err := cbor.Unmarshal(data, &raw); err != nil {
		return actErr(ErrClaimsDecode, err.Error())
	}

	c.JTI, c.Sub, c.Iss = raw.JTI, raw.Sub, raw.Iss
	c.Iat, c.Nbf, c.Exp = raw.Iat, raw.Nbf, raw.Exp
	c.TenantID, c.ScopeRaw = raw.TenantID, raw.ScopeRaw
	c.Cnf, c.Delegation, c.Ext = raw.Cnf, raw.Delegation, raw.Ext

	switch aud := raw.Aud.(type) {
	case string:
		c.Aud = []string{aud}
	case []any:
		for _, a := range aud {
			s, ok := a.(string)
			if !ok {
				return actErr(ErrClaimsDecode, "claim 'aud' entries must be strings")
			}
			c.Aud = append(c.Aud, s)
		}
	case nil:
		// validated below as missing
	default:
		return actErr(ErrClaimsDecode, "claim 'aud' must be a string or an array of strings")
	}
	return nil
}

func (c *ActClaims) validate() error {
	for _, field := range []struct {
		name, value string
	}{
		{"jti", c.JTI}, {"sub", c.Sub}, {"iss", c.Iss}, {"tenant_id", c.TenantID},
	} {
		if field.value == "" {
			return actErr(ErrClaimsDecode, "missing or blank required claim "+field.name)
		}
	}
	if len(c.Aud) == 0 {
		return actErr(ErrClaimsDecode, "claim 'aud' must be a non-empty array of strings")
	}
	if len(c.ScopeRaw) == 0 {
		return actErr(ErrClaimsDecode, "claim 'scope' must be a non-empty flat array of strings")
	}
	if c.Nbf >= c.Exp {
		return actErr(ErrClaimsDecode,
			fmt.Sprintf("nbf (%d) is not before exp (%d)", c.Nbf, c.Exp))
	}
	c.Scopes = make([]Scope, 0, len(c.ScopeRaw))
	for _, s := range c.ScopeRaw {
		parsed, err := ParseScope(s)
		if err != nil {
			return err
		}
		c.Scopes = append(c.Scopes, parsed)
	}
	return nil
}

// DecodeUnverified decodes claims WITHOUT verifying the signature, for
// diagnostics and tooling. Never use for authorization: unverified claims
// are attacker controlled. The boolean return is always false as a reminder.
func DecodeUnverified(token []byte) (*ActClaims, bool) {
	envelope, err := DecodeEnvelope(token)
	if err != nil {
		return nil, false
	}
	var claims ActClaims
	if err := claims.UnmarshalCBOR(envelope.Claims); err != nil {
		return nil, false
	}
	if err := claims.validate(); err != nil {
		return nil, false
	}
	return &claims, false
}
