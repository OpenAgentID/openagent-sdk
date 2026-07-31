package openagent

import "strings"

// ScopeSegments is the required segment count (spec section 5.1).
const ScopeSegments = 3

// Wildcard is the wildcard segment.
const Wildcard = "*"

// Scope is a parsed scope of exactly three segments.
//
// Matching is directional: `*` expands in a GRANT and is literal in a
// REQUEST. Otherwise a holder of `tools:calendar:invoke` could request
// `tools:calendar:*` and be authorized for actions it was never granted.
type Scope struct {
	Service  string
	Resource string
	Action   string
}

// ParseScope parses a scope string of exactly three non-empty segments.
func ParseScope(text string) (Scope, error) {
	if text == "" || len(text) > 512 {
		return Scope{}, actErr(ErrMalformedScope, "empty or over 512 characters")
	}
	parts := strings.Split(text, ":")
	if len(parts) != ScopeSegments {
		return Scope{}, actErr(ErrMalformedScope,
			"must have exactly three segments")
	}
	for _, p := range parts {
		if p == "" {
			return Scope{}, actErr(ErrMalformedScope, "segments must be non-empty")
		}
	}
	return Scope{Service: parts[0], Resource: parts[1], Action: parts[2]}, nil
}

// Covers reports whether this GRANT covers the requested scope. `*` expands
// in the grant only; a `*` in the request matches literally.
func (s Scope) Covers(requested Scope) bool {
	granted := [3]string{s.Service, s.Resource, s.Action}
	wanted := [3]string{requested.Service, requested.Resource, requested.Action}
	for i := range granted {
		if granted[i] != Wildcard && granted[i] != wanted[i] {
			return false
		}
	}
	return true
}

func (s Scope) String() string {
	return s.Service + ":" + s.Resource + ":" + s.Action
}
