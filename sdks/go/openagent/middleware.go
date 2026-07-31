package openagent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// ClaimsContextKey is the context key for verified claims.
type ClaimsContextKey struct{}

// RequireAct returns middleware that guards a handler with ACT verification.
//
// A request with a missing, forged, expired, wrong-audience, or
// under-scoped token gets a 401 with the reason and the route never runs.
// On success the verified claims land in the request context under
// ClaimsContextKey and on the X-OpenAgent-Act-Claims header for the wrapped
// handler's convenience.
func RequireAct(verifier *Verifier, scopes ...Scope) func(http.Handler) http.Handler {
	bound := verifier
	if len(scopes) > 0 {
		bound = verifier.RequiringScopes(scopes...)
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r.Header.Get("Authorization"))
			if token == nil {
				writeUnauthorized(w, "missing or malformed capability token")
				return
			}

			claims, err := bound.Verify(token)
			if err != nil {
				writeUnauthorized(w, "ACT verification failed: "+err.Error())
				return
			}

			r = r.WithContext(context.WithValue(r.Context(), ClaimsContextKey{}, claims))
			w.Header().Set("X-OpenAgent-Act-Sub", claims.Sub)
			next.ServeHTTP(w, r)
		})
	}
}

// RequireActFunc is the HandlerFunc-shaped convenience for http.HandleFunc.
func RequireActFunc(verifier *Verifier, next http.HandlerFunc, scopes ...Scope) http.HandlerFunc {
	return RequireAct(verifier, scopes...)(next).ServeHTTP
}

// ClaimsFromRequest returns the verified claims attached by RequireAct, or nil.
func ClaimsFromRequest(r *http.Request) *ActClaims {
	claims, _ := r.Context().Value(ClaimsContextKey{}).(*ActClaims)
	return claims
}

func extractToken(authorization string) []byte {
	if authorization == "" {
		return nil
	}
	scheme, token, ok := strings.Cut(authorization, " ")
	if !ok {
		return nil
	}
	if !strings.EqualFold(scheme, "Bearer") && !strings.EqualFold(scheme, "OpenAgent") {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil
	}
	return raw
}

func writeUnauthorized(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "OpenAgent")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": reason})
}
