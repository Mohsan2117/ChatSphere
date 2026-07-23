package main

import (
	"log"

	"chatsphere/backend/internal/config"
	apphttp "chatsphere/backend/internal/http"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"
)

func main() {
	cfg := config.Load()
	dataStore, err := store.New(cfg.DataPath)
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
