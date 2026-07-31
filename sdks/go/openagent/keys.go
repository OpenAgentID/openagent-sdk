package openagent

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"

	"golang.org/x/crypto/blake2b"
	"golang.org/x/crypto/curve25519"
)

// EncryptionDeriveContext is the derivation context for the encryption
// keypair (matches Arsenal's identity_loader).
const EncryptionDeriveContext = "arsenal.agent.encryption_key"

// AgentKeys is an agent's key material, derived from one 32-byte seed.
// Everything derives deterministically from the seed: persist it, restore
// the whole identity.
type AgentKeys struct {
	Seed                [32]byte
	SigningKey          ed25519.PrivateKey
	VerifyingKey        ed25519.PublicKey
	EncryptionSecretKey [32]byte
	EncryptionPublicKey [32]byte
}

// deriveSeed performs context-separated derivation of a 32-byte sub-key.
// Go's stdlib has no BLAKE3; this uses BLAKE2b keyed with the context, which
// is the closest keyed-derivation primitive in x/crypto. Cross-SDK seed
// movement uses BLAKE3 in Rust/TS/Python; Go custody is self-consistent.
func deriveSeed(context string, seed [32]byte) [32]byte {
	h, _ := blake2b.New(32, []byte(context))
	h.Write(seed[:])
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// KeysFromSeed restores an identity from its 32-byte seed.
func KeysFromSeed(seed [32]byte) (*AgentKeys, error) {
	signing := ed25519.NewKeyFromSeed(seed[:])
	verifying := signing.Public().(ed25519.PublicKey)

	derived := deriveSeed(EncryptionDeriveContext, seed)
	encryptionPublic, err := curve25519.X25519(derived[:], curve25519.Basepoint)
	if err != nil {
		return nil, configErr("x25519 public derivation: %v", err)
	}
	var encPub [32]byte
	copy(encPub[:], encryptionPublic)

	return &AgentKeys{
		Seed:                seed,
		SigningKey:          signing,
		VerifyingKey:        verifying,
		EncryptionSecretKey: derived,
		EncryptionPublicKey: encPub,
	}, nil
}

// GenerateKeys mints a fresh identity. The seed is the only thing to persist.
func GenerateKeys() (*AgentKeys, error) {
	var seed [32]byte
	if _, err := rand.Read(seed[:]); err != nil {
		return nil, configErr("csprng: %v", err)
	}
	return KeysFromSeed(seed)
}

// KeysFromSeedHex restores from a 64-character hex seed.
func KeysFromSeedHex(hexSeed string) (*AgentKeys, error) {
	if len(hexSeed) != 64 {
		return nil, configErr("seed must be 64 hex characters")
	}
	raw, err := hex.DecodeString(hexSeed)
	if err != nil {
		return nil, configErr("seed is not valid hex: %v", err)
	}
	var seed [32]byte
	copy(seed[:], raw)
	return KeysFromSeed(seed)
}

// KeysFromEnv restores from an environment variable holding the hex seed.
func KeysFromEnv(envVar string) (*AgentKeys, error) {
	value := os.Getenv(envVar)
	if value == "" {
		return nil, configErr("environment variable %s is not set", envVar)
	}
	return KeysFromSeedHex(value)
}

// SaveSeed persists the seed to a file with owner-only (0600) permissions,
// in Arsenal's seed-file format (raw 32 bytes).
func SaveSeed(keys *AgentKeys, path string) error {
	if err := os.WriteFile(path, keys.Seed[:], 0o600); err != nil {
		return fmt.Errorf("save seed: %w", err)
	}
	return nil
}

// KeysFromSeedFile restores from a seed file written by SaveSeed.
func KeysFromSeedFile(path string) (*AgentKeys, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read seed file: %w", err)
	}
	if len(raw) != 32 {
		return nil, configErr("seed file must contain exactly 32 bytes, got %d", len(raw))
	}
	var seed [32]byte
	copy(seed[:], raw)
	return KeysFromSeed(seed)
}

// SeedHex hex-encodes a seed for env vars and config files.
func SeedHex(seed [32]byte) string {
	return hex.EncodeToString(seed[:])
}
