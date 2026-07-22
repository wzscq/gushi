package config

import (
	"fmt"
	"os"
)

type Config struct {
	Addr string

	WeChatAppID     string
	WeChatAppSecret string

	CRVBaseURL string
	CRVAppID   string

	// CRVProvisionerToken is a long-lived int_ integration token for core_user sync.
	CRVProvisionerToken string

	// LoginUsernameField is the core_user column used as CRV login username.
	LoginUsernameField string

	// PasswordSecret derives stable internal passwords from openid (HMAC).
	PasswordSecret string

	DefaultRole string
}

func Load() (*Config, error) {
	cfg := &Config{
		Addr:                getEnv("AUTH_ADDR", ":8081"),
		WeChatAppID:         os.Getenv("WECHAT_APP_ID"),
		WeChatAppSecret:     os.Getenv("WECHAT_APP_SECRET"),
		CRVBaseURL:          getEnv("CRV_BASE_URL", "http://127.0.0.1:8080"),
		CRVAppID:            getEnv("CRV_APPID", "gushi"),
		CRVProvisionerToken: os.Getenv("CRV_PROVISIONER_TOKEN"),
		LoginUsernameField:  getEnv("CRV_LOGIN_USERNAME_FIELD", "id"),
		PasswordSecret:      os.Getenv("AUTH_PASSWORD_SECRET"),
		DefaultRole:         getEnv("DEFAULT_USER_ROLE", "gushi_user"),
	}

	if cfg.WeChatAppID == "" || cfg.WeChatAppSecret == "" {
		return nil, fmt.Errorf("WECHAT_APP_ID and WECHAT_APP_SECRET are required")
	}
	if cfg.PasswordSecret == "" {
		return nil, fmt.Errorf("AUTH_PASSWORD_SECRET is required (used to derive user internal passwords)")
	}
	if cfg.CRVProvisionerToken == "" {
		return nil, fmt.Errorf("CRV_PROVISIONER_TOKEN is required (int_ integration token for core_user sync)")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
