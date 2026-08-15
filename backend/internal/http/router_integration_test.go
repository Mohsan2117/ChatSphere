package http

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestVoiceMessageUpload(t *testing.T) {
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

	ali := createTestUser(t, router, "ali-voice-"+suffix+"@example.com", "Ali", "Voice")
	hamza := createTestUser(t, router, "hamza-voice-"+suffix+"@example.com", "Hamza", "Voice")

	// 1. Simulate voice file upload
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "voice-message_5s.webm")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("dummy audio content webm format"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+ali.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("upload voice message failed: status %d body %s", resp.Code, resp.Body.String())
	}

	var uploadResp struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Kind string `json:"kind"`
		URL  string `json:"url"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &uploadResp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}

	if uploadResp.Kind != "audio" {
		t.Fatalf("expected upload kind to be audio, got %s", uploadResp.Kind)
	}

	// 2. Send private message with voice attachment
	postJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "",
		"attachment": map[string]any{
			"name": uploadResp.Name,
			"type": uploadResp.Type,
			"kind": uploadResp.Kind,
			"url":  uploadResp.URL,
		},
	}, http.StatusOK)
}

func TestOptimizeCloudinaryURL(t *testing.T) {
	cfg := config.Config{
		MaxUploadSizeMB:             50,
		ImageOptimizeThresholdBytes: 2097152,  // 2 MB
		VideoOptimizeThresholdBytes: 10485760, // 10 MB
		ImageMaxDimension:           1920,
		VideoMaxDimension:           1280,
	}

	tests := []struct {
		name        string
		rawURL      string
		kind        string
		size        int64
		expectedURL string
	}{
		{
			name:        "Image below threshold -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
			kind:        "image",
			size:        1 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
		},
		{
			name:        "Image above threshold -> optimized with c_limit and 1920 dimension",
			rawURL:      "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1920,h_1920/v12345/sample.jpg",
		},
		{
			name:        "Video below threshold -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
			kind:        "video",
			size:        5 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
		},
		{
			name:        "Video above threshold -> optimized with c_limit and 1280 dimension",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
			kind:        "video",
			size:        15 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/f_auto,q_auto,c_limit,w_1280,h_1280/v12345/sample.mp4",
		},
		{
			name:        "Audio -> unchanged even if large",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp3",
			kind:        "audio",
			size:        25 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp3",
		},
		{
			name:        "Generic file -> unchanged even if large",
			rawURL:      "https://res.cloudinary.com/demo/raw/upload/v12345/sample.pdf",
			kind:        "file",
			size:        25 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/raw/upload/v12345/sample.pdf",
		},
		{
			name:        "Invalid Cloudinary URL -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/image/download/v12345/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/download/v12345/sample.jpg",
		},
		{
			name:        "Non-Cloudinary URL -> unchanged",
			rawURL:      "https://example.com/files/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://example.com/files/sample.jpg",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := optimizeCloudinaryURL(tc.rawURL, tc.kind, tc.size, cfg)
			if actual != tc.expectedURL {
				t.Errorf("expected URL:\n%s\ngot:\n%s", tc.expectedURL, actual)
			}
			// Verify that no cropping transforms (c_crop, c_fill, c_fill_pad) are introduced
			if strings.Contains(actual, "c_crop") || strings.Contains(actual, "c_fill") || strings.Contains(actual, "c_fill_pad") {
				t.Errorf("illegal crop transformation introduced in: %s", actual)
			}
		})
	}
}

func TestConfigDefaults(t *testing.T) {
	// Unset environment variables to ensure we check defaults
	os.Unsetenv("MAX_UPLOAD_SIZE_MB")
	os.Unsetenv("IMAGE_OPTIMIZE_THRESHOLD_BYTES")
	os.Unsetenv("VIDEO_OPTIMIZE_THRESHOLD_BYTES")
	os.Unsetenv("IMAGE_MAX_DIMENSION")
	os.Unsetenv("VIDEO_MAX_DIMENSION")

	cfg := config.Load()
	if cfg.MaxUploadSizeMB != 50 {
		t.Errorf("expected default MaxUploadSizeMB to be 50, got %d", cfg.MaxUploadSizeMB)
	}
	if cfg.ImageOptimizeThresholdBytes != 2097152 {
		t.Errorf("expected default ImageOptimizeThresholdBytes to be 2097152, got %d", cfg.ImageOptimizeThresholdBytes)
	}
	if cfg.VideoOptimizeThresholdBytes != 10485760 {
		t.Errorf("expected default VideoOptimizeThresholdBytes to be 10485760, got %d", cfg.VideoOptimizeThresholdBytes)
	}
	if cfg.ImageMaxDimension != 1920 {
		t.Errorf("expected default ImageMaxDimension to be 1920, got %d", cfg.ImageMaxDimension)
	}
	if cfg.VideoMaxDimension != 1280 {
		t.Errorf("expected default VideoMaxDimension to be 1280, got %d", cfg.VideoMaxDimension)
	}
}
