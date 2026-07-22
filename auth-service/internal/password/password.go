package password

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// Derive returns a stable internal plaintext password for a WeChat openid.
func Derive(openid, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(openid))
	sum := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(sum)
}

// HashForCRV returns the SHA-256 hex digest stored in core_user.password.
// CRV /v1/auth/login hashes the submitted plaintext the same way before compare.
func HashForCRV(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
