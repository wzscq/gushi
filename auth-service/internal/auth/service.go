package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/gushi/auth-service/internal/config"
	"github.com/gushi/auth-service/internal/crv"
	"github.com/gushi/auth-service/internal/idgen"
	"github.com/gushi/auth-service/internal/password"
	"github.com/gushi/auth-service/internal/wechat"
)

type UserInfo struct {
	ID        string `json:"id"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

type LoginResult struct {
	AccessToken string   `json:"access_token"`
	TokenType   string   `json:"token_type"`
	ExpiresIn   int64    `json:"expires_in"`
	IsNewUser   bool     `json:"is_new_user"`
	User        UserInfo `json:"user"`
}

type Service struct {
	cfg               *config.Config
	wx                *wechat.Client
	provisionerClient *crv.Client
	ids               *idgen.Generator
}

func NewService(cfg *config.Config) (*Service, error) {
	return &Service{
		cfg:               cfg,
		wx:                wechat.NewClient(cfg.WeChatAppID, cfg.WeChatAppSecret),
		provisionerClient: crv.NewSessionClient(cfg.CRVBaseURL, cfg.CRVProvisionerToken),
		ids:               idgen.New(),
	}, nil
}

type LoginInput struct {
	Code      string
	Nickname  string
	AvatarURL string
}

func (s *Service) Login(ctx context.Context, in LoginInput) (*LoginResult, error) {
	if strings.TrimSpace(in.Code) == "" {
		return nil, fmt.Errorf("code is required")
	}
	appID := s.cfg.CRVAppID

	sess, err := s.wx.Code2Session(ctx, in.Code)
	if err != nil {
		return nil, fmt.Errorf("wechat login failed: %w", err)
	}

	nickname := strings.TrimSpace(in.Nickname)
	userNameZh := nickname
	avatarURL := strings.TrimSpace(in.AvatarURL)
	internalPass := password.Derive(sess.OpenID, s.cfg.PasswordSecret)

	existing, err := s.findUserByOpenID(ctx, sess.OpenID)
	if err != nil {
		return nil, fmt.Errorf("lookup user: %w", err)
	}

	isNew := existing == nil
	userID := ""
	version := 0

	if isNew {
		userID = s.ids.Next()
		newUser := crv.CoreUser{
			ID:         userID,
			OpenID:     sess.OpenID,
			UnionID:    sess.UnionID,
			Nickname:   nickname,
			UserNameZh: userNameZh,
			UserNameEn: userID,
			AvatarURL:  avatarURL,
		}
		if err := s.createUser(ctx, newUser, internalPass); err != nil {
			return nil, fmt.Errorf("create user in crv: %w", err)
		}
	} else {
		userID = existing.ID
		version = existing.Version
		if nickname == "" {
			nickname = existing.Nickname
		}
		if userNameZh == "" {
			userNameZh = existing.UserNameZh
		}
		if avatarURL == "" {
			avatarURL = existing.AvatarURL
		}

		profileChanged := nickname != existing.Nickname ||
			userNameZh != existing.UserNameZh ||
			avatarURL != existing.AvatarURL
		if profileChanged {
			if err := s.updateUserProfile(ctx, userID, version, nickname, userNameZh, avatarURL, ""); err != nil {
				return nil, fmt.Errorf("update user profile: %w", err)
			}
		}
	}

	loginName, err := s.loginUsername(userID, existing)
	if err != nil {
		return nil, err
	}

	session, err := crv.Login(ctx, s.cfg.CRVBaseURL, loginName, internalPass, appID)
	if err != nil {
		// Password may be missing/stale (e.g. created before SHA-256 hashing); reset and retry.
		if version == 0 {
			if latest, lookupErr := s.findUserByOpenID(ctx, sess.OpenID); lookupErr == nil && latest != nil {
				version = latest.Version
			}
		}
		if resetErr := s.updateUserProfile(ctx, userID, version, "", "", "", internalPass); resetErr != nil {
			return nil, fmt.Errorf("crv user login failed: %w (password reset: %v)", err, resetErr)
		}
		session, err = crv.Login(ctx, s.cfg.CRVBaseURL, loginName, internalPass, appID)
	}
	if err != nil {
		return nil, fmt.Errorf("crv user login: %w", err)
	}

	tokenType := session.TokenType
	if tokenType == "" {
		tokenType = "Bearer"
	}

	return &LoginResult{
		AccessToken: session.AccessToken,
		TokenType:   tokenType,
		ExpiresIn:   session.ExpiresIn,
		IsNewUser:   isNew,
		User: UserInfo{
			ID:        userID,
			Nickname:  nickname,
			AvatarURL: avatarURL,
		},
	}, nil
}

func (s *Service) findUserByOpenID(ctx context.Context, openid string) (*crv.CoreUser, error) {
	return s.provisionerClient.FindUserByOpenID(ctx, openid)
}

func (s *Service) createUser(ctx context.Context, user crv.CoreUser, internalPass string) error {
	return s.provisionerClient.CreateUser(ctx, user, internalPass, s.cfg.DefaultRole)
}

func (s *Service) updateUserProfile(ctx context.Context, id string, version int, nickname, userNameZh, avatarURL, password string) error {
	return s.provisionerClient.UpdateUserProfile(ctx, id, version, nickname, userNameZh, avatarURL, password)
}

func (s *Service) loginUsername(userID string, existing *crv.CoreUser) (string, error) {
	switch s.cfg.LoginUsernameField {
	case "id":
		return userID, nil
	case "user_name_en":
		if existing != nil && existing.UserNameEn != "" {
			return existing.UserNameEn, nil
		}
		return userID, nil
	case "user_name_zh":
		if existing != nil && existing.UserNameZh != "" {
			return existing.UserNameZh, nil
		}
		return userID, nil
	default:
		return "", fmt.Errorf("unsupported CRV_LOGIN_USERNAME_FIELD: %s", s.cfg.LoginUsernameField)
	}
}
