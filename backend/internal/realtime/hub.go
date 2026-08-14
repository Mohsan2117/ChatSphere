package realtime

import (
	"encoding/json"
	"sync"
	"time"
)

type Event struct {
	Type           string          `json:"type"`
	ConversationID string          `json:"conversationId,omitempty"`
	UserID         string          `json:"userId,omitempty"`
	TargetUserIDs  []string        `json:"targetUserIds,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
}

type CallSession struct {
	CallID       string
	HostID       string
	Participants map[string]bool // userID -> active status
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
				if onlineCount <= 0 {
					delete(h.online, client.userID)
				}
				h.mu.Unlock()

				// Defer call cleanup and offline presence update to tolerate transient reconnects
				go func(uid string) {
					time.Sleep(15 * time.Second)
					h.mu.Lock()
					defer h.mu.Unlock()
					if h.online[uid] <= 0 {
						events := h.removeCallsForUserLocked(uid)
						h.dispatch(Event{
							Type:   "presence.updated",
							UserID: uid,
							Payload: mustJSON(map[string]any{
								"userId": uid,
								"online": false,
							}),
						})
						for _, ev := range events {
							h.dispatch(ev)
						}
					}
				}(client.userID)
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

func (h *Hub) removeCallsForUserLocked(userID string) []Event {
	if h.calls == nil {
		return nil
	}
	var events []Event
	for callID, session := range h.calls {
		if _, ok := session.Participants[userID]; ok {
			delete(session.Participants, userID)

			if session.HostID == userID {
				for peerID := range session.Participants {
					session.HostID = peerID
					break
				}
			}

			if len(session.Participants) < 2 {
				var lastParticipant string
				for peerID := range session.Participants {
					lastParticipant = peerID
				}
				delete(h.calls, callID)

				if lastParticipant != "" {
					events = append(events, Event{
						Type:          "call_end",
						UserID:        userID,
						TargetUserIDs: []string{lastParticipant},
						Payload:       mustJSON(map[string]string{"callId": callID}),
					})
				}
			} else {
				var remaining []string
				for peerID := range session.Participants {
					remaining = append(remaining, peerID)
				}
				events = append(events, Event{
					Type:          "call_participant_left",
					UserID:        userID,
					TargetUserIDs: remaining,
					Payload: mustJSON(map[string]string{
						"callId": callID,
						"userId": userID,
					}),
				})
			}
		}
	}
	return events
}

func (h *Hub) AddCall(callID, hostID, recipientID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.calls == nil {
		h.calls = make(map[string]CallSession)
	}
	h.calls[callID] = CallSession{
		CallID: callID,
		HostID: hostID,
		Participants: map[string]bool{
			hostID:      true,
			recipientID: true,
		},
	}
}

func (h *Hub) JoinCall(callID, userID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	session, ok := h.calls[callID]
	if !ok {
		return false
	}
	if len(session.Participants) >= 4 {
		return false
	}
	session.Participants[userID] = true
	h.calls[callID] = session
	return true
}

func (h *Hub) LeaveCall(callID, userID string) ([]Event, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	session, ok := h.calls[callID]
	if !ok {
		return nil, false
	}

	if _, ok := session.Participants[userID]; !ok {
		return nil, false
	}

	delete(session.Participants, userID)

	if session.HostID == userID {
		for peerID := range session.Participants {
			session.HostID = peerID
			break
		}
	}

	if len(session.Participants) < 2 {
		var lastParticipant string
		for peerID := range session.Participants {
			lastParticipant = peerID
		}
		delete(h.calls, callID)

		if lastParticipant != "" {
			return []Event{
				{
					Type:          "call_end",
					UserID:        userID,
					TargetUserIDs: []string{lastParticipant},
					Payload:       mustJSON(map[string]string{"callId": callID}),
				},
			}, true
		}
		return nil, true
	}

	h.calls[callID] = session

	var remaining []string
	for peerID := range session.Participants {
		remaining = append(remaining, peerID)
	}

	return []Event{
		{
			Type:          "call_participant_left",
			UserID:        userID,
			TargetUserIDs: remaining,
			Payload: mustJSON(map[string]string{
				"callId": callID,
				"userId": userID,
			}),
		},
	}, false
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
