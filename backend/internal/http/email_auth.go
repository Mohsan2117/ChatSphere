package http

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
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
		cfg:   cfg,
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
		"to":          []map[string]string{{"email": email}},
		"subject":     "Your ChatSphere verification code",
		"htmlContent": verificationEmailHTML(code),
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
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		var brevoError struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal(body, &brevoError); err == nil && brevoError.Message != "" {
			return fmt.Errorf(brevoError.Message)
		}
		return fmt.Errorf("brevo rejected the email request")
	}

	return nil
}

func verificationEmailHTML(code string) string {
	return fmt.Sprintf(`<!doctype html>
<html>
  <body style="margin:0;background:#07130f;color:#f4fbf7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#07130f;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111b21;border:1px solid rgba(255,255,255,.10);border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.32);">
            <tr>
              <td style="background:#0b141a;padding:26px 24px 18px;border-bottom:1px solid rgba(255,255,255,.08);">
                <div style="display:inline-block;background:#00a884;color:#06130f;border-radius:12px;padding:10px 13px;font-size:22px;font-weight:900;">CS</div>
                <div style="margin-top:18px;font-size:26px;line-height:1.2;font-weight:900;color:#ffffff;">ChatSphere</div>
                <div style="margin-top:7px;font-size:14px;line-height:1.6;color:#aebac1;">Secure email verification</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 30px;">
                <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;color:#ffffff;">Your login code</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#c9d4d9;">Use this one-time code to continue signing in to ChatSphere.</p>
                <div style="background:#0b141a;border:1px solid rgba(0,168,132,.45);border-radius:18px;padding:20px 12px;text-align:center;">
                  <div style="font-size:36px;line-height:1.15;letter-spacing:10px;font-weight:900;color:#ffffff;">%s</div>
                </div>
                <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#aebac1;">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#0b141a;padding:16px 24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.6;color:#7f9199;">
                Sent by ChatSphere authentication.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`, code)
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
