package gemini

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// captureRoundTripper is an http.RoundTripper that records the request it sees
// and returns a canned Gemini response. It lets tests validate the exact request
// structure sent to the real generativelanguage.googleapis.com endpoint without
// any network access or production code changes.
type captureRoundTripper struct {
	mu       sync.Mutex
	body     []byte
	url      string
	response string
	status   int
}

func (c *captureRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.body = body
	c.url = req.URL.String()
	c.mu.Unlock()

	respBody := `{"candidates":[{"content":{"parts":[{"text":` + jsonString(c.response) + `}]}}]}`
	return &http.Response{
		StatusCode: c.status,
		Status:     http.StatusText(c.status),
		Body:       io.NopCloser(strings.NewReader(respBody)),
		Header:     make(http.Header),
	}, nil
}

func (c *captureRoundTripper) capturedBody() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	var decoded map[string]any
	_ = json.Unmarshal(c.body, &decoded)
	return decoded
}

func (c *captureRoundTripper) capturedURL() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.url
}

func jsonString(s string) string {
	encoded, _ := json.Marshal(s)
	return string(encoded)
}

func newTestClient(capture *captureRoundTripper) *Client {
	client := New("test-api-key", "gemini-2.0-flash", 500, 10*time.Second)
	client.httpClient = &http.Client{Transport: capture}
	return client
}

func TestCompleteSendsChatSphereSystemInstruction(t *testing.T) {
	capture := &captureRoundTripper{response: "Yes! I'm ChatSphere AI, the AI assistant built into ChatSphere.", status: http.StatusOK}
	client := newTestClient(capture)

	reply, err := client.Complete(context.Background(), "Are you ChatSphere AI?")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if reply != "Yes! I'm ChatSphere AI, the AI assistant built into ChatSphere." {
		t.Fatalf("reply = %q", reply)
	}

	body := capture.capturedBody()
	systemInstruction, ok := body["systemInstruction"].(map[string]any)
	if !ok {
		t.Fatal("request body has no systemInstruction field")
	}
	parts, ok := systemInstruction["parts"].([]any)
	if !ok || len(parts) == 0 {
		t.Fatal("systemInstruction has no parts")
	}
	part, ok := parts[0].(map[string]any)
	if !ok {
		t.Fatal("systemInstruction part is not an object")
	}
	text, ok := part["text"].(string)
	if !ok {
		t.Fatal("systemInstruction part has no text")
	}

	// The system instruction must establish the ChatSphere AI persona.
	if !strings.Contains(text, "You are ChatSphere AI") {
		t.Fatalf("system instruction does not establish ChatSphere AI persona:\n%s", text)
	}
	if !strings.Contains(text, "NEVER respond with:") {
		t.Fatalf("system instruction does not include the never rule:\n%s", text)
	}
	if !strings.Contains(text, `powered by Google's Gemini technology`) {
		t.Fatalf("system instruction does not include the truthful Gemini disclosure:\n%s", text)
	}
}

func TestCompleteDoesNotModifyUserMessage(t *testing.T) {
	capture := &captureRoundTripper{response: "ok", status: http.StatusOK}
	client := newTestClient(capture)

	prompt := "Are you Google Gemini?"
	if _, err := client.Complete(context.Background(), prompt); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	body := capture.capturedBody()
	contents, ok := body["contents"].([]any)
	if !ok || len(contents) == 0 {
		t.Fatal("request body has no contents")
	}
	content, ok := contents[0].(map[string]any)
	if !ok {
		t.Fatal("content is not an object")
	}
	parts, ok := content["parts"].([]any)
	if !ok || len(parts) == 0 {
		t.Fatal("content has no parts")
	}
	part, ok := parts[0].(map[string]any)
	if !ok {
		t.Fatal("content part is not an object")
	}
	text, ok := part["text"].(string)
	if !ok {
		t.Fatal("content part has no text")
	}

	if text != prompt {
		t.Fatalf("user message modified: got %q, want %q", text, prompt)
	}
	// The user message must not contain the system instruction.
	if strings.Contains(text, "You are ChatSphere AI") {
		t.Fatal("system instruction was prepended to the user message")
	}
	if strings.Contains(text, "IDENTITY RULES") {
		t.Fatal("persona rules leaked into the user message")
	}
}

