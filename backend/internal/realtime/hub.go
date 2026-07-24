package realtime

import "encoding/json"

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
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Event, 256),
	}
}

func (h *Hub) Broadcast(event Event) {
	h.broadcast <- event
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
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
