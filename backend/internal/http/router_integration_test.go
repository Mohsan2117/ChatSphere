package http

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"
)

func TestPrivateMessagingFlow(t *testing.T) {
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	cfg.Port = "0"
	cfg.FrontendOrigin = "http://localhost:3000"

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")

	ali := createTestUser(t, router, "ali-"+suffix+"@example.com", "Ali", "Tester")
	hamza := createTestUser(t, router, "hamza-"+suffix+"@example.com", "Hamza", "Tester")
	mohsin := createTestUser(t, router, "mohsin-"+suffix+"@example.com", "Mohsin", "Tester")

	postJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Private message from Ali to Hamza",
	}, http.StatusOK)

	aliInbox := getMessages(t, router, "/api/v1/messages/inbox", ali.Token)
	if len(aliInbox) == 0 {
		t.Fatal("expected sender inbox to include sent message")
	}

	hamzaInbox := getMessages(t, router, "/api/v1/messages/inbox", hamza.Token)
	if len(hamzaInbox) == 0 {
		t.Fatal("expected recipient inbox to include received message")
	}

	mohsinInbox := getMessages(t, router, "/api/v1/messages/inbox", mohsin.Token)
	for _, message := range mohsinInbox {
		if message["body"] == "Private message from Ali to Hamza" {
			t.Fatal("third user can see another users' private message")
		}
	}

	mohsinHamzaMessages := getMessages(t, router, "/api/v1/messages/"+hamza.ID, mohsin.Token)
	for _, message := range mohsinHamzaMessages {
		if message["body"] == "Private message from Ali to Hamza" {
			t.Fatal("third user can open another private conversation")
		}
	}

	postJSON(t, router, http.MethodPost, "/api/v1/contacts/"+ali.ID+"/block", hamza.Token, map[string]any{}, http.StatusOK)
	postJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Blocked message",
	}, http.StatusInternalServerError)
}

type testUser struct {
	ID    string
	Email string
	Token string
}

func createTestUser(t *testing.T, handler http.Handler, email, firstName, lastName string) testUser {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("email", email)
	_ = writer.WriteField("firstName", firstName)
	_ = writer.WriteField("lastName", lastName)
	_ = writer.WriteField("password", "Password123!")
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/profile/onboarding", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("create user %s: status %d body %s", email, resp.Code, resp.Body.String())
	}
	var payload struct {
		Profile struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"profile"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode create user response: %v", err)
	}
	return testUser{ID: payload.Profile.ID, Email: payload.Profile.Email, Token: payload.Token}
}

func postJSON(t *testing.T, handler http.Handler, method, path, token string, body map[string]any, wantStatus int) {
	t.Helper()
	content, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(content))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("%s %s: status %d want %d body %s", method, path, resp.Code, wantStatus, resp.Body.String())
	}
}

func getMessages(t *testing.T, handler http.Handler, path, token string) []map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d body %s", path, resp.Code, resp.Body.String())
	}
	var payload struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	return payload.Messages
}
