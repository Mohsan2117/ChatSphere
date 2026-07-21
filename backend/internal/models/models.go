package models

import "time"

type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	Bio       string    `json:"bio,omitempty"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderID       string    `json:"senderId"`
	Body           string    `json:"body"`
	Type           string    `json:"type"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Group struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type Notification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}
