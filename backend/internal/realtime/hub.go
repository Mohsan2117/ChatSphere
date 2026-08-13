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

type CallSession struct {
	CallerID   string
	ReceiverID string
}

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan Event
	mu         sync.RWMutex
	online     map[string]int
	calls      map[string]CallSession // callId -> CallSession
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Event, 256),
		online:     make(map[string]int),
		calls:      make(map[string]CallSession),
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
			onlineCount := h.online[client.userID]
			h.mu.Unlock()
			if onlineCount == 1 {
				h.dispatch(Event{
					Type:   "presence.updated",
					UserID: client.userID,
					Payload: mustJSON(map[string]any{
						"userId": client.userID,
						"online": true,
					}),
				})
			}
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.mu.Lock()
				h.online[client.userID]--
				onlineCount := h.online[client.userID]
				var removedCalls []removedCall
				if onlineCount <= 0 {
					delete(h.online, client.userID)
					removedCalls = h.removeCallsForUserLocked(client.userID)
				}
				h.mu.Unlock()
				if onlineCount <= 0 {
					h.dispatch(Event{
						Type:   "presence.updated",
						UserID: client.userID,
						Payload: mustJSON(map[string]any{
							"userId": client.userID,
							"online": false,
						}),
					})
				}
				for _, cInfo := range removedCalls {
					var target string
					if cInfo.Session.CallerID == client.userID {
						target = cInfo.Session.ReceiverID
					} else {
						target = cInfo.Session.CallerID
					}
					h.dispatch(Event{
						Type:          "call_end",
						UserID:        client.userID,
						TargetUserIDs: []string{target},
						Payload:       mustJSON(map[string]string{"callId": cInfo.CallID}),
					})
				}
			}
		case event := <-h.broadcast:
			h.dispatch(event)
		}
	}
}

func (h *Hub) dispatch(event Event) {
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

func mustJSON(value any) json.RawMessage {
	content, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return content
}

func eventTargetsClient(targets []string, userID string) bool {
	for _, target := range targets {
		if target == userID {
			return true
		}
	}
	return false
}

type removedCall struct {
	CallID  string
	Session CallSession
}

func (h *Hub) removeCallsForUserLocked(userID string) []removedCall {
	if h.calls == nil {
		return nil
	}
	var removed []removedCall
	for callID, session := range h.calls {
		if session.CallerID == userID || session.ReceiverID == userID {
			removed = append(removed, removedCall{CallID: callID, Session: session})
			delete(h.calls, callID)
		}
	}
	return removed
}

func (h *Hub) AddCall(callID, callerID, receiverID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.calls == nil {
		h.calls = make(map[string]CallSession)
	}
	h.calls[callID] = CallSession{
		CallerID:   callerID,
		ReceiverID: receiverID,
	}
}

func (h *Hub) GetCall(callID string) (CallSession, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.calls == nil {
		return CallSession{}, false
	}
	session, ok := h.calls[callID]
	return session, ok
}

func (h *Hub) RemoveCall(callID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.calls != nil {
		delete(h.calls, callID)
	}
}
