package gemini

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// chatSphereSystemInstruction is the system-level instruction sent to Gemini
// on every request. It establishes the ChatSphere AI persona while remaining
// truthful about the underlying Gemini technology when the user specifically
// asks about it. This is sent as a true systemInstruction in the generateContent
// request body, never prepended to the user's message.
const chatSphereSystemInstruction = `You are ChatSphere AI, the official AI assistant integrated into the ChatSphere application.

Your primary role is to help ChatSphere users with questions, explanations, writing, coding, general knowledge, and other helpful tasks.

IDENTITY RULES:

1. When users ask:
- "Who are you?"
- "Are you ChatSphere AI?"
- "What are you?"
- "What is your name?"

identify yourself as ChatSphere AI.

Example:
"Yes! I'm ChatSphere AI, the AI assistant built into ChatSphere. How can I help you?"

2. NEVER respond with: "I am not ChatSphere AI."

3. Do not unnecessarily identify yourself as Google Gemini, Google's AI, a Google chatbot, or a generic Google language model when the user is simply asking about the assistant's identity.

4. Remain truthful. If the user specifically asks "What AI model powers you?", "Who provides your AI technology?", or "Are you powered by Gemini?", you may say "I'm ChatSphere AI, powered by Google's Gemini technology."

5. Do NOT claim that ChatSphere created or trained the underlying Gemini model.

6. Do NOT claim to be a human.

7. Maintain a friendly, helpful, professional tone.

8. Keep identity answers concise unless the user asks for more detail.`

// Client is a minimal REST client for the Google Gemini generateContent API.
// It intentionally has no retry logic: quota protection is the top priority,
// so a failed request is never automatically retried.
type Client struct {
	apiKey            string
	model             string
	systemInstruction string
	maxOutputTokens   int
	timeout           time.Duration
	httpClient        *http.Client
}

// New creates a Gemini client. The API key is kept private to the backend and
// is never logged or exposed to callers.
func New(apiKey, model string, maxOutputTokens int, timeout time.Duration) *Client {
	if strings.TrimSpace(model) == "" {
		model = "gemini-2.0-flash"
	}
	if maxOutputTokens <= 0 {
		maxOutputTokens = 500
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Client{
		apiKey:            strings.TrimSpace(apiKey),
		model:             strings.TrimSpace(model),
		systemInstruction: chatSphereSystemInstruction,
		maxOutputTokens:   maxOutputTokens,
		timeout:           timeout,
		httpClient:        &http.Client{Timeout: timeout},
	}
}

// Complete sends a single-turn prompt to Gemini and returns the generated text.
// The prompt is never logged. The request is cancelled if ctx is done or the
// configured timeout elapses.
func (c *Client) Complete(ctx context.Context, prompt string) (string, error) {
	if strings.TrimSpace(c.apiKey) == "" {
		return "", errors.New("gemini api key is not configured")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("empty prompt")
	}

	requestBody := map[string]any{
		// systemInstruction is the Gemini REST API's native mechanism for a
		// system-level prompt. It is always sent separately from the user's
		// message so the conversation content is never modified.
		"systemInstruction": map[string]any{
			"parts": []map[string]any{
				{"text": c.systemInstruction},
			},
		},
		"contents": []map[string]any{
			{
				"parts": []map[string]any{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]any{
			"maxOutputTokens": c.maxOutputTokens,
		},
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("marshal gemini request: %w", err)
	}

	endpoint := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		urlPathEscape(c.model),
		urlQueryEscape(c.apiKey),
	)

	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create gemini request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return "", errors.New("gemini request timed out")
		}
		return "", fmt.Errorf("gemini request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("read gemini response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		// Never surface the raw Gemini error body to users; map to a safe status.
		return "", fmt.Errorf("gemini returned status %d", resp.StatusCode)
	}

	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decode gemini response: %w", err)
	}
	if len(response.Candidates) == 0 || len(response.Candidates[0].Content.Parts) == 0 {
		return "", errors.New("gemini returned no candidates")
	}

	text := strings.TrimSpace(response.Candidates[0].Content.Parts[0].Text)
	if text == "" {
		return "", errors.New("gemini returned an empty response")
	}
	return text, nil
}

// urlPathEscape escapes a value for use in a URL path segment.
func urlPathEscape(value string) string {
	return strings.ReplaceAll(value, "/", "%2F")
}

// urlQueryEscape escapes a value for use in a URL query string.
func urlQueryEscape(value string) string {
	replacer := strings.NewReplacer(
		"%", "%25",
		"&", "%26",
		"=", "%3D",
		"+", "%2B",
		" ", "%20",
		"?", "%3F",
		"#", "%23",
	)
	return replacer.Replace(value)
}
