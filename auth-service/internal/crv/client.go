package crv

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gushi/auth-service/internal/password"
)

type envelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type loginErrorBody struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SessionResult is the direct response from POST /v1/auth/login (not Envelope).
type SessionResult struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
	Schema      string `json:"schema"`
}

type Client struct {
	baseURL    string
	token      string
	sendSchema bool
	schema     string
	http       *http.Client
}

// NewSessionClient creates a client that uses a CRV Bearer token (int_ or usr_).
func NewSessionClient(baseURL, token string) *Client {
	return &Client{
		baseURL:    baseURL,
		token:      token,
		sendSchema: false,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func Login(ctx context.Context, baseURL, username, password, appid string) (*SessionResult, error) {
	body := map[string]string{
		"username": username,
		"password": password,
		"appid":    appid,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/auth/login", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("crv login request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		var errBody loginErrorBody
		_ = json.Unmarshal(respBody, &errBody)
		msg := errBody.Message
		if msg == "" {
			msg = string(respBody)
		}
		return nil, fmt.Errorf("crv login http=%d code=%d message=%s", resp.StatusCode, errBody.Code, msg)
	}

	var result SessionResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("crv login decode: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("crv login returned empty access_token")
	}
	return &result, nil
}

type CoreUser struct {
	ID         string `json:"id"`
	Version    int    `json:"version"`
	OpenID     string `json:"openid"`
	UnionID    string `json:"union_id"`
	Nickname   string `json:"nickname"`
	UserNameZh string `json:"user_name_zh"`
	UserNameEn string `json:"user_name_en"`
	AvatarURL  string `json:"avatar_url"`
	Status     int    `json:"status"`
}

func (c *Client) FindUserByOpenID(ctx context.Context, openid string) (*CoreUser, error) {
	body := map[string]any{
		"modelId": "core_user",
		"fields": []map[string]string{
			{"field": "id"},
			{"field": "version"},
			{"field": "openid"},
			{"field": "union_id"},
			{"field": "nickname"},
			{"field": "user_name_zh"},
			{"field": "user_name_en"},
			{"field": "avatar_url"},
			{"field": "status"},
		},
		"filter": map[string]any{
			"openid": map[string]string{"Op.eq": openid},
		},
		"pagination": map[string]int{"current": 1, "pageSize": 1},
	}

	var data struct {
		List []CoreUser `json:"list"`
	}
	if err := c.post(ctx, "/v1/data/query", body, &data); err != nil {
		return nil, err
	}
	if len(data.List) == 0 {
		return nil, nil
	}
	return &data.List[0], nil
}

func (c *Client) CreateUser(ctx context.Context, user CoreUser, plainPassword, defaultRole string) error {
	nickname := user.Nickname
	if nickname == "" {
		nickname = user.UserNameZh
	}
	row := map[string]any{
		"_save_type":   "create",
		"id":           user.ID,
		"openid":       user.OpenID,
		"nickname":     nickname,
		"user_name_zh": user.UserNameZh,
		"user_name_en": user.UserNameEn,
		"password":     password.HashForCRV(plainPassword),
		"avatar_url":   user.AvatarURL,
		"default_view": "grid",
		"status":       1,
		"roles": map[string]any{
			"fieldType":          "many2many",
			"relatedModelId":     "core_role",
			"associationModelId": "core_role_core_user",
			"list": []map[string]any{
				{"_save_type": "create", "id": defaultRole},
			},
		},
	}
	if user.UnionID != "" {
		row["union_id"] = user.UnionID
	}

	body := map[string]any{
		"modelId": "core_user",
		"list":    []map[string]any{row},
	}
	return c.post(ctx, "/v1/data/save", body, nil)
}

func (c *Client) UpdateUserProfile(ctx context.Context, id string, version int, nickname, userNameZh, avatarURL, plainPassword string) error {
	row := map[string]any{
		"_save_type": "update",
		"id":         id,
		"version":    version,
	}
	if nickname != "" {
		row["nickname"] = nickname
	}
	if userNameZh != "" {
		row["user_name_zh"] = userNameZh
	}
	if avatarURL != "" {
		row["avatar_url"] = avatarURL
	}
	if plainPassword != "" {
		row["password"] = password.HashForCRV(plainPassword)
	}

	body := map[string]any{
		"modelId": "core_user",
		"list":    []map[string]any{row},
	}
	return c.post(ctx, "/v1/data/save", body, nil)
}

func (c *Client) post(ctx context.Context, path string, payload any, out any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	if c.sendSchema && c.schema != "" {
		req.Header.Set("X-Schema", c.schema)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("crv request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var env envelope
	if err := json.Unmarshal(respBody, &env); err != nil {
		return fmt.Errorf("crv decode envelope: %w (body=%s)", err, truncate(string(respBody), 512))
	}
	if env.Code != 0 {
		return fmt.Errorf("crv error code=%d message=%s http=%d", env.Code, env.Message, resp.StatusCode)
	}
	if out == nil || len(env.Data) == 0 || string(env.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("crv decode data: %w", err)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
