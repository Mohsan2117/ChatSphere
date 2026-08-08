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

// Client is a minimal REST client for the Google Gemini generateContent API.
// It intentionally has no retry logic: quota protection is the top priority,
// so a failed request is never automatically retried.
type Client struct {
	apiKey         string
	model          string
	maxOutputTokens int
	timeout        time.Duration
	httpClient     *http.Client
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
		apiKey:          strings.TrimSpace(apiKey),
		model:           strings.TrimSpace(model),
		maxOutputTokens: maxOutputTokens,
		timeout:         timeout,
		httpClient:      &http.Client{Timeout: timeout},
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