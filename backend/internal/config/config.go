package config

import (
	"os"
	"strings"
)

type Config struct {
	Port           string
	AppEnv         string
	FrontendOrigin string
	JWTSecret      string
	MySQLDSN       string
	MongoURI       string
	DatabaseURL    string
	SupabaseURL    string
	SupabaseKey    string
	BrevoAPIKey    string
	BrevoSenderEmail string
	BrevoSenderName  string
	DataPath       string
}

func Load() Config {
	loadDotEnv(".env")

	return Config{
		Port:           env("PORT", "8080"),
		AppEnv:         env("APP_ENV", "development"),
		FrontendOrigin: env("FRONTEND_ORIGIN", "http://localhost:3000"),
		JWTSecret:      env("JWT_SECRET", "dev-only-secret"),
		MySQLDSN:       os.Getenv("MYSQL_DSN"),
		MongoURI:       os.Getenv("MONGO_URI"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		SupabaseURL:    os.Getenv("SUPABASE_URL"),
		SupabaseKey:    os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		BrevoAPIKey:    os.Getenv("BREVO_API_KEY"),
		BrevoSenderEmail: os.Getenv("BREVO_SENDER_EMAIL"),
		BrevoSenderName:  env("BREVO_SENDER_NAME", "ChatSphere"),
		DataPath:       env("DATA_PATH", "data/chatsphere.json"),
	}
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
