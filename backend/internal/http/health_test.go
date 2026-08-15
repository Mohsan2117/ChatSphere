package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"
)

func TestHealthEndpoint(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "chatsphere-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	dataPath := filepath.Join(tempDir, "data.json")

	cfg := config.Config{
		DataPath:       dataPath,
		DatabaseURL:    "", // testing file-based store
		AppEnv:         "test",
		FrontendOrigin: "http://localhost:3000",
	}

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	hub := realtime.NewHub()
	go hub.Run()

	router := NewRouter(cfg, hub, dataStore)

	// 1. Test /health
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.Code)
	}

	var responseBody map[string]string
	if err := json.Unmarshal(resp.Body.Bytes(), &responseBody); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}

	if responseBody["service"] != "chatsphere-api" {
		t.Errorf("expected service to be 'chatsphere-api', got %q", responseBody["service"])
	}
	if responseBody["status"] != "ok" {
		t.Errorf("expected status to be 'ok', got %q", responseBody["status"])
	}
	if responseBody["database"] != "ok" {
		t.Errorf("expected database to be 'ok', got %q", responseBody["database"])
	}

	// 2. Test / (root endpoint)
	reqRoot := httptest.NewRequest(http.MethodGet, "/", nil)
	respRoot := httptest.NewRecorder()
	router.ServeHTTP(respRoot, reqRoot)

	if respRoot.Code != http.StatusOK {
		t.Errorf("expected status 200 for root, got %d", respRoot.Code)
	}

	var rootBody map[string]string
	if err := json.Unmarshal(respRoot.Body.Bytes(), &rootBody); err != nil {
		t.Fatalf("failed to parse root response body: %v", err)
	}

	if rootBody["service"] != "chatsphere-api" {
		t.Errorf("expected root service to be 'chatsphere-api', got %q", rootBody["service"])
	}
	if rootBody["status"] != "ok" {
		t.Errorf("expected root status to be 'ok', got %q", rootBody["status"])
	}
}
