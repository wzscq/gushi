package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gushi/auth-service/internal/auth"
	"github.com/gushi/auth-service/internal/config"
	"github.com/gushi/auth-service/internal/httpapi"
)

func main() {
	logger := log.New(os.Stdout, "[auth] ", log.LstdFlags|log.Lmsgprefix)

	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("config: %v", err)
	}

	svc, err := auth.NewService(cfg)
	if err != nil {
		logger.Fatalf("auth service: %v", err)
	}

	srv := httpapi.New(svc, logger)

	logger.Printf("listening on %s (crv appid=%s)", cfg.Addr, cfg.CRVAppID)
	if err := http.ListenAndServe(cfg.Addr, srv.Handler()); err != nil {
		logger.Fatalf("server: %v", err)
	}
}
