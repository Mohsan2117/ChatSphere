package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port             string
	AppEnv           string
	FrontendOrigin   string
	JWTSecret        string
	MySQLDSN         string
	MongoURI         string
	DatabaseURL      string
	SupabaseURL      string
	SupabaseKey      string
	BrevoAPIKey      string
	BrevoSenderEmail string
	BrevoSenderName  string
	AdminEmail       string
	AdminPassword    string
	AuthTokenHours   string
	DataPath         string

	GeminiAPIKey                   string
	GeminiModel                    string
	GeminiDailyLimit               int
	GeminiIPRateLimit              int
	GeminiRequestCooldownSeconds   int
	GeminiMaxMessageLength         int
	GeminiMaxOutputTokens          int
	GeminiTimeoutSeconds           int
	TrustedProxies                 string

	CloudinaryCloudName    string
	CloudinaryAPIKey       string
	CloudinaryAPISecret    string
	CloudinaryUploadPreset string
}

func Load() Config {
	loadDotEnv(".env")

	return Config{
		Port:             env("PORT", "8080"),
		AppEnv:           env("APP_ENV", "development"),
		FrontendOrigin:   env("FRONTEND_ORIGIN", "http://localhost:3000"),
		JWTSecret:        env("JWT_SECRET", "dev-only-secret"),
		MySQLDSN:         os.Getenv("MYSQL_DSN"),
		MongoURI:         os.Getenv("MONGO_URI"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		SupabaseURL:      os.Getenv("SUPABASE_URL"),
		SupabaseKey:      os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		BrevoAPIKey:      os.Getenv("BREVO_API_KEY"),
		BrevoSenderEmail: os.Getenv("BREVO_SENDER_EMAIL"),
		BrevoSenderName:  env("BREVO_SENDER_NAME", "ChatSphere"),
		AdminEmail:       env("ADMIN_EMAIL", "ChatSphere@gmail.com"),
		AdminPassword:    env("ADMIN_PASSWORD", "1234123"),
		AuthTokenHours:   env("AUTH_TOKEN_TTL_HOURS", "168"),
		DataPath:         env("DATA_PATH", "data/chatsphere.json"),

		GeminiAPIKey:                   os.Getenv("GEMINI_API_KEY"),
		GeminiModel:                    env("GEMINI_MODEL", "gemini-2.0-flash"),
		GeminiDailyLimit:               envInt("GEMINI_DAILY_LIMIT", 20),
		GeminiIPRateLimit:              envInt("GEMINI_IP_RATE_LIMIT", 5),
		GeminiRequestCooldownSeconds:   envInt("GEMINI_REQUEST_COOLDOWN_SECONDS", 2),
		GeminiMaxMessageLength:         envInt("GEMINI_MAX_MESSAGE_LENGTH", 2000),
		GeminiMaxOutputTokens:          envInt("GEMINI_MAX_OUTPUT_TOKENS", 500),
		GeminiTimeoutSeconds:           envInt("GEMINI_TIMEOUT_SECONDS", 30),
		TrustedProxies:                 os.Getenv("TRUSTED_PROXIES"),

		CloudinaryCloudName:    os.Getenv("CLOUDINARY_CLOUD_NAME"),
		CloudinaryAPIKey:       os.Getenv("CLOUDINARY_API_KEY"),
		CloudinaryAPISecret:    os.Getenv("CLOUDINARY_API_SECRET"),
		CloudinaryUploadPreset: os.Getenv("CLOUDINARY_UPLOAD_PRESET"),
	}
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func loadDotEnv(path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}

func env(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
