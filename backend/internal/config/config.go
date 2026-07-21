package config

import "os"

type Config struct {
	Port           string
	AppEnv         string
	FrontendOrigin string
	JWTSecret      string
	MySQLDSN       string
	MongoURI       string
	SupabaseURL    string
	SupabaseKey    string
	BrevoAPIKey    string
	BrevoSenderEmail string
	BrevoSenderName  string
}

func Load() Config {
	return Config{
		Port:           env("PORT", "8080"),
		AppEnv:         env("APP_ENV", "development"),
		FrontendOrigin: env("FRONTEND_ORIGIN", "http://localhost:3000"),
		JWTSecret:      env("JWT_SECRET", "dev-only-secret"),
		MySQLDSN:       os.Getenv("MYSQL_DSN"),
		MongoURI:       os.Getenv("MONGO_URI"),
		SupabaseURL:    os.Getenv("SUPABASE_URL"),
		SupabaseKey:    os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		BrevoAPIKey:    os.Getenv("BREVO_API_KEY"),
		BrevoSenderEmail: os.Getenv("BREVO_SENDER_EMAIL"),
		BrevoSenderName:  env("BREVO_SENDER_NAME", "ChatSphere"),
	}
}

func env(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