func TestCompleteSystemInstructionIsSeparateFromContents(t *testing.T) {
	capture := &captureRoundTripper{response: "ok", status: http.StatusOK}
	client := newTestClient(capture)

	if _, err := client.Complete(context.Background(), "Tell me a joke."); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	body := capture.capturedBody()
	systemInstruction, ok := body["systemInstruction"].(map[string]any)
	if !ok {
		t.Fatal("systemInstruction is missing")
	}
	contents, ok := body["contents"].([]any)
	if !ok {
		t.Fatal("contents is missing")
	}

	// The system instruction must NOT appear inside the contents array.
	contentsJSON, _ := json.Marshal(contents)
	if strings.Contains(string(contentsJSON), "You are ChatSphere AI") {
		t.Fatal("ChatSphere AI persona text appears inside contents; it must be a separate systemInstruction")
	}
	// Both fields are present: the system is a separate top-level key.
	if _, ok := systemInstruction["parts"]; !ok {
		t.Fatal("systemInstruction has no parts")
	}
}

func TestCompletePreservesGenerationConfig(t *testing.T) {
	capture := &captureRoundTripper{response: "ok", status: http.StatusOK}
	client := New("test-api-key", "gemini-2.0-flash", 1234, 10*time.Second)
	client.httpClient = &http.Client{Transport: capture}

	if _, err := client.Complete(context.Background(), "hello"); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	body := capture.capturedBody()
	genConfig, ok := body["generationConfig"].(map[string]any)
	if !ok {
		t.Fatal("generationConfig is missing")
	}
	maxTokens, ok := genConfig["maxOutputTokens"].(float64)
	if !ok || int(maxTokens) != 1234 {
		t.Fatalf("maxOutputTokens = %v, want 1234", genConfig["maxOutputTokens"])
	}
}

func TestCompleteKeepsAPIKeyInQueryOnly(t *testing.T) {
	capture := &captureRoundTripper{response: "ok", status: http.StatusOK}
	client := newTestClient(capture)

	if _, err := client.Complete(context.Background(), "hello"); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	// The API key must be in the URL query string, never in the JSON body.
	body := capture.capturedBody()
	bodyJSON, _ := json.Marshal(body)
	if strings.Contains(string(bodyJSON), "test-api-key") {
		t.Fatal("API key leaked into the request body")
	}
	url := capture.capturedURL()
	if !strings.Contains(url, "key=test-api-key") {
		t.Fatalf("API key missing from query string: %s", url)
	}
	if strings.Contains(url, "\n") || strings.Contains(url, " ") {
		t.Fatalf("URL contains whitespace: %s", url)
	}
}

func TestCompleteUsesUnmodifiedEndpoint(t *testing.T) {
	capture := &captureRoundTripper{response: "ok", status: http.StatusOK}
	client := newTestClient(capture)

	if _, err := client.Complete(context.Background(), "hello"); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	url := capture.capturedURL()
	if !strings.HasPrefix(url, "https://generativelanguage.googleapis.com/v1beta/models/") {
		t.Fatalf("unexpected endpoint: %s", url)
	}
	if !strings.Contains(url, ":generateContent") {
		t.Fatalf("endpoint missing generateContent action: %s", url)
	}
	if !strings.Contains(url, "gemini-2.0-flash") {
		t.Fatalf("model missing from URL: %s", url)
	}
}

func TestCompleteSystemInstructionIdentityRules(t *testing.T) {
	// Verify the persona rules cover every identity prompt from the spec.
	requiredRules := []string{
		"You are ChatSphere AI",
		"official AI assistant integrated into the ChatSphere application",
		`identify yourself as ChatSphere AI`,
		`NEVER respond with: "I am not ChatSphere AI."`,
		`Google Gemini`,
		`powered by Google's Gemini technology`,
		`friendly, helpful, professional tone`,
	}

	for _, rule := range requiredRules {
		if !strings.Contains(chatSphereSystemInstruction, rule) {
			t.Errorf("system instruction missing required rule: %q", rule)
		}
	}

	// Positive: it must instruct the model to be ChatSphere AI.
	if !strings.Contains(chatSphereSystemInstruction, "ChatSphere AI") {
		t.Error("system instruction does not mention ChatSphere AI")
	}

	// Negative: it must tell the model NOT to claim ChatSphere trained Gemini.
	if !strings.Contains(chatSphereSystemInstruction, "Do NOT claim that ChatSphere created or trained the underlying Gemini model") {
		t.Error("system instruction missing the truthful-origin rule")
	}

	// Negative: the model must not claim to be human.
	if !strings.Contains(chatSphereSystemInstruction, "Do NOT claim to be a human") {
		t.Error("system instruction missing the not-a-human rule")
	}
}
