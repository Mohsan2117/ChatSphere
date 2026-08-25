package http

import (
	"context"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/store"

	"github.com/gin-gonic/gin"
)

// geminiCaller is a small seam that lets the AI handler call the real Gemini
// client in production and a fake in tests, without any network access.
type geminiCaller interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// aiHandler guards the Gemini quota. The order of checks is critical:
//
//	Authentication -> validate message -> cooldown -> IP rate limit
//	-> daily user limit (atomic reserve) -> Gemini -> refund on failure
//
// No request reaches Gemini unless every local check passes first.
type aiHandler struct {
	cfg       config.Config
	dataStore *store.Store
	gemini    geminiCaller

	mu        sync.Mutex
	cooldowns map[string]time.Time
	ipRates   map[string][]time.Time
}

type aiMessage struct {
	Message string `json:"message"`
}

func newAIHandler(cfg config.Config, dataStore *store.Store, caller geminiCaller) *aiHandler {
	return &aiHandler{
		cfg:       cfg,
		dataStore: dataStore,
		gemini:    caller,
		cooldowns: make(map[string]time.Time),
		ipRates:   make(map[string][]time.Time),
	}
}

func (h *aiHandler) register(group *gin.RouterGroup) {
	group.POST("/chat", h.chat)
	group.GET("/messages", h.listMessages)
	group.DELETE("/messages", h.clearMessages)
}

// chat handles POST /api/v1/ai/chat.
func (h *aiHandler) chat(c *gin.Context) {
	start := time.Now()

	// 1. Authentication - reuses the existing ChatSphere auth middleware.
	auth, ok := requireUser(c)
	if !ok {
		return // requireUser already wrote 401 and aborted.
	}
	userID := auth.ID

	// 2. Validate message. Reject before any quota is consumed.
	body := &aiMessage{}
	if err := c.ShouldBindJSON(body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	message := strings.TrimSpace(body.Message)
	if message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
		return
	}
	// Count runes, not bytes, so multi-byte characters are not unfairly penalized.
	if len([]rune(message)) > h.cfg.GeminiMaxMessageLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is too long"})
		return
	}

	// 3. Per-user cooldown - blocks rapid repeated requests from the same user.
	if !h.allowCooldown(userID) {
		h.logRateLimit("cooldown", userID, http.StatusTooManyRequests, start)
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "you are sending requests too quickly. Please wait a moment."})
		return
	}

	// 4. Short-term IP rate limit - prevents spam.
	ip := clientIP(c)
	if !h.allowIP(ip) {
		h.logRateLimit("ip", userID, http.StatusTooManyRequests, start)
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many requests. Please try again later."})
		return
	}

	// 5. Daily per-user limit - atomic reserve so concurrent requests cannot
	//    bypass the quota. The user ID comes from the authenticated token,
	//    never from the request body.
	reserved, err := h.dataStore.ReserveAIUsage(userID, h.cfg.GeminiDailyLimit)
	if err != nil {
		log.Printf("[gemini] usage reserve failed user=%s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check AI usage"})
		return
	}
	if !reserved {
		// Do NOT call Gemini. The reservation is not consumed because the
		// reserve rejected the request.
		h.logRateLimit("daily", userID, http.StatusTooManyRequests, start)
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Daily AI limit reached. Please try again tomorrow."})
		return
	}

	// The reservation was successful. If Gemini fails, refund the reservation
	// so the user is only charged for requests that actually reached Gemini.
	response, callErr := h.gemini.Complete(c.Request.Context(), message)
	if callErr != nil {
		h.dataStore.DecrementAIUsage(userID)
		h.logGeminiError(userID, callErr, start)
		h.writeGeminiError(c, start)
		return
	}

	// Persist the conversation turn in the database.
	userMsg, _ := h.dataStore.SaveAIMessage("", userID, "user", message)
	aiMsg, _ := h.dataStore.SaveAIMessage("", userID, "assistant", response)

	log.Printf("[gemini] success user=%s status=200 latency_ms=%d", userID, time.Since(start).Milliseconds())
	c.JSON(http.StatusOK, gin.H{
		"response":    response,
		"userMessage": userMsg,
		"aiMessage":   aiMsg,
	})
}

