package openagent

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestScopeParse(t *testing.T) {
	s, err := ParseScope("tools:calendar:invoke")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if s.Service != "tools" || s.Resource != "calendar" || s.Action != "invoke" {
		t.Fatalf("segments: %+v", s)
	}
	if s.String() != "tools:calendar:invoke" {
		t.Fatalf("string: %s", s)
	}
}

func TestScopeParseRejects(t *testing.T) {
	for _, bad := range []string{"", "tools:invoke", "tools::invoke", "a:b:c:d"} {
		if _, err := ParseScope(bad); err == nil {
			t.Fatalf("expected rejection for %q", bad)
		}
	}
}

func TestScopeCovers(t *testing.T) {
	grant := mustScope(t, "tools:*:invoke")
	if !grant.Covers(mustScope(t, "tools:calendar:invoke")) {
		t.Fatal("wildcard grant should cover")
	}
	if grant.Covers(mustScope(t, "tools:calendar:delete")) {
		t.Fatal("wildcard grant should not cover different action")
	}
}

func TestScopeNonWidening(t *testing.T) {
	grant := mustScope(t, "tools:calendar:invoke")
	if grant.Covers(mustScope(t, "tools:calendar:*")) {
		t.Fatal("a request wildcard must not widen the grant")
	}
}

func mustScope(t *testing.T, s string) Scope {
	t.Helper()
	parsed, err := ParseScope(s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return parsed
}

func TestVerifierConstruction(t *testing.T) {
	if _, err := NewVerifier(nil, "iss", "aud"); err == nil {
		t.Fatal("empty trusted keys must fail at construction")
	}
	if _, err := NewVerifier([][]byte{make([]byte, 16)}, "iss", "aud"); err == nil {
		t.Fatal("wrong-length key must fail")
	}
	if _, err := NewVerifier([][]byte{make([]byte, 32)}, "", "aud"); err == nil {
		t.Fatal("blank issuer must fail")
	}
	if _, err := NewVerifier([][]byte{make([]byte, 32)}, "iss", ""); err == nil {
		t.Fatal("blank audience must fail")
	}
}

func TestBuilderRequirements(t *testing.T) {
	key := make([]byte, 32)
	if _, err := Verify([]byte{1}).ForAudience("aud").TrustedKeys(key).Run(); err == nil {
		t.Fatal("issuer required")
	}
	if _, err := Verify([]byte{1}).Issuer("iss").TrustedKeys(key).Run(); err == nil {
		t.Fatal("audience required")
	}
	if _, err := Verify([]byte{1}).Issuer("iss").ForAudience("aud").Run(); err == nil {
		t.Fatal("keys required")
	}
}

func TestEnvelopeDecodeRejectsOversize(t *testing.T) {
	_, err := DecodeEnvelope(make([]byte, MaxActBytes+1))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}

func TestKeyCustody(t *testing.T) {
	keys, err := GenerateKeys()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(keys.SigningKey) == 0 || len(keys.VerifyingKey) != 32 {
		t.Fatal("key set incomplete")
	}

	restored, err := KeysFromSeed(keys.Seed)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !bytes.Equal(restored.VerifyingKey, keys.VerifyingKey) {
		t.Fatal("restore not deterministic")
	}
	if restored.EncryptionSecretKey == keys.Seed {
		t.Fatal("encryption key must differ from seed (context separation)")
	}

	hexSeed := SeedHex(keys.Seed)
	if len(hexSeed) != 64 {
		t.Fatal("hex length")
	}
	fromHex, err := KeysFromSeedHex(hexSeed)
	if err != nil {
		t.Fatalf("from hex: %v", err)
	}
	if !bytes.Equal(fromHex.VerifyingKey, keys.VerifyingKey) {
		t.Fatal("hex round trip mismatch")
	}

	path := t.TempDir() + "/agent.seed"
	if err := SaveSeed(keys, path); err != nil {
		t.Fatalf("save: %v", err)
	}
	fromFile, err := KeysFromSeedFile(path)
	if err != nil {
		t.Fatalf("from file: %v", err)
	}
	if !bytes.Equal(fromFile.VerifyingKey, keys.VerifyingKey) {
		t.Fatal("file round trip mismatch")
	}
}

func TestSignVerifyRoundTrip(t *testing.T) {
	keys, err := GenerateKeys()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	message := []byte("openagent go test")
	sig := ed25519.Sign(keys.SigningKey, message)
	if !ed25519.Verify(keys.VerifyingKey, message, sig) {
		t.Fatal("signature did not verify")
	}
}

func TestMiddlewareRejectsMissingToken(t *testing.T) {
	verifier, err := NewVerifier([][]byte{make([]byte, 32)}, "iss", "aud")
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	ran := false
	handler := RequireAct(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ran = true
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/tools", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ran {
		t.Fatal("route must not run on missing token")
	}
	if !strings.Contains(rec.Body.String(), "missing or malformed") {
		t.Fatalf("expected reason in body, got %s", rec.Body.String())
	}
}

func TestMiddlewareRejectsBadToken(t *testing.T) {
	verifier, err := NewVerifier([][]byte{make([]byte, 32)}, "iss", "aud")
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	handler := RequireAct(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/tools", nil)
	req.Header.Set("Authorization", "Bearer bm90LWFuLWFjdA")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ACT verification failed") {
		t.Fatalf("expected canonical reason, got %s", rec.Body.String())
	}
}
