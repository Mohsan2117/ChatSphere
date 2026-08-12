package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"chatsphere/backend/internal/config"

	"github.com/jackc/pgx/v5"
)

func main() {
	cfg := config.Load()

	dbURL := strings.TrimSpace(cfg.DatabaseURL)
	if dbURL == "" {
		log.Println("Keepalive database check failed: DATABASE_URL environment variable is empty or not configured")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	connConfig, err := pgx.ParseConfig(dbURL)
	if err != nil {
		log.Printf("Keepalive database check failed: could not parse PostgreSQL configuration: %v", err)
		os.Exit(1)
	}
	connConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	conn, err := pgx.ConnectConfig(ctx, connConfig)
	if err != nil {
		log.Printf("Keepalive database check failed: could not connect to PostgreSQL: %v", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())

	var result int
	err = conn.QueryRow(ctx, "SELECT 1").Scan(&result)
	if err != nil {
		log.Printf("Keepalive database check failed: PostgreSQL query execution error: %v", err)
		os.Exit(1)
	}

	log.Println("Keepalive database check successful")
	os.Exit(0)
}
