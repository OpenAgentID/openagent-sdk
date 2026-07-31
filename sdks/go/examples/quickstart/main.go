// The README quickstart, compiled by CI as the docs-truth gate.
//
// If the README's sample stops compiling, the README has drifted from the
// package - and CI says so. Every import and call here must match the README.
package main

import (
	"github.com/OpenAgentID/openagent-sdk-go/openagent"
)

func main() {
	key := make([]byte, 32)

	// The verifier shape from the README.
	verifier, err := openagent.NewVerifier(
		[][]byte{key},
		"arsenal:broker:prod-1",
		"my-service",
	)
	if err != nil {
		panic(err)
	}
	_ = verifier

	// The fluent shape, also documented.
	scope, err := openagent.ParseScope("tools:calendar:invoke")
	if err != nil {
		panic(err)
	}
	_ = openagent.Verify(nil).
		Issuer("arsenal:broker:prod-1").
		ForAudience("my-service").
		RequireScope(scope).
		TrustedKeys(key)

	// Key custody, also documented.
	keys, err := openagent.GenerateKeys()
	if err != nil {
		panic(err)
	}
	_ = keys
}