// listMessages handles GET /api/v1/ai/messages.
func (h *aiHandler) listMessages(c *gin.Context) {
	auth, ok := requireUser(c)
	if !ok {
		return
	}
	messages, err := h.dataStore.ListAIMessages(auth.ID, 100)
	if err != nil {
		log.Printf("[gemini] list messages failed user=%s: %v", auth.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load AI messages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// clearMessages handles DELETE /api/v1/ai/messages.
func (h *aiHandler) clearMessages(c *gin.Context) {
	auth, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.dataStore.ClearAIMessages(auth.ID); err != nil {
		log.Printf("[gemini] clear messages failed user=%s: %v", auth.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear AI messages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "cleared"})
}

// allowCooldown returns true if the user is allowed to send another request
// now. It records the user's last request time on every successful pass.
func (h *aiHandler) allowCooldown(userID string) bool {
	since := time.Duration(h.cfg.GeminiRequestCooldownSeconds) * time.Second
	now := time.Now()

	h.mu.Lock()
	defer h.mu.Unlock()

	if last, ok := h.cooldowns[userID]; ok && now.Sub(last) < since {
		return false
	}
	h.cooldowns[userID] = now
	return true
}

// allowIP implements a sliding-window rate limit keyed by the real client IP.
// Old timestamps are pruned so the map cannot grow without bound.
func (h *aiHandler) allowIP(ip string) bool {
	if ip == "" || h.cfg.GeminiIPRateLimit <= 0 {
		return true
	}
	window := time.Minute
	limit := h.cfg.GeminiIPRateLimit
	now := time.Now()

	h.mu.Lock()
	defer h.mu.Unlock()

	timestamps := h.ipRates[ip]
	var kept []time.Time
	for _, ts := range timestamps {
		if now.Sub(ts) < window {
			kept = append(kept, ts)
		}
	}
	if len(kept) >= limit {
		h.ipRates[ip] = kept
		return false
	}
	h.ipRates[ip] = append(kept, now)
	return true
}

func (h *aiHandler) logRateLimit(kind, userID string, status int, start time.Time) {
	log.Printf("[gemini] rate_limit kind=%s user=%s status=%d latency_ms=%d", kind, userID, status, time.Since(start).Milliseconds())
}

func (h *aiHandler) logGeminiError(userID string, callErr error, start time.Time) {
	// The raw Gemini error may contain URL/status details but never the API
	// key (it is sent as a URL query parameter and errors are generic). To be
	// safe we only log the error string and never any request content.
	log.Printf("[gemini] error user=%s latency_ms=%d: %v", userID, time.Since(start).Milliseconds(), callErr)
}

// writeGeminiError maps a Gemini failure to a safe user-facing response. The
// raw Gemini error body and API key details are never exposed to users.
func (h *aiHandler) writeGeminiError(c *gin.Context, start time.Time) {
	c.JSON(http.StatusInternalServerError, gin.H{"error": "The AI assistant is temporarily unavailable. Please try again later."})
}

// clientIP returns the real client IP without blindly trusting arbitrary
// client-provided headers. Gin's ClientIP() already implements this: it only
// honors X-Forwarded-For when the peer is in the trusted proxy list and it
// always falls back to RemoteAddr. The trusted proxy list is configured from
// TRUSTED_PROXIES (Render sets X-Forwarded-For, so operators should set
// TRUSTED_PROXIES to the Render proxy IPs or leave it empty to trust none).
func clientIP(c *gin.Context) string {
	ip := strings.TrimSpace(c.ClientIP())
	if parsed := net.ParseIP(ip); parsed == nil {
		return ""
	}
	return ip
}
