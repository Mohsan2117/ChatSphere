package main

import (
	"log"
	"strings"

	"chatsphere/backend/internal/config"
	apphttp "chatsphere/backend/internal/http"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"
)

func main() {
	cfg := config.Load()
	logBrevoConfig(cfg)
	logGeminiConfig(cfg)

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	hub := realtime.NewHub()
	go hub.Run()

	router := apphttp.NewRouter(cfg, hub, dataStore)

	log.Printf("ChatSphere API listening on :%s", cfg.Port)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}

// logBrevoConfig prints the Brevo configuration at startup, masking the API key.
// This makes it easy to verify the correct environment variables are loaded
// without leaking secrets into logs.
func logBrevoConfig(cfg config.Config) {
	log.Printf("[brevo] startup config: BREVO_API_KEY present=%v BREVO_SENDER_EMAIL present=%v BREVO_SENDER_NAME=%q",
		cfg.BrevoAPIKey != "", cfg.BrevoSenderEmail != "", cfg.BrevoSenderName)

	if cfg.BrevoAPIKey == "" {
		log.Printf("[brevo] WARNING: BREVO_API_KEY is not set. Verification emails will not be sent.")
		return
	}
	log.Printf("[brevo] BREVO_API_KEY=%q", maskAPIKey(cfg.BrevoAPIKey))

	if cfg.BrevoSenderEmail == "" {
		log.Printf("[brevo] WARNING: BREVO_SENDER_EMAIL is not set. Verification emails will not be sent.")
		return
	}
	log.Printf("[brevo] BREVO_SENDER_EMAIL=%q", cfg.BrevoSenderEmail)
	log.Printf("[brevo] BREVO_SENDER_NAME=%q", cfg.BrevoSenderName)
}

// logGeminiConfig prints the Gemini configuration at startup without ever
// logging the API key or any user content. It only reports whether the key is
// present and the configured limits so operators can verify the environment.
func logGeminiConfig(cfg config.Config) {
	log.Printf("[gemini] startup config: GEMINI_API_KEY present=%v GEMINI_MODEL=%q GEMINI_DAILY_LIMIT=%d GEMINI_IP_RATE_LIMIT=%d GEMINI_REQUEST_COOLDOWN_SECONDS=%d GEMINI_MAX_MESSAGE_LENGTH=%d GEMINI_MAX_OUTPUT_TOKENS=%d GEMINI_TIMEOUT_SECONDS=%d",
		cfg.GeminiAPIKey != "", cfg.GeminiModel, cfg.GeminiDailyLimit, cfg.GeminiIPRateLimit, cfg.GeminiRequestCooldownSeconds, cfg.GeminiMaxMessageLength, cfg.GeminiMaxOutputTokens, cfg.GeminiTimeoutSeconds)

	if cfg.GeminiAPIKey == "" {
		log.Printf("[gemini] WARNING: GEMINI_API_KEY is not set. The AI assistant endpoint will return 503.")
	}
}

// maskAPIKey keeps only the first 8 and last 4 characters, e.g.
// "xkeysib-19cc...f86f7". If the key is shorter than 13 characters it is
// fully masked to avoid leaking a partial secret.
func maskAPIKey(key string) string {
	trimmed := strings.TrimSpace(key)
	if len(trimmed) <= 12 {
		return "******"
	}
	return trimmed[:8] + "..." + trimmed[len(trimmed)-4:]
}
