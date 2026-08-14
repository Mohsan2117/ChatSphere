package realtime

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"chatsphere/backend/internal/store"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 8192
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan Event
	userID string
	store  *store.Store
}

func Serve(w http.ResponseWriter, r *http.Request, hub *Hub, userID string, store *store.Store) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}

	client := &Client{hub: hub, conn: conn, send: make(chan Event, 256), userID: userID, store: store}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var event Event
		if err := c.conn.ReadJSON(&event); err != nil {
			break
		}

		// Process call signaling events
		switch event.Type {
		case "call_offer", "call_answer", "call_ice_candidate", "call_reject", "call_end", "call_camera_toggle", "call_join":
			var callPayload struct {
				CallID   string `json:"callId"`
				IsInvite bool   `json:"isInvite"`
			}
			if err := json.Unmarshal(event.Payload, &callPayload); err != nil || callPayload.CallID == "" {
				continue
			}
			callID := callPayload.CallID

			// Force sender ID to the authenticated user ID
			event.UserID = c.userID

			if event.Type == "call_offer" && !callPayload.IsInvite {
				// This can be the initial call setup, or WebRTC connection offer between peers.
				session, exists := c.hub.GetCall(callID)
				if !exists {
					// Initial call creation (1-to-1)
					if len(event.TargetUserIDs) != 1 {
						continue
					}
					recipientID := event.TargetUserIDs[0]

					if recipientID == c.userID {
						continue // Can't call yourself
					}

					if c.store != nil {
						_, err := c.store.UserByID(recipientID)
						if err != nil {
							continue // Recipient must exist
						}
						if c.store.IsBlockedBetween(c.userID, recipientID) {
							continue // Cannot call if blocked
						}
					}

					if c.hub.IsUserInAnyCall(recipientID) {
						c.hub.Broadcast(Event{
							Type:          "call_reject",
							UserID:        recipientID,
							TargetUserIDs: []string{c.userID},
							Payload: mustJSON(map[string]string{
								"callId": callID,
								"reason": "busy",
							}),
						})
						continue
					}

					c.hub.AddCall(callID, c.userID, recipientID)
					c.hub.Broadcast(event)
				} else {
					// WebRTC connection offer between active participants in an ongoing call.
					if _, ok := session.Participants[c.userID]; !ok {
						continue
					}
					if len(event.TargetUserIDs) != 1 {
						continue
					}
					targetID := event.TargetUserIDs[0]
					if targetID == c.userID {
						continue
					}
					if _, ok := session.Participants[targetID]; !ok {
						continue
					}
					c.hub.Broadcast(event)
				}

			} else if event.Type == "call_offer" && callPayload.IsInvite {
				// Invitation to an existing call session.
				session, exists := c.hub.GetCall(callID)
				if !exists {
					continue
				}

				// Validate sender is a participant
				if _, ok := session.Participants[c.userID]; !ok {
					continue
				}

				if len(event.TargetUserIDs) != 1 {
					continue
				}
				recipientID := event.TargetUserIDs[0]
				if recipientID == c.userID {
					continue
				}

				if _, active := session.Participants[recipientID]; active {
					continue // Already in call
				}

				if c.hub.IsUserInAnyCall(recipientID) {
					c.hub.Broadcast(Event{
						Type:          "call_reject",
						UserID:        recipientID,
						TargetUserIDs: []string{c.userID},
						Payload: mustJSON(map[string]string{
							"callId": callID,
							"reason": "busy",
						}),
					})
					continue
				}

				// Capacity Check
				if len(session.Participants) >= 4 {
					c.hub.Broadcast(Event{
						Type:          "call_full",
						UserID:        c.userID,
						TargetUserIDs: []string{c.userID},
						Payload: mustJSON(map[string]string{
							"callId": callID,
							"userId": recipientID,
						}),
					})
					continue
				}

				// Block Checks
				if c.store != nil {
					_, err := c.store.UserByID(recipientID)
					if err != nil {
						continue // Recipient must exist
					}
					blocked := false
					for activePeer := range session.Participants {
						if c.store.IsBlockedBetween(activePeer, recipientID) {
							blocked = true
							break
						}
					}
					if blocked {
						// Send reject message to the sender (inviter) to notify them
						c.hub.Broadcast(Event{
							Type:          "call_reject",
							UserID:        recipientID,
							TargetUserIDs: []string{c.userID},
							Payload: mustJSON(map[string]string{
								"callId": callID,
								"reason": "blocked",
							}),
						})
						continue
					}
				}

				// Add the invited user with active = false to authorize their join
				c.hub.InviteToCall(callID, recipientID)

				// Forward invitation to the recipient
				c.hub.Broadcast(event)

			} else if event.Type == "call_join" {
				session, exists := c.hub.GetCall(callID)
				if !exists {
					// Call session no longer exists. Notify the client to clean up.
					c.hub.Broadcast(Event{
						Type:          "call_end",
						UserID:        c.userID,
						TargetUserIDs: []string{c.userID},
						Payload:       mustJSON(map[string]string{"callId": callID}),
					})
					continue
				}

				// Verify that the user is authorized to join (either host, recipient, or invited)
				if _, ok := session.Participants[c.userID]; !ok {
					continue // Unauthorized join attempt!
				}

				// Capacity Check
				if len(session.Participants) >= 4 {
					c.hub.Broadcast(Event{
						Type:          "call_full",
						UserID:        c.userID,
						TargetUserIDs: []string{c.userID},
						Payload: mustJSON(map[string]string{
							"callId": callID,
							"userId": c.userID,
						}),
					})
					continue
				}

				// Block Checks against all active participants
				if c.store != nil {
					blocked := false
					for activePeer := range session.Participants {
						if c.store.IsBlockedBetween(activePeer, c.userID) {
							blocked = true
							break
						}
					}
					if blocked {
						continue
					}
				}

				// Add to participants list
				if c.hub.JoinCall(callID, c.userID) {
					// Broadcast join notification to other participants
					var targets []string
					for peerID := range session.Participants {
						if peerID != c.userID {
							targets = append(targets, peerID)
						}
					}
					c.hub.Broadcast(Event{
						Type:          "call_participant_joined",
						UserID:        c.userID,
						TargetUserIDs: targets,
						Payload: mustJSON(map[string]string{
							"callId": callID,
							"userId": c.userID,
						}),
					})
				}

			} else if event.Type == "call_reject" {
				// Rejection of an invite/call
				session, exists := c.hub.GetCall(callID)
				if !exists {
					continue
				}

				if len(event.TargetUserIDs) != 1 {
					continue
				}
				targetID := event.TargetUserIDs[0]
				if _, ok := session.Participants[targetID]; !ok {
					continue
				}

				// Forward reject to target
				c.hub.Broadcast(event)

				// If the rejecting user was already an active participant, clean them up
				if _, isActive := session.Participants[c.userID]; isActive {
					events, _ := c.hub.LeaveCall(callID, c.userID)
					for _, ev := range events {
						c.hub.Broadcast(ev)
					}
				}

			} else if event.Type == "call_end" {
				// User hangs up/leaves call
				events, _ := c.hub.LeaveCall(callID, c.userID)
				for _, ev := range events {
					c.hub.Broadcast(ev)
				}

			} else {
				// Other signaling events: call_answer, call_ice_candidate, call_camera_toggle
				session, exists := c.hub.GetCall(callID)
				if !exists {
					continue
				}

				// Verify sender is in call
				if _, ok := session.Participants[c.userID]; !ok {
					continue
				}

				// Verify target is in call and is not sender
				if len(event.TargetUserIDs) != 1 {
					continue
				}
				targetID := event.TargetUserIDs[0]
				if targetID == c.userID {
					continue
				}
				if _, ok := session.Participants[targetID]; !ok {
					continue
				}

				c.hub.Broadcast(event)
			}
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case event, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(event); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
