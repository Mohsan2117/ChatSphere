package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/store"

	"github.com/gin-gonic/gin"
)

// fakeGemini is an in-memory Gemini caller used by tests. It records how many
// times Complete was invoked so tests can prove that rejected requests never
// reach Gemini.
type fakeGemini struct {
	mu       sync.Mutex
	calls    int
	response string
	err      error
}

func (f *fakeGemini) Complete(ctx context.Context, prompt string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.response, nil
}

func (f *fakeGemini) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func newAITestHarness(t *testing.T, cfg config.Config, caller geminiCaller) (*store.Store, *gin.Engine, func()) {
	t.Helper()
	path := t.TempDir() + "/ai-test.json"
	dataStore, err := store.New(path, "")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api/v1")
	newAIHandler(cfg, dataStore, caller).register(api.Group("/ai"))
	return dataStore, router, func() {}
}

func testAIConfig() config.Config {
	return config.Config{
		GeminiDailyLimit:             20,
		GeminiIPRateLimit:            5,
		GeminiRequestCooldownSeconds: 2,
		GeminiMaxMessageLength:       2000,
	}
}

func createStoreUser(t *testing.T, dataStore *store.Store, email string) authUser {
	t.Helper()
	user, err := dataStore.UpsertUser(email, "Test", "User", "Password123!", "")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return authUser{ID: user.ID, Email: user.Email}
}

func signTestUserToken(user authUser) string {
	return signUserToken(store.User{ID: user.ID, Email: user.Email})
}

func postAI(t *testing.T, router http.Handler, token, message string, wantStatus int) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"message": message})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("POST /api/v1/ai/chat: status %d want %d body %s", resp.Code, wantStatus, resp.Body.String())
	}
	return resp
}

func TestAIChatRequiresAuthentication(t *testing.T) {
	cfg := testAIConfig()
	fake := &fakeGemini{response: "ok"}
	_, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	postAI(t, router, "", "hello", http.StatusUnauthorized)
	if fake.callCount() != 0 {
		t.Fatal("Gemini was called without authentication")
	}
}

func TestAIChatRejectsInvalidMessages(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiMaxMessageLength = 5
	fake := &fakeGemini{response: "ok"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-invalid@example.com")
	token := signTestUserToken(user)

	// Not JSON at all.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chat", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON: status %d want 400", resp.Code)
	}

	// Empty message.
	postAI(t, router, token, "   ", http.StatusBadRequest)
	// Oversized message.
	postAI(t, router, token, "123456", http.StatusBadRequest)

	if fake.callCount() != 0 {
		t.Fatal("Gemini was called for invalid messages")
	}
}

func TestAIChatCooldownBlocksRapidRequests(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiRequestCooldownSeconds = 2
	fake := &fakeGemini{response: "ok"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-cooldown@example.com")
	token := signTestUserToken(user)

	postAI(t, router, token, "first", http.StatusOK)
	// Second request within the cooldown window must be rejected before Gemini.
	postAI(t, router, token, "second", http.StatusTooManyRequests)

	if fake.callCount() != 1 {
		t.Fatalf("Gemini call count = %d, want 1 (cooldown must not reach Gemini)", fake.callCount())
	}
}

func TestAIChatIPRateLimit(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiIPRateLimit = 2
	cfg.GeminiRequestCooldownSeconds = 0
	fake := &fakeGemini{response: "ok"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-ip@example.com")
	token := signTestUserToken(user)

	postAI(t, router, token, "one", http.StatusOK)
	postAI(t, router, token, "two", http.StatusOK)
	postAI(t, router, token, "three", http.StatusTooManyRequests)

	if fake.callCount() != 2 {
		t.Fatalf("Gemini call count = %d, want 2 (IP rate limit must block before Gemini)", fake.callCount())
	}
}

func TestAIChatDailyLimit(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiDailyLimit = 2
	cfg.GeminiRequestCooldownSeconds = 0
	fake := &fakeGemini{response: "ok"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-daily@example.com")
	token := signTestUserToken(user)

	postAI(t, router, token, "one", http.StatusOK)
	postAI(t, router, token, "two", http.StatusOK)
	// Third request must hit the daily limit BEFORE Gemini is called.
	resp := postAI(t, router, token, "three", http.StatusTooManyRequests)

	var payload map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &payload)
	if errorText, ok := payload["error"].(string); !ok || !strings.Contains(errorText, "Daily AI limit") {
		t.Fatalf("expected daily limit error, got %v", payload)
	}

	if fake.callCount() != 2 {
		t.Fatalf("Gemini call count = %d, want 2 (daily limit must block before Gemini)", fake.callCount())
	}

	// The rejected request must not consume a daily usage count.
	count, err := dataStore.AICountToday(user.ID)
	if err != nil {
		t.Fatalf("count today: %v", err)
	}
	if count != 2 {
		t.Fatalf("daily count = %d, want 2 (rejected request must not consume quota)", count)
	}
}

func TestAIChatRefundsOnGeminiFailure(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiRequestCooldownSeconds = 0
	fake := &fakeGemini{err: errors.New("gemini down")}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-refund@example.com")
	token := signTestUserToken(user)

	postAI(t, router, token, "hello", http.StatusInternalServerError)

	count, err := dataStore.AICountToday(user.ID)
	if err != nil {
		t.Fatalf("count today: %v", err)
	}
	if count != 0 {
		t.Fatalf("daily count = %d, want 0 (failed Gemini call must be refunded)", count)
	}

	// The failure response must not leak Gemini error details.
	resp := postAI(t, router, token, "hello again", http.StatusInternalServerError)
	if strings.Contains(resp.Body.String(), "gemini down") {
		t.Fatal("Gemini error details leaked to the user")
	}
}

func TestAIChatSuccess(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiRequestCooldownSeconds = 0
	fake := &fakeGemini{response: "Hello! How can I help?"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-success@example.com")
	token := signTestUserToken(user)

	resp := postAI(t, router, token, "Hi there", http.StatusOK)
	var payload struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Response != "Hello! How can I help?" {
		t.Fatalf("unexpected response %q", payload.Response)
	}

	count, err := dataStore.AICountToday(user.ID)
	if err != nil {
		t.Fatalf("count today: %v", err)
	}
	if count != 1 {
		t.Fatalf("daily count = %d, want 1 after success", count)
	}
}

func TestAIChatIgnoresUserProvidedID(t *testing.T) {
	cfg := testAIConfig()
	cfg.GeminiRequestCooldownSeconds = 0
	fake := &fakeGemini{response: "ok"}
	dataStore, router, cleanup := newAITestHarness(t, cfg, fake)
	defer cleanup()

	user := createStoreUser(t, dataStore, "ai-spoof@example.com")
	token := signTestUserToken(user)

	// The request sends a userId field, but the handler must use the
	// authenticated user ID for quota tracking and ignore this field.
	body, _ := json.Marshal(map[string]any{
		"message": "hello",
		"userId":  "attacker-controlled-id",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body %s", resp.Code, resp.Body.String())
	}

	count, err := dataStore.AICountToday("attacker-controlled-id")
	if err != nil {
		t.Fatalf("count today: %v", err)
	}
	if count != 0 {
		t.Fatal("user-provided userId was used for quota tracking")
	}
	countAuth, _ := dataStore.AICountToday(user.ID)
	if countAuth != 1 {
		t.Fatalf("authenticated user count = %d, want 1", countAuth)
	}
}