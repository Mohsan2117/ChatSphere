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
		case "call_offer", "call_answer", "call_ice_candidate", "call_reject", "call_end":
			var callPayload struct {
				CallID string `json:"callId"`
			}
			if err := json.Unmarshal(event.Payload, &callPayload); err != nil || callPayload.CallID == "" {
				continue
			}
			callID := callPayload.CallID

			// Force sender ID to the authenticated user ID
			event.UserID = c.userID

			if event.Type == "call_offer" {
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

				// Prevent hijacking / duplicate offer if the callID is already in use
				if _, exists := c.hub.GetCall(callID); exists {
					continue
				}

				c.hub.AddCall(callID, c.userID, recipientID)
				c.hub.Broadcast(event)

			} else {
				session, ok := c.hub.GetCall(callID)
				if !ok {
					continue
				}

				if c.userID != session.CallerID && c.userID != session.ReceiverID {
					continue // Not a participant
				}

				var otherParticipant string
				if c.userID == session.CallerID {
					otherParticipant = session.ReceiverID
				} else {
					otherParticipant = session.CallerID
				}

				event.TargetUserIDs = []string{otherParticipant}

				if event.Type == "call_reject" || event.Type == "call_end" {
					c.hub.RemoveCall(callID)
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
