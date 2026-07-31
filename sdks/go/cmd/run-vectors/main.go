// Run the canonical ACT conformance vectors against this SDK.
//
// The drift control for the Go SDK: the same 13 vectors that gate the Rust
// and TypeScript implementations must pass here, through this package's own
// verifier. Exits non-zero on any failure.
package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/OpenAgentID/openagent-sdk-go/openagent"
)

type vector struct {
	Name     string         `json:"name"`
	Input    vectorInput    `json:"input"`
	Expected expectedOutput `json:"expected_output"`
}

type vectorInput struct {
	EnvelopeHex   string   `json:"envelope_hex"`
	TrustedKeyHex string   `json:"trusted_key_hex"`
	Issuer        string   `json:"issuer"`
	Audience      string   `json:"audience"`
	Scopes        []string `json:"scopes"`
	LeewaySeconds int64    `json:"leeway_seconds"`
	Now           int64    `json:"now_unix_seconds"`
}

type expectedOutput struct {
	Verdict     string `json:"verdict"`
	Sub         string `json:"sub"`
	JTI         string `json:"jti"`
	TenantID    string `json:"tenant_id"`
	ReasonClass string `json:"reason_class"`
}

type vectorFile struct {
	Vectors []vector `json:"vectors"`
}

func main() {
	path := filepath.Join("..", "..", "conformance", "vectors", "arsenal", "act-verify.json")
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	must(err, "read vectors")
	var vf vectorFile
	must(json.Unmarshal(raw, &vf), "parse vectors")

	failures := 0
	for _, v := range vf.Vectors {
		if err := runVector(v); err != nil {
			failures++
			fmt.Printf("  FAIL  %s: %v\n", v.Name, err)
		} else {
			fmt.Printf("  PASS  %s\n", v.Name)
		}
	}

	total := len(vf.Vectors)
	fmt.Printf("\nact-verify: %d/%d passed\n", total-failures, total)
	if failures > 0 {
		os.Exit(1)
	}
}

func runVector(v vector) error {
	envelope, err := hex.DecodeString(v.Input.EnvelopeHex)
	must(err, "decode envelope")
	trustedKey, err := hex.DecodeString(v.Input.TrustedKeyHex)
	must(err, "decode key")

	builder := openagent.Verify(envelope).
		Issuer(v.Input.Issuer).
		ForAudience(v.Input.Audience).
		TrustedKeys(trustedKey).
		AtTime(v.Input.Now)
	if v.Input.LeewaySeconds != 0 {
		builder = builder.WithLeeway(v.Input.LeewaySeconds)
	}
	for _, s := range v.Input.Scopes {
		parsed, err := openagent.ParseScope(s)
		must(err, "parse scope "+s)
		builder = builder.RequireScope(parsed)
	}

	claims, verifyErr := builder.Run()

	switch v.Expected.Verdict {
	case "accept":
		if verifyErr != nil {
			return fmt.Errorf("expected accept, verification failed: %v", verifyErr)
		}
		if v.Expected.Sub != "" && claims.Sub != v.Expected.Sub {
			return fmt.Errorf("sub mismatch: got %s expected %s", claims.Sub, v.Expected.Sub)
		}
		if v.Expected.JTI != "" && claims.JTI != v.Expected.JTI {
			return fmt.Errorf("jti mismatch: got %s expected %s", claims.JTI, v.Expected.JTI)
		}
		if v.Expected.TenantID != "" && claims.TenantID != v.Expected.TenantID {
			return fmt.Errorf("tenant_id mismatch: got %s expected %s", claims.TenantID, v.Expected.TenantID)
		}
		return nil
	case "reject":
		if verifyErr == nil {
			return fmt.Errorf("expected reject, token verified (sub %s)", claims.Sub)
		}
		if v.Expected.ReasonClass != "" && !strings.Contains(verifyErr.Error(), v.Expected.ReasonClass) {
			return fmt.Errorf("reason class mismatch: error %q does not contain %q",
				verifyErr.Error(), v.Expected.ReasonClass)
		}
		return nil
	default:
		return fmt.Errorf("unknown verdict %q", v.Expected.Verdict)
	}
}

func must(err error, what string) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", what, err)
		os.Exit(1)
	}
}

var _ = errors.Is // keep errors import if unused paths change
