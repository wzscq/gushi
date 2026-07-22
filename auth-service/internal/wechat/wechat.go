package wechat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const code2SessionURL = "https://api.weixin.qq.com/sns/jscode2session"

type Session struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

type Client struct {
	appID     string
	appSecret string
	http      *http.Client
}

func NewClient(appID, appSecret string) *Client {
	return &Client{
		appID:     appID,
		appSecret: appSecret,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) Code2Session(ctx context.Context, code string) (*Session, error) {
	q := url.Values{}
	q.Set("appid", c.appID)
	q.Set("secret", c.appSecret)
	q.Set("js_code", code)
	q.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, code2SessionURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wechat code2session: %w", err)
	}
	defer resp.Body.Close()

	var sess Session
	if err := json.NewDecoder(resp.Body).Decode(&sess); err != nil {
		return nil, fmt.Errorf("decode wechat response: %w", err)
	}
	if sess.ErrCode != 0 {
		return nil, fmt.Errorf("wechat error %d: %s", sess.ErrCode, sess.ErrMsg)
	}
	if sess.OpenID == "" {
		return nil, fmt.Errorf("wechat returned empty openid")
	}

	return &sess, nil
}
