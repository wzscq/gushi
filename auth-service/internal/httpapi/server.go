package httpapi

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gushi/auth-service/internal/auth"
)

type Server struct {
	auth *auth.Service
	log  *log.Logger
}

func New(authSvc *auth.Service, logger *log.Logger) *Server {
	if logger == nil {
		logger = log.Default()
	}
	return &Server{auth: authSvc, log: logger}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /auth/wechat/miniprogram", s.handleWeChatLogin)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "up"})
}

type weChatLoginRequest struct {
	Code      string `json:"code"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

func (s *Server) handleWeChatLogin(w http.ResponseWriter, r *http.Request) {
	var req weChatLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	result, err := s.auth.Login(r.Context(), auth.LoginInput{
		Code:      req.Code,
		Nickname:  req.Nickname,
		AvatarURL: req.AvatarURL,
	})
	if err != nil {
		s.log.Printf("wechat login failed: %v", err)
		writeError(w, http.StatusUnauthorized, "login_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{
		"error":   code,
		"message": message,
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
