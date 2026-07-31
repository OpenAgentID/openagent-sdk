package openagent

// VerifyBuilder is the fluent ACT verifier, mirroring the other SDKs:
//
//	claims, err := openagent.Verify(token).
//	    Issuer("arsenal:broker:prod-1").
//	    ForAudience("my-service").
//	    RequireScope(scope).
//	    TrustedKeys(keys).
//	    Run()
type VerifyBuilder struct {
	token    []byte
	issuer   string
	audience string
	keys     [][]byte
	scopes   []Scope
	leeway   int64
	now      *int64
}

// Verify begins verifying an ACT envelope (CBOR bytes).
func Verify(token []byte) *VerifyBuilder {
	return &VerifyBuilder{token: token}
}

// Issuer binds the expected issuer. Required: a verifier that does not name
// the issuer accepts anyone's tokens.
func (b *VerifyBuilder) Issuer(iss string) *VerifyBuilder {
	b.issuer = iss
	return b
}

// ForAudience binds the audience this verifier answers for. Required: a
// token meant for another service must not pass here.
func (b *VerifyBuilder) ForAudience(audience string) *VerifyBuilder {
	b.audience = audience
	return b
}

// TrustedKeys sets the trusted Ed25519 public keys (raw 32 bytes each).
func (b *VerifyBuilder) TrustedKeys(keys ...[]byte) *VerifyBuilder {
	b.keys = append(b.keys, keys...)
	return b
}

// RequireScope requires a scope the token must grant. Repeatable.
func (b *VerifyBuilder) RequireScope(scope Scope) *VerifyBuilder {
	b.scopes = append(b.scopes, scope)
	return b
}

// WithLeeway allows `seconds` of clock skew on temporal checks.
func (b *VerifyBuilder) WithLeeway(seconds int64) *VerifyBuilder {
	b.leeway = seconds
	return b
}

// AtTime pins the verification clock (tests, decision replay).
func (b *VerifyBuilder) AtTime(unixSeconds int64) *VerifyBuilder {
	b.now = &unixSeconds
	return b
}

// Run verifies and returns the claims.
func (b *VerifyBuilder) Run() (*ActClaims, error) {
	if b.issuer == "" {
		return nil, configErr("act verify: Issuer() is required")
	}
	if b.audience == "" {
		return nil, configErr("act verify: ForAudience() is required")
	}
	if len(b.keys) == 0 {
		return nil, configErr("act verify: TrustedKeys() is required (at least one key)")
	}
	verifier, err := NewVerifier(b.keys, b.issuer, b.audience)
	if err != nil {
		return nil, err
	}
	if b.leeway != 0 {
		verifier = verifier.WithLeeway(b.leeway)
	}
	if b.now != nil {
		verifier = verifier.WithClock(*b.now)
	}
	if len(b.scopes) > 0 {
		verifier = verifier.RequiringScopes(b.scopes...)
	}
	return verifier.Verify(b.token)
}
