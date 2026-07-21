package http

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"chatsphere/backend/internal/config"

	"github.com/gin-gonic/gin"
)

type emailCodeStore struct {
	mu    sync.Mutex
	codes map[string]emailCode
}

type emailCode struct {
	Code      string
	ExpiresAt time.Time
}

type emailAuthHandler struct {
	cfg   config.Config
	store *emailCodeStore
}

func newEmailAuthHandler(cfg config.Config) *emailAuthHandler {
	return &emailAuthHandler{
		cfg: cfg,
		store: &emailCodeStore{codes: make(map[string]emailCode)},
	}
}

func (h *emailAuthHandler) register(group *gin.RouterGroup) {
	group.POST("/email/request-code", h.requestCode)
	group.POST("/email/verify-code", h.verifyCode)
}

func (h *emailAuthHandler) requestCode(c *gin.Context) {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	email := normalizeEmail(body.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid email"})
		return
	}

	code, err := randomCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create code"})
		return
	}

	h.store.mu.Lock()
	h.store.codes[email] = emailCode{Code: code, ExpiresAt: time.Now().Add(10 * time.Minute)}
	h.store.mu.Unlock()

	if err := h.sendBrevoCode(email, code); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "sent", "email": email})
}

func (h *emailAuthHandler) verifyCode(c *gin.Context) {
	var body struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	email := normalizeEmail(body.Email)
	code := strings.TrimSpace(body.Code)

	h.store.mu.Lock()
	stored, ok := h.store.codes[email]
	if ok && stored.Code == code && time.Now().Before(stored.ExpiresAt) {
		delete(h.store.codes, email)
	}
	h.store.mu.Unlock()

	if !ok || stored.Code != code || time.Now().After(stored.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "verified",
		"user": gin.H{
			"email": email,
		},
	})
}

func (h *emailAuthHandler) sendBrevoCode(email string, code string) error {
	if h.cfg.BrevoAPIKey == "" || h.cfg.BrevoSenderEmail == "" {
		return fmt.Errorf("email sending is not configured")
	}

	payload := map[string]any{
		"sender": map[string]string{
			"name":  h.cfg.BrevoSenderName,
			"email": h.cfg.BrevoSenderEmail,
		},
		"to": []map[string]string{{"email": email}},
		"subject": "Your ChatSphere verification code",
		"htmlContent": fmt.Sprintf(
			`<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>ChatSphere verification</h2><p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">%s</p><p>This code expires in 10 minutes.</p></div>`,
			code,
		),
		"textContent": fmt.Sprintf("Your ChatSphere verification code is %s. This code expires in 10 minutes.", code),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.brevo.com/v3/smtp/email", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("accept", "application/json")
	req.Header.Set("api-key", h.cfg.BrevoAPIKey)
	req.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("could not send email")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("brevo rejected the email request")
	}

	return nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func randomCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
