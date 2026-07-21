package main

import (
	"log"

	"chatsphere/backend/internal/config"
	apphttp "chatsphere/backend/internal/http"
	"chatsphere/backend/internal/realtime"
)

func main() {
	cfg := config.Load()
	hub := realtime.NewHub()
	go hub.Run()

	router := apphttp.NewRouter(cfg, hub)

	log.Printf("ChatSphere API listening on :%s", cfg.Port)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
