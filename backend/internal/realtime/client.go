package realtime

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
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
		case "message_send":
			var msgPayload struct {
				ClientMessageID string `json:"client_message_id"`
				RecipientID     string `json:"recipientId"`
				Body            string `json:"body"`
				Attachment      struct {
					Name string `json:"name"`
					Type string `json:"type"`
					Kind string `json:"kind"`
					URL  string `json:"url"`
				} `json:"attachment"`
			}
			if err := json.Unmarshal(event.Payload, &msgPayload); err != nil {
				continue
			}
			if strings.TrimSpace(msgPayload.RecipientID) == "" {
				continue
			}
			if strings.TrimSpace(msgPayload.Body) == "" && strings.TrimSpace(msgPayload.Attachment.Name) == "" {
				continue
			}
			sender, err := c.store.UserByID(c.userID)
			if err != nil {
				continue
			}
			// Check if message with this client_message_id already exists to prevent duplicate (idempotency check)
			if msgPayload.ClientMessageID != "" {
				if existingMsg, err := c.store.MessageByID(msgPayload.ClientMessageID); err == nil {
					ackPayload, _ := json.Marshal(map[string]any{
						"client_message_id": msgPayload.ClientMessageID,
						"message_id":        existingMsg.ID,
						"status":            "sent",
					})
					c.send <- Event{
						Type:    "message_sent",
						Payload: ackPayload,
					}
					continue
				}
			}
			message, err := c.store.SaveMessage(
				msgPayload.ClientMessageID,
				sender.Email,
				msgPayload.RecipientID,
				msgPayload.Body,
				msgPayload.Attachment.Name,
				msgPayload.Attachment.Type,
				msgPayload.Attachment.Kind,
				msgPayload.Attachment.URL,
			)
			if err != nil {
				errPayload, _ := json.Marshal(map[string]any{
					"client_message_id": msgPayload.ClientMessageID,
					"error":             err.Error(),
					"status":            "failed",
				})
				c.send <- Event{
					Type:    "message_sent",
					Payload: errPayload,
				}
				continue
			}
			if payload, err := json.Marshal(mapPublicMessage(message, "")); err == nil {
				c.hub.Broadcast(Event{
					Type:           "chat.message",
					ConversationID: message.ConversationID,
					TargetUserIDs:  []string{message.SenderID, message.RecipientID},
					Payload:        payload,
				})
			}
			ackPayload, _ := json.Marshal(map[string]any{
				"client_message_id": msgPayload.ClientMessageID,
				"message_id":        message.ID,
				"status":            "sent",
			})
			c.send <- Event{
				Type:    "message_sent",
				Payload: ackPayload,
			}
		case "group_message_send":
			var msgPayload struct {
				ClientMessageID string `json:"client_message_id"`
				GroupID         string `json:"groupId"`
				Body            string `json:"body"`
				Attachment      struct {
					Name string `json:"name"`
					Type string `json:"type"`
					Kind string `json:"kind"`
					URL  string `json:"url"`
				} `json:"attachment"`
			}
			if err := json.Unmarshal(event.Payload, &msgPayload); err != nil || strings.TrimSpace(msgPayload.GroupID) == "" {
				continue
			}
			message, err := c.store.SaveGroupMessage(msgPayload.ClientMessageID, msgPayload.GroupID, c.userID, msgPayload.Body, msgPayload.Attachment.Name, msgPayload.Attachment.Type, msgPayload.Attachment.Kind, msgPayload.Attachment.URL)
			if err != nil {
				errPayload, _ := json.Marshal(map[string]any{"client_message_id": msgPayload.ClientMessageID, "error": err.Error(), "status": "failed"})
				c.send <- Event{Type: "group_message_sent", Payload: errPayload}
				continue
			}
			details, err := c.store.GetGroupDetails(msgPayload.GroupID, c.userID)
			if err != nil {
				continue
			}
			targets := make([]string, 0, len(details.Members))
			for _, member := range details.Members {
				targets = append(targets, member.UserID)
			}
			if payload, marshalErr := json.Marshal(mapPublicGroupMessage(message)); marshalErr == nil {
				c.hub.Broadcast(Event{Type: "group.message", ConversationID: message.GroupID, UserID: c.userID, TargetUserIDs: targets, Payload: payload})
			}
			ackPayload, _ := json.Marshal(map[string]any{"client_message_id": msgPayload.ClientMessageID, "message_id": message.ID, "status": "sent"})
			c.send <- Event{Type: "group_message_sent", Payload: ackPayload}
		case "call_offer", "call_answer", "call_ice_candidate", "call_reject", "call_end", "call_camera_toggle", "call_join":
			var callPayload struct {
				CallID   string `json:"callId"`
				IsInvite bool   `json:"isInvite"`
				CallType string `json:"callType"`
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

					if c.store != nil {
						go func() {
							ct := callPayload.CallType
							if ct == "" {
								ct = "audio"
							}
							_ = c.store.CreateCallHistory(callID, c.userID, recipientID, ct)
						}()
					}
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
				if c.store != nil {
					go func(cid, rejectingUserID, targetUserID string) {
						history, err := c.store.GetCallHistoryByID(cid)
						if err != nil {
							return
						}
						isInitialPair := (history.CallerID == rejectingUserID && history.RecipientID == targetUserID) ||
							(history.CallerID == targetUserID && history.RecipientID == rejectingUserID)
						if isInitialPair && history.Status == "ringing" {
							_ = c.store.UpdateCallHistoryStatus(cid, "rejected")
						}
					}(callID, c.userID, targetID)
				}

				// If the rejecting user was already an active participant, clean them up
				if _, isActive := session.Participants[c.userID]; isActive {
					events, _ := c.hub.LeaveCall(callID, c.userID)
					for _, ev := range events {
						c.hub.Broadcast(ev)
					}
				}

			} else if event.Type == "call_end" {
				// User hangs up/leaves call
				events, callEnded := c.hub.LeaveCall(callID, c.userID)
				for _, ev := range events {
					c.hub.Broadcast(ev)
				}
				if c.store != nil && callEnded {
					go func(cid string) {
						history, err := c.store.GetCallHistoryByID(cid)
						if err == nil {
							if history.Status == "ringing" {
								_ = c.store.UpdateCallHistoryStatus(cid, "missed")
							} else if history.Status == "answered" {
								_ = c.store.UpdateCallHistoryStatus(cid, "ended")
							}
						}
					}(callID)
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
				if event.Type == "call_answer" && c.store != nil {
					_ = c.store.UpdateCallHistoryStatus(callID, "answered")
				}
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

func mapPublicMessage(message store.Message, viewerEmail string) map[string]any {
	result := map[string]any{
		"id":          message.ID,
		"body":        message.Body,
		"time":        message.CreatedAt.Format("3:04 PM"),
		"mine":        strings.EqualFold(message.SenderEmail, viewerEmail),
		"senderEmail": message.SenderEmail,
		"senderId":    message.SenderID,
		"recipientId": message.RecipientID,
		"createdAt":   message.CreatedAt,
		"readAt":      message.ReadAt,
	}
	if message.AttachmentName != "" {
		result["attachment"] = map[string]any{
			"name": message.AttachmentName,
			"type": message.AttachmentType,
			"kind": message.AttachmentKind,
			"url":  message.AttachmentURL,
		}
	}
	return result
}

func mapPublicGroupMessage(message store.GroupMessage) map[string]any {
	result := map[string]any{
		"id": message.ID, "groupId": message.GroupID, "senderId": message.SenderID,
		"senderEmail": message.SenderEmail, "body": message.Body, "createdAt": message.CreatedAt,
		"time": message.CreatedAt.Format("3:04 PM"),
	}
	if message.AttachmentName != "" {
		result["attachment"] = map[string]string{"name": message.AttachmentName, "type": message.AttachmentType, "kind": message.AttachmentKind, "url": message.AttachmentURL}
	}
	return result
}
