package realtime

import (
	"encoding/json"
	"sync"
)

type Event struct {
	Type           string          `json:"type"`
	ConversationID string          `json:"conversationId,omitempty"`
	UserID         string          `json:"userId,omitempty"`
	TargetUserIDs  []string        `json:"targetUserIds,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
}

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan Event
	mu         sync.RWMutex
	online     map[string]int
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Event, 256),
		online:     make(map[string]int),
	}
}

func (h *Hub) Broadcast(event Event) {
	h.broadcast <- event
}

func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.online[userID] > 0
}

func (h *Hub) OnlineUserIDs() map[string]bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	online := make(map[string]bool, len(h.online))
	for userID, count := range h.online {
		if count > 0 {
			online[userID] = true
		}
	}
	return online
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.mu.Lock()
			h.online[client.userID]++
			h.mu.Unlock()
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.mu.Lock()
				h.online[client.userID]--
				if h.online[client.userID] <= 0 {
					delete(h.online, client.userID)
				}
				h.mu.Unlock()
			}
		case event := <-h.broadcast:
			for client := range h.clients {
				if len(event.TargetUserIDs) > 0 && !eventTargetsClient(event.TargetUserIDs, client.userID) {
					continue
				}
				select {
				case client.send <- event:
				default:
					delete(h.clients, client)
					close(client.send)
				}
			}
		}
	}
}

func eventTargetsClient(targets []string, userID string) bool {
	for _, target := range targets {
		if target == userID {
			return true
		}
	}
	return false
}
