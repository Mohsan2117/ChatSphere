package http

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"
)

func TestPrivateMessagingFlow(t *testing.T) {
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	cfg.Port = "0"
	cfg.FrontendOrigin = "http://localhost:3000"

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")

	ali := createTestUser(t, router, "ali-"+suffix+"@example.com", "Ali", "Tester")
	hamza := createTestUser(t, router, "hamza-"+suffix+"@example.com", "Hamza", "Tester")
	mohsin := createTestUser(t, router, "mohsin-"+suffix+"@example.com", "Mohsin", "Tester")

	sendResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Private message from Ali to Hamza",
	}, http.StatusOK)
	var sent struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(sendResp.Body.Bytes(), &sent); err != nil {
		t.Fatalf("decode sent message: %v", err)
	}
	messageID, _ := sent.Message["id"].(string)
	if messageID == "" {
		t.Fatalf("sent message has no id: %s", sendResp.Body.String())
	}
	replyResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", hamza.Token, map[string]any{
		"recipientId":      ali.ID,
		"body":             "Replying to Ali",
		"replyToMessageId": messageID,
	}, http.StatusOK)
	var replyPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(replyResp.Body.Bytes(), &replyPayload); err != nil {
		t.Fatalf("decode direct reply: %v", err)
	}
	replyTo, _ := replyPayload.Message["replyTo"].(map[string]any)
	if replyTo["id"] != messageID || replyTo["senderName"] == "" {
		t.Fatalf("direct reply metadata missing: %+v", replyPayload.Message)
	}
	replyMessageID, _ := replyPayload.Message["id"].(string)
	if replyMessageID == "" {
		t.Fatalf("direct reply has no id: %+v", replyPayload.Message)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages", mohsin.Token, map[string]any{
		"recipientId":      hamza.ID,
		"body":             "Invalid cross-conversation reply",
		"replyToMessageId": messageID,
	}, http.StatusBadRequest)
	editResp := requestJSON(t, router, http.MethodPatch, "/api/v1/messages/"+messageID, ali.Token, map[string]any{"body": "Edited private message from Ali"}, http.StatusOK)
	var editPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(editResp.Body.Bytes(), &editPayload); err != nil {
		t.Fatalf("decode direct edit: %v", err)
	}
	if editPayload.Message["body"] != "Edited private message from Ali" || editPayload.Message["editedAt"] == nil {
		t.Fatalf("direct edit response missing body/editedAt: %+v", editPayload.Message)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+messageID, ali.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+messageID, ali.Token, nil, http.StatusOK)
	aliStarred := getMessages(t, router, "/api/v1/messages/starred/"+hamza.ID, ali.Token)
	aliStarredMessage := foundMessage(aliStarred, messageID)
	if aliStarredMessage == nil || aliStarredMessage["isStarred"] != true || aliStarredMessage["body"] != "Edited private message from Ali" {
		t.Fatalf("direct starred list should include current edited content for starring user: %+v", aliStarred)
	}
	hamzaReadbackStar := foundMessage(getMessages(t, router, "/api/v1/messages/"+ali.ID, hamza.Token), messageID)
	if hamzaReadbackStar == nil || hamzaReadbackStar["isStarred"] == true {
		t.Fatalf("direct star state leaked to other participant: %+v", hamzaReadbackStar)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+messageID, mohsin.Token, nil, http.StatusNotFound)
	requestJSON(t, router, http.MethodDelete, "/api/v1/messages/stars/"+messageID, ali.Token, nil, http.StatusOK)
	if foundMessage(getMessages(t, router, "/api/v1/messages/starred/"+hamza.ID, ali.Token), messageID) != nil {
		t.Fatal("direct unstar should remove message from starred list")
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+messageID, ali.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodPatch, "/api/v1/messages/"+messageID, hamza.Token, map[string]any{"body": "Recipient edit attempt"}, http.StatusNotFound)
	replyEditResp := requestJSON(t, router, http.MethodPatch, "/api/v1/messages/"+replyMessageID, hamza.Token, map[string]any{"body": "Edited reply to Ali"}, http.StatusOK)
	var replyEditPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(replyEditResp.Body.Bytes(), &replyEditPayload); err != nil {
		t.Fatalf("decode direct reply edit: %v", err)
	}
	editedReplyTo, _ := replyEditPayload.Message["replyTo"].(map[string]any)
	if editedReplyTo["id"] != messageID || replyEditPayload.Message["editedAt"] == nil {
		t.Fatalf("direct edit should preserve reply metadata and set editedAt: %+v", replyEditPayload.Message)
	}
	attachmentResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Text with direct attachment",
		"attachment": map[string]any{
			"name": "direct-note.txt",
			"type": "text/plain",
			"kind": "file",
			"url":  "https://cdn.example.com/direct-note.txt",
		},
	}, http.StatusOK)
	var attachmentPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(attachmentResp.Body.Bytes(), &attachmentPayload); err != nil {
		t.Fatalf("decode direct attachment message: %v", err)
	}
	attachmentMessageID, _ := attachmentPayload.Message["id"].(string)
	attachmentEditResp := requestJSON(t, router, http.MethodPatch, "/api/v1/messages/"+attachmentMessageID, ali.Token, map[string]any{"body": "Edited direct attachment text"}, http.StatusOK)
	var attachmentEditPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(attachmentEditResp.Body.Bytes(), &attachmentEditPayload); err != nil {
		t.Fatalf("decode direct attachment edit: %v", err)
	}
	attachment, _ := attachmentEditPayload.Message["attachment"].(map[string]any)
	if attachment["name"] != "direct-note.txt" || attachment["url"] != "https://cdn.example.com/direct-note.txt" {
		t.Fatalf("direct edit changed attachment metadata: %+v", attachmentEditPayload.Message)
	}
	privateDeleteResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Direct delete for me",
	}, http.StatusOK)
	var privateDeletePayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(privateDeleteResp.Body.Bytes(), &privateDeletePayload); err != nil {
		t.Fatalf("decode direct delete-for-me message: %v", err)
	}
	privateDeleteID, _ := privateDeletePayload.Message["id"].(string)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+privateDeleteID, hamza.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodDelete, "/api/v1/messages/"+privateDeleteID+"/me", hamza.Token, nil, http.StatusOK)
	if foundMessage(getMessages(t, router, "/api/v1/messages/"+ali.ID, hamza.Token), privateDeleteID) != nil {
		t.Fatal("direct delete for me should hide message from deleting recipient")
	}
	if foundMessage(getMessages(t, router, "/api/v1/messages/starred/"+ali.ID, hamza.Token), privateDeleteID) != nil {
		t.Fatal("direct delete for me should hide message from starred results")
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+privateDeleteID, hamza.Token, nil, http.StatusNotFound)
	if foundMessage(getMessages(t, router, "/api/v1/messages/"+hamza.ID, ali.Token), privateDeleteID) == nil {
		t.Fatal("direct delete for me should not hide message from other participant")
	}
	deleteEveryoneResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Direct delete for everyone",
		"attachment": map[string]any{
			"name": "delete-direct.txt",
			"type": "text/plain",
			"kind": "file",
			"url":  "https://cdn.example.com/delete-direct.txt",
		},
	}, http.StatusOK)
	var deleteEveryonePayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(deleteEveryoneResp.Body.Bytes(), &deleteEveryonePayload); err != nil {
		t.Fatalf("decode direct delete-everyone message: %v", err)
	}
	deleteEveryoneID, _ := deleteEveryonePayload.Message["id"].(string)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/stars/"+deleteEveryoneID, ali.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+deleteEveryoneID, hamza.Token, map[string]any{"emoji": "❤️"}, http.StatusOK)
	requestJSON(t, router, http.MethodDelete, "/api/v1/messages/"+deleteEveryoneID+"/everyone", hamza.Token, nil, http.StatusNotFound)
	deleteEveryoneResult := requestJSON(t, router, http.MethodDelete, "/api/v1/messages/"+deleteEveryoneID+"/everyone", ali.Token, nil, http.StatusOK)
	var deletedDirect struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(deleteEveryoneResult.Body.Bytes(), &deletedDirect); err != nil {
		t.Fatalf("decode direct tombstone: %v", err)
	}
	if deletedDirect.Message["deletedForEveryone"] != true || deletedDirect.Message["body"] != "" || deletedDirect.Message["attachment"] != nil || len(reactionsFromMap(deletedDirect.Message)) != 0 {
		t.Fatalf("direct tombstone leaked content/reactions: %+v", deletedDirect.Message)
	}
	if foundMessage(getMessages(t, router, "/api/v1/messages/starred/"+hamza.ID, ali.Token), deleteEveryoneID) != nil {
		t.Fatal("direct delete for everyone should not expose content through starred results")
	}
	requestJSON(t, router, http.MethodPatch, "/api/v1/messages/"+deleteEveryoneID, ali.Token, map[string]any{"body": "Edit deleted message"}, http.StatusBadRequest)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+deleteEveryoneID, hamza.Token, map[string]any{"emoji": "🙏"}, http.StatusNotFound)
	replyToDeletedResp := requestJSON(t, router, http.MethodPost, "/api/v1/messages", hamza.Token, map[string]any{
		"recipientId":      ali.ID,
		"body":             "Replying to a deleted direct message",
		"replyToMessageId": deleteEveryoneID,
	}, http.StatusOK)
	var replyToDeletedPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(replyToDeletedResp.Body.Bytes(), &replyToDeletedPayload); err != nil {
		t.Fatalf("decode direct reply to deleted message: %v", err)
	}
	deletedReplyTo, _ := replyToDeletedPayload.Message["replyTo"].(map[string]any)
	if deletedReplyTo["unavailable"] != true || deletedReplyTo["body"] != "" || deletedReplyTo["attachmentKind"] != nil {
		t.Fatalf("direct reply leaked deleted original: %+v", replyToDeletedPayload.Message)
	}

	aliInbox := getMessages(t, router, "/api/v1/messages/inbox", ali.Token)
	if len(aliInbox) == 0 {
		t.Fatal("expected sender inbox to include sent message")
	}

	hamzaInbox := getMessages(t, router, "/api/v1/messages/inbox", hamza.Token)
	if len(hamzaInbox) == 0 {
		t.Fatal("expected recipient inbox to include received message")
	}
	reactions := decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+messageID, hamza.Token, map[string]any{"emoji": "❤️"}, http.StatusOK))
	assertReaction(t, reactions, "❤️", 1, true)
	reactions = decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+messageID, hamza.Token, map[string]any{"emoji": "😂"}, http.StatusOK))
	assertReaction(t, reactions, "😂", 1, true)
	reactions = decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+messageID, hamza.Token, map[string]any{"emoji": "😂"}, http.StatusOK))
	if len(reactions) != 0 {
		t.Fatalf("same emoji should toggle off reaction, got %+v", reactions)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+messageID, mohsin.Token, map[string]any{"emoji": "🙏"}, http.StatusNotFound)
	requestJSON(t, router, http.MethodPost, "/api/v1/messages/reactions/"+messageID, hamza.Token, map[string]any{"emoji": "❤️"}, http.StatusOK)
	readback := getMessages(t, router, "/api/v1/messages/"+ali.ID, hamza.Token)
	foundReaction := false
	foundEditedReply := false
	for _, message := range readback {
		if message["id"] == messageID {
			foundReaction = len(reactionsFromMap(message)) == 1
		}
		if message["id"] == replyMessageID {
			replyTo, _ := message["replyTo"].(map[string]any)
			foundEditedReply = message["body"] == "Edited reply to Ali" && message["editedAt"] != nil && replyTo["id"] == messageID
		}
	}
	if !foundReaction {
		t.Fatalf("expected direct message reactions in readback: %+v", readback)
	}
	if !foundEditedReply {
		t.Fatalf("expected edited direct reply metadata in readback: %+v", readback)
	}

	mohsinInbox := getMessages(t, router, "/api/v1/messages/inbox", mohsin.Token)
	for _, message := range mohsinInbox {
		if message["body"] == "Private message from Ali to Hamza" {
			t.Fatal("third user can see another users' private message")
		}
	}

	mohsinHamzaMessages := getMessages(t, router, "/api/v1/messages/"+hamza.ID, mohsin.Token)
	for _, message := range mohsinHamzaMessages {
		if message["body"] == "Private message from Ali to Hamza" {
			t.Fatal("third user can open another private conversation")
		}
	}

	postJSON(t, router, http.MethodPost, "/api/v1/contacts/"+ali.ID+"/block", hamza.Token, map[string]any{}, http.StatusOK)
	postJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "Blocked message",
	}, http.StatusInternalServerError)
}

func TestCallHistoryEndpoint(t *testing.T) {
	cfg := config.Config{
		Port:           "0",
		FrontendOrigin: "http://localhost:3000",
		DataPath:       t.TempDir() + "/data.json",
	}
	dataStore, err := store.New(cfg.DataPath, "")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")

	ali := createTestUser(t, router, "ali-calls-"+suffix+"@example.com", "Ali", "Caller")
	hamza := createTestUser(t, router, "hamza-calls-"+suffix+"@example.com", "Hamza", "Receiver")

	if err := dataStore.CreateCallHistory("call-test-1", ali.ID, hamza.ID, "video"); err != nil {
		t.Fatalf("create call history: %v", err)
	}
	if err := dataStore.UpdateCallHistoryStatus("call-test-1", "answered"); err != nil {
		t.Fatalf("answer call history: %v", err)
	}
	if err := dataStore.UpdateCallHistoryStatus("call-test-1", "ended"); err != nil {
		t.Fatalf("end call history: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/calls/history", nil)
	req.Header.Set("Authorization", "Bearer "+ali.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/calls/history: status %d body %s", resp.Code, resp.Body.String())
	}

	var payload struct {
		Calls []struct {
			ID        string `json:"id"`
			Direction string `json:"direction"`
			CallType  string `json:"callType"`
			Status    string `json:"status"`
			OtherUser struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"otherUser"`
		} `json:"calls"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode call history response: %v", err)
	}
	if len(payload.Calls) != 1 {
		t.Fatalf("call history count = %d, want 1", len(payload.Calls))
	}
	call := payload.Calls[0]
	if call.ID != "call-test-1" || call.Direction != "outgoing" || call.CallType != "video" || call.Status != "ended" {
		t.Fatalf("unexpected call summary: %+v", call)
	}
	if call.OtherUser.ID != hamza.ID || call.OtherUser.Name != "Hamza Receiver" {
		t.Fatalf("unexpected other user: %+v", call.OtherUser)
	}
}

func TestStatusLifecycle(t *testing.T) {
	cfg := config.Config{Port: "0", FrontendOrigin: "http://localhost:3000", DataPath: t.TempDir() + "/data.json"}
	dataStore, err := store.New(cfg.DataPath, "")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")
	ali := createTestUser(t, router, "ali-status-"+suffix+"@example.com", "Ali", "Status")
	hamza := createTestUser(t, router, "hamza-status-"+suffix+"@example.com", "Hamza", "Viewer")

	postJSON(t, router, http.MethodPost, "/api/v1/statuses", ali.Token, map[string]any{
		"type": "text", "textContent": "Hello from Status", "background": "#e7f8f2",
	}, http.StatusOK)
	var feed struct {
		Statuses []struct {
			ID, UserID, Type, TextContent string
			Viewed                        bool
		} `json:"statuses"`
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/statuses", nil)
	req.Header.Set("Authorization", "Bearer "+hamza.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("GET statuses: status %d body %s", resp.Code, resp.Body.String())
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &feed); err != nil || len(feed.Statuses) != 1 {
		t.Fatalf("unexpected status feed: %s", resp.Body.String())
	}
	statusID := feed.Statuses[0].ID
	if feed.Statuses[0].UserID != ali.ID || feed.Statuses[0].Type != "text" || feed.Statuses[0].TextContent != "Hello from Status" || feed.Statuses[0].Viewed {
		t.Fatalf("unexpected status: %+v", feed.Statuses[0])
	}
	postJSON(t, router, http.MethodPost, "/api/v1/statuses/"+statusID+"/view", hamza.Token, map[string]any{}, http.StatusOK)
	postJSON(t, router, http.MethodPost, "/api/v1/statuses/"+statusID+"/view", hamza.Token, map[string]any{}, http.StatusOK)
	viewersReq := httptest.NewRequest(http.MethodGet, "/api/v1/statuses/"+statusID+"/viewers", nil)
	viewersReq.Header.Set("Authorization", "Bearer "+ali.Token)
	viewersResp := httptest.NewRecorder()
	router.ServeHTTP(viewersResp, viewersReq)
	if viewersResp.Code != http.StatusOK || !strings.Contains(viewersResp.Body.String(), hamza.ID) {
		t.Fatalf("unexpected viewers response: %d %s", viewersResp.Code, viewersResp.Body.String())
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/statuses/"+statusID, nil)
	deleteReq.Header.Set("Authorization", "Bearer "+hamza.Token)
	deleteResp := httptest.NewRecorder()
	router.ServeHTTP(deleteResp, deleteReq)
	if deleteResp.Code != http.StatusNotFound {
		t.Fatalf("non-owner delete status = %d, want 404", deleteResp.Code)
	}
	postJSON(t, router, http.MethodDelete, "/api/v1/statuses/"+statusID, ali.Token, map[string]any{}, http.StatusOK)
}

func TestGroupsLifecycleAndAuthorization(t *testing.T) {
	cfg := config.Config{Port: "0", FrontendOrigin: "http://localhost:3000", DataPath: t.TempDir() + "/data.json"}
	dataStore, err := store.New(cfg.DataPath, "")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")
	owner := createTestUser(t, router, "owner-group-"+suffix+"@example.com", "Owner", "Group")
	member := createTestUser(t, router, "member-group-"+suffix+"@example.com", "Member", "Group")
	outsider := createTestUser(t, router, "outsider-group-"+suffix+"@example.com", "Outside", "Group")
	stranger := createTestUser(t, router, "stranger-group-"+suffix+"@example.com", "Stranger", "Group")

	var created struct {
		Group struct {
			ID          string `json:"id"`
			Role        string `json:"role"`
			MemberCount int    `json:"memberCount"`
		} `json:"group"`
	}
	content, _ := json.Marshal(map[string]any{"name": "Project Group", "memberIds": []string{member.ID}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/groups", bytes.NewReader(content))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+owner.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", resp.Code, resp.Body.String())
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode group: %v", err)
	}
	if created.Group.ID == "" || created.Group.Role != "owner" || created.Group.MemberCount != 2 {
		t.Fatalf("unexpected created group: %+v", created.Group)
	}
	groupID := created.Group.ID

	getGroup := func(user testUser, path string, want int) string {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+user.Token)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		if resp.Code != want {
			t.Fatalf("GET %s as %s: status %d want %d body %s", path, user.Email, resp.Code, want, resp.Body.String())
		}
		return resp.Body.String()
	}
	getGroup(owner, "/api/v1/groups", http.StatusOK)
	getGroup(member, "/api/v1/groups/"+groupID, http.StatusOK)
	getGroup(outsider, "/api/v1/groups/"+groupID, http.StatusForbidden)

	postJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/members", member.Token, map[string]any{"userIds": []string{outsider.ID}}, http.StatusForbidden)
	postJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/members", owner.Token, map[string]any{"userIds": []string{outsider.ID}}, http.StatusOK)
	postJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/admins/"+member.ID, owner.Token, map[string]any{}, http.StatusOK)
	postJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/admins/"+member.ID, member.Token, map[string]any{}, http.StatusForbidden)
	postJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/admins/"+member.ID, owner.Token, map[string]any{}, http.StatusOK)
	postJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/members/"+owner.ID, member.Token, map[string]any{}, http.StatusForbidden)
	groupMessageResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", owner.Token, map[string]any{"body": "Welcome to the group"}, http.StatusOK)
	var groupMessagePayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupMessageResp.Body.Bytes(), &groupMessagePayload); err != nil {
		t.Fatalf("decode group message: %v", err)
	}
	groupMessageID, _ := groupMessagePayload.Message["id"].(string)
	if groupMessageID == "" {
		t.Fatalf("group message has no id: %s", groupMessageResp.Body.String())
	}
	groupReplyResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", member.Token, map[string]any{"body": "Replying in group", "replyToMessageId": groupMessageID}, http.StatusOK)
	var groupReplyPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupReplyResp.Body.Bytes(), &groupReplyPayload); err != nil {
		t.Fatalf("decode group reply: %v", err)
	}
	groupReplyTo, _ := groupReplyPayload.Message["replyTo"].(map[string]any)
	if groupReplyTo["id"] != groupMessageID || groupReplyTo["senderName"] == "" {
		t.Fatalf("group reply metadata missing: %+v", groupReplyPayload.Message)
	}
	groupReplyID, _ := groupReplyPayload.Message["id"].(string)
	if groupReplyID == "" {
		t.Fatalf("group reply has no id: %+v", groupReplyPayload.Message)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", stranger.Token, map[string]any{"body": "Unauthorized reply", "replyToMessageId": groupMessageID}, http.StatusForbidden)
	groupEditResp := requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID, owner.Token, map[string]any{"body": "Edited welcome to the group"}, http.StatusOK)
	var groupEditPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupEditResp.Body.Bytes(), &groupEditPayload); err != nil {
		t.Fatalf("decode group edit: %v", err)
	}
	if groupEditPayload.Message["body"] != "Edited welcome to the group" || groupEditPayload.Message["editedAt"] == nil {
		t.Fatalf("group edit response missing body/editedAt: %+v", groupEditPayload.Message)
	}
	groupStarResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/star", member.Token, nil, http.StatusOK)
	var groupStarPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupStarResp.Body.Bytes(), &groupStarPayload); err != nil {
		t.Fatalf("decode group star response: %v", err)
	}
	if groupStarPayload.Message["isStarred"] != true {
		t.Fatalf("group star response missing private star state: %+v", groupStarPayload.Message)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/star", member.Token, nil, http.StatusOK)
	memberStarredGroup := getMessages(t, router, "/api/v1/groups/"+groupID+"/messages/starred", member.Token)
	memberStarredGroupMessage := foundMessage(memberStarredGroup, groupMessageID)
	if memberStarredGroupMessage == nil || memberStarredGroupMessage["isStarred"] != true || memberStarredGroupMessage["body"] != "Edited welcome to the group" {
		t.Fatalf("group starred list should include current edited content for starring member: %+v", memberStarredGroup)
	}
	ownerGroupReadbackStar := foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages", owner.Token), groupMessageID)
	if ownerGroupReadbackStar == nil || ownerGroupReadbackStar["isStarred"] == true {
		t.Fatalf("group star state leaked to another member: %+v", ownerGroupReadbackStar)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/star", stranger.Token, nil, http.StatusForbidden)
	requestJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/star", member.Token, nil, http.StatusOK)
	if foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages/starred", member.Token), groupMessageID) != nil {
		t.Fatal("group unstar should remove message from starred list")
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/star", member.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID, outsider.Token, map[string]any{"body": "Other member edit attempt"}, http.StatusForbidden)
	requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+groupID+"/messages/"+groupReplyID, owner.Token, map[string]any{"body": "Owner edits member reply"}, http.StatusForbidden)
	otherGroupResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups", owner.Token, map[string]any{"name": "Other group", "memberIds": []string{member.ID}}, http.StatusOK)
	var otherGroupPayload struct {
		Group struct {
			ID string `json:"id"`
		} `json:"group"`
	}
	if err := json.Unmarshal(otherGroupResp.Body.Bytes(), &otherGroupPayload); err != nil {
		t.Fatalf("decode other group: %v", err)
	}
	requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+otherGroupPayload.Group.ID+"/messages/"+groupMessageID, owner.Token, map[string]any{"body": "Cross-group edit attempt"}, http.StatusForbidden)
	groupAttachmentResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", owner.Token, map[string]any{
		"body": "Text with group attachment",
		"attachment": map[string]any{
			"name": "group-note.txt",
			"type": "text/plain",
			"kind": "file",
			"url":  "https://cdn.example.com/group-note.txt",
		},
	}, http.StatusOK)
	var groupAttachmentPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupAttachmentResp.Body.Bytes(), &groupAttachmentPayload); err != nil {
		t.Fatalf("decode group attachment message: %v", err)
	}
	groupAttachmentID, _ := groupAttachmentPayload.Message["id"].(string)
	groupAttachmentEditResp := requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+groupID+"/messages/"+groupAttachmentID, owner.Token, map[string]any{"body": "Edited group attachment text"}, http.StatusOK)
	var groupAttachmentEditPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupAttachmentEditResp.Body.Bytes(), &groupAttachmentEditPayload); err != nil {
		t.Fatalf("decode group attachment edit: %v", err)
	}
	groupAttachment, _ := groupAttachmentEditPayload.Message["attachment"].(map[string]any)
	if groupAttachment["name"] != "group-note.txt" || groupAttachment["url"] != "https://cdn.example.com/group-note.txt" {
		t.Fatalf("group edit changed attachment metadata: %+v", groupAttachmentEditPayload.Message)
	}
	groupPrivateDeleteResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", owner.Token, map[string]any{"body": "Group delete for me"}, http.StatusOK)
	var groupPrivateDeletePayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupPrivateDeleteResp.Body.Bytes(), &groupPrivateDeletePayload); err != nil {
		t.Fatalf("decode group delete-for-me message: %v", err)
	}
	groupPrivateDeleteID, _ := groupPrivateDeletePayload.Message["id"].(string)
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupPrivateDeleteID+"/star", member.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/messages/"+groupPrivateDeleteID+"/me", member.Token, nil, http.StatusOK)
	if foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages", member.Token), groupPrivateDeleteID) != nil {
		t.Fatal("group delete for me should hide message from deleting member")
	}
	if foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages/starred", member.Token), groupPrivateDeleteID) != nil {
		t.Fatal("group delete for me should hide message from starred results")
	}
	if foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages", owner.Token), groupPrivateDeleteID) == nil {
		t.Fatal("group delete for me should not hide message from other members")
	}
	groupDeleteEveryoneResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", member.Token, map[string]any{
		"body": "Group delete for everyone",
		"attachment": map[string]any{
			"name": "delete-group.txt",
			"type": "text/plain",
			"kind": "file",
			"url":  "https://cdn.example.com/delete-group.txt",
		},
	}, http.StatusOK)
	var groupDeleteEveryonePayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupDeleteEveryoneResp.Body.Bytes(), &groupDeleteEveryonePayload); err != nil {
		t.Fatalf("decode group delete-everyone message: %v", err)
	}
	groupDeleteEveryoneID, _ := groupDeleteEveryonePayload.Message["id"].(string)
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID+"/star", member.Token, nil, http.StatusOK)
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID+"/reactions", owner.Token, map[string]any{"emoji": "❤️"}, http.StatusOK)
	requestJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID+"/everyone", owner.Token, nil, http.StatusForbidden)
	groupDeleteEveryoneResult := requestJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID+"/everyone", member.Token, nil, http.StatusOK)
	var deletedGroup struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupDeleteEveryoneResult.Body.Bytes(), &deletedGroup); err != nil {
		t.Fatalf("decode group tombstone: %v", err)
	}
	if deletedGroup.Message["deletedForEveryone"] != true || deletedGroup.Message["body"] != "" || deletedGroup.Message["attachment"] != nil || len(reactionsFromMap(deletedGroup.Message)) != 0 {
		t.Fatalf("group tombstone leaked content/reactions: %+v", deletedGroup.Message)
	}
	if foundMessage(getMessages(t, router, "/api/v1/groups/"+groupID+"/messages/starred", member.Token), groupDeleteEveryoneID) != nil {
		t.Fatal("group delete for everyone should not expose content through starred results")
	}
	requestJSON(t, router, http.MethodPatch, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID, member.Token, map[string]any{"body": "Edit deleted group message"}, http.StatusBadRequest)
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupDeleteEveryoneID+"/reactions", owner.Token, map[string]any{"emoji": "🙏"}, http.StatusForbidden)
	groupReplyToDeletedResp := requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages", owner.Token, map[string]any{"body": "Replying to a deleted group message", "replyToMessageId": groupDeleteEveryoneID}, http.StatusOK)
	var groupReplyToDeletedPayload struct {
		Message map[string]any `json:"message"`
	}
	if err := json.Unmarshal(groupReplyToDeletedResp.Body.Bytes(), &groupReplyToDeletedPayload); err != nil {
		t.Fatalf("decode group reply to deleted message: %v", err)
	}
	groupDeletedReplyTo, _ := groupReplyToDeletedPayload.Message["replyTo"].(map[string]any)
	if groupDeletedReplyTo["unavailable"] != true || groupDeletedReplyTo["body"] != "" || groupDeletedReplyTo["attachmentKind"] != nil {
		t.Fatalf("group reply leaked deleted original: %+v", groupReplyToDeletedPayload.Message)
	}
	reactions := decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/reactions", member.Token, map[string]any{"emoji": "❤️"}, http.StatusOK))
	assertReaction(t, reactions, "❤️", 1, true)
	reactions = decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/reactions", member.Token, map[string]any{"emoji": "👍"}, http.StatusOK))
	assertReaction(t, reactions, "👍", 1, true)
	reactions = decodeReactionResponse(t, requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/reactions", member.Token, map[string]any{"emoji": "👍"}, http.StatusOK))
	if len(reactions) != 0 {
		t.Fatalf("same group emoji should toggle off reaction, got %+v", reactions)
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/reactions", stranger.Token, map[string]any{"emoji": "🙏"}, http.StatusForbidden)
	requestJSON(t, router, http.MethodPost, "/api/v1/groups/"+groupID+"/messages/"+groupMessageID+"/reactions", member.Token, map[string]any{"emoji": "❤️"}, http.StatusOK)
	getGroup(member, "/api/v1/groups/"+groupID+"/messages", http.StatusOK)
	groupReadback := getMessages(t, router, "/api/v1/groups/"+groupID+"/messages", member.Token)
	foundReaction := false
	foundEditedGroupMessage := false
	for _, message := range groupReadback {
		if message["id"] == groupMessageID {
			foundReaction = len(reactionsFromMap(message)) == 1
			foundEditedGroupMessage = message["body"] == "Edited welcome to the group" && message["editedAt"] != nil
		}
	}
	if !foundReaction {
		t.Fatalf("expected group message reactions in readback: %+v", groupReadback)
	}
	if !foundEditedGroupMessage {
		t.Fatalf("expected edited group message in readback: %+v", groupReadback)
	}
	postJSON(t, router, http.MethodDelete, "/api/v1/groups/"+groupID+"/members/"+outsider.ID, owner.Token, map[string]any{}, http.StatusOK)
	getGroup(outsider, "/api/v1/groups/"+groupID+"/messages", http.StatusForbidden)
}

type testUser struct {
	ID    string
	Email string
	Token string
}

func createTestUser(t *testing.T, handler http.Handler, email, firstName, lastName string) testUser {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("email", email)
	_ = writer.WriteField("firstName", firstName)
	_ = writer.WriteField("lastName", lastName)
	_ = writer.WriteField("password", "Password123!")
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/profile/onboarding", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("create user %s: status %d body %s", email, resp.Code, resp.Body.String())
	}
	var payload struct {
		Profile struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"profile"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode create user response: %v", err)
	}
	return testUser{ID: payload.Profile.ID, Email: payload.Profile.Email, Token: payload.Token}
}

func postJSON(t *testing.T, handler http.Handler, method, path, token string, body map[string]any, wantStatus int) {
	t.Helper()
	requestJSON(t, handler, method, path, token, body, wantStatus)
}

func requestJSON(t *testing.T, handler http.Handler, method, path, token string, body map[string]any, wantStatus int) *httptest.ResponseRecorder {
	t.Helper()
	content, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(content))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != wantStatus {
		t.Fatalf("%s %s: status %d want %d body %s", method, path, resp.Code, wantStatus, resp.Body.String())
	}
	return resp
}

func decodeReactionResponse(t *testing.T, resp *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var payload struct {
		Reactions []map[string]any `json:"reactions"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode reaction response: %v", err)
	}
	return payload.Reactions
}

func assertReaction(t *testing.T, reactions []map[string]any, emoji string, count int, reactedByMe bool) {
	t.Helper()
	if len(reactions) != 1 {
		t.Fatalf("reaction count = %d, want 1: %+v", len(reactions), reactions)
	}
	if reactions[0]["emoji"] != emoji || int(reactions[0]["count"].(float64)) != count || reactions[0]["reactedByMe"] != reactedByMe {
		t.Fatalf("unexpected reaction summary: %+v", reactions[0])
	}
	users, _ := reactions[0]["users"].([]any)
	if len(users) != count {
		t.Fatalf("reaction users = %d, want %d: %+v", len(users), count, reactions[0])
	}
}

func reactionsFromMap(message map[string]any) []any {
	reactions, _ := message["reactions"].([]any)
	return reactions
}

func foundMessage(messages []map[string]any, id string) map[string]any {
	for _, message := range messages {
		if message["id"] == id {
			return message
		}
	}
	return nil
}

func getMessages(t *testing.T, handler http.Handler, path, token string) []map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d body %s", path, resp.Code, resp.Body.String())
	}
	var payload struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	return payload.Messages
}

func TestVoiceMessageUpload(t *testing.T) {
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	cfg.Port = "0"
	cfg.FrontendOrigin = "http://localhost:3000"

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)
	suffix := time.Now().UTC().Format("20060102150405")

	ali := createTestUser(t, router, "ali-voice-"+suffix+"@example.com", "Ali", "Voice")
	hamza := createTestUser(t, router, "hamza-voice-"+suffix+"@example.com", "Hamza", "Voice")

	// 1. Simulate voice file upload
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "voice-message_5s.webm")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("dummy audio content webm format"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+ali.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("upload voice message failed: status %d body %s", resp.Code, resp.Body.String())
	}

	var uploadResp struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Kind string `json:"kind"`
		URL  string `json:"url"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &uploadResp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}

	if uploadResp.Kind != "audio" {
		t.Fatalf("expected upload kind to be audio, got %s", uploadResp.Kind)
	}

	// 2. Send private message with voice attachment
	postJSON(t, router, http.MethodPost, "/api/v1/messages", ali.Token, map[string]any{
		"recipientId": hamza.ID,
		"body":        "",
		"attachment": map[string]any{
			"name": uploadResp.Name,
			"type": uploadResp.Type,
			"kind": uploadResp.Kind,
			"url":  uploadResp.URL,
		},
	}, http.StatusOK)
}

func TestOptimizeCloudinaryURL(t *testing.T) {
	cfg := config.Config{
		MaxUploadSizeMB:             50,
		ImageOptimizeThresholdBytes: 2097152,  // 2 MB
		VideoOptimizeThresholdBytes: 10485760, // 10 MB
		ImageMaxDimension:           1920,
		VideoMaxDimension:           1280,
	}

	tests := []struct {
		name        string
		rawURL      string
		kind        string
		size        int64
		expectedURL string
	}{
		{
			name:        "Image below threshold -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
			kind:        "image",
			size:        1 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
		},
		{
			name:        "Image above threshold -> optimized with c_limit and 1920 dimension",
			rawURL:      "https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1920,h_1920/v12345/sample.jpg",
		},
		{
			name:        "Video below threshold -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
			kind:        "video",
			size:        5 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
		},
		{
			name:        "Video above threshold -> optimized with c_limit and 1280 dimension",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp4",
			kind:        "video",
			size:        15 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/f_auto,q_auto,c_limit,w_1280,h_1280/v12345/sample.mp4",
		},
		{
			name:        "Audio -> unchanged even if large",
			rawURL:      "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp3",
			kind:        "audio",
			size:        25 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/video/upload/v12345/sample.mp3",
		},
		{
			name:        "Generic file -> unchanged even if large",
			rawURL:      "https://res.cloudinary.com/demo/raw/upload/v12345/sample.pdf",
			kind:        "file",
			size:        25 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/raw/upload/v12345/sample.pdf",
		},
		{
			name:        "Invalid Cloudinary URL -> unchanged",
			rawURL:      "https://res.cloudinary.com/demo/image/download/v12345/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://res.cloudinary.com/demo/image/download/v12345/sample.jpg",
		},
		{
			name:        "Non-Cloudinary URL -> unchanged",
			rawURL:      "https://example.com/files/sample.jpg",
			kind:        "image",
			size:        3 * 1024 * 1024,
			expectedURL: "https://example.com/files/sample.jpg",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := optimizeCloudinaryURL(tc.rawURL, tc.kind, tc.size, cfg)
			if actual != tc.expectedURL {
				t.Errorf("expected URL:\n%s\ngot:\n%s", tc.expectedURL, actual)
			}
			// Verify that no cropping transforms (c_crop, c_fill, c_fill_pad) are introduced
			if strings.Contains(actual, "c_crop") || strings.Contains(actual, "c_fill") || strings.Contains(actual, "c_fill_pad") {
				t.Errorf("illegal crop transformation introduced in: %s", actual)
			}
		})
	}
}

func TestConfigDefaults(t *testing.T) {
	// Unset environment variables to ensure we check defaults
	os.Unsetenv("MAX_UPLOAD_SIZE_MB")
	os.Unsetenv("IMAGE_OPTIMIZE_THRESHOLD_BYTES")
	os.Unsetenv("VIDEO_OPTIMIZE_THRESHOLD_BYTES")
	os.Unsetenv("IMAGE_MAX_DIMENSION")
	os.Unsetenv("VIDEO_MAX_DIMENSION")

	cfg := config.Load()
	if cfg.MaxUploadSizeMB != 50 {
		t.Errorf("expected default MaxUploadSizeMB to be 50, got %d", cfg.MaxUploadSizeMB)
	}
	if cfg.ImageOptimizeThresholdBytes != 2097152 {
		t.Errorf("expected default ImageOptimizeThresholdBytes to be 2097152, got %d", cfg.ImageOptimizeThresholdBytes)
	}
	if cfg.VideoOptimizeThresholdBytes != 10485760 {
		t.Errorf("expected default VideoOptimizeThresholdBytes to be 10485760, got %d", cfg.VideoOptimizeThresholdBytes)
	}
	if cfg.ImageMaxDimension != 1920 {
		t.Errorf("expected default ImageMaxDimension to be 1920, got %d", cfg.ImageMaxDimension)
	}
	if cfg.VideoMaxDimension != 1280 {
		t.Errorf("expected default VideoMaxDimension to be 1280, got %d", cfg.VideoMaxDimension)
	}
}

func TestMessageIdempotencyAndClientGeneratedID(t *testing.T) {
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	cfg.Port = "0"
	cfg.FrontendOrigin = "http://localhost:3000"

	dataStore, err := store.New(cfg.DataPath, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}

	suffix := time.Now().UTC().Format("20060102150405")
	senderEmail := "sender-" + suffix + "@example.com"
	recipientEmail := "recipient-" + suffix + "@example.com"

	// Create test users
	hub := realtime.NewHub()
	go hub.Run()
	router := NewRouter(cfg, hub, dataStore)

	sender := createTestUser(t, router, senderEmail, "Sender", "User")
	recipient := createTestUser(t, router, recipientEmail, "Recipient", "User")

	clientMsgID := "client-uuid-" + suffix

	// 1. Save message with client message ID
	msg, err := dataStore.SaveMessage(clientMsgID, sender.Email, recipient.ID, "Hello idempotency", "", "", "", "", "")
	if err != nil {
		t.Fatalf("SaveMessage failed: %v", err)
	}
	if msg.ID != clientMsgID {
		t.Fatalf("expected message ID to be %s, got %s", clientMsgID, msg.ID)
	}

	// 2. Try saving again with the same client message ID
	// Let's verify MessageByID returns it
	foundMsg, err := dataStore.MessageByID(clientMsgID)
	if err != nil {
		t.Fatalf("MessageByID failed: %v", err)
	}
	if foundMsg.Body != "Hello idempotency" {
		t.Fatalf("expected body 'Hello idempotency', got '%s'", foundMsg.Body)
	}

	// 3. Test HTTP POST `/api/v1/messages` with same ID -> should return existing message (idempotency check)
	var body bytes.Buffer
	err = json.NewEncoder(&body).Encode(map[string]any{
		"id":          clientMsgID,
		"recipientId": recipient.ID,
		"body":        "Hello idempotency duplicate attempt",
	})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/messages", &body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+sender.Token)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. Body: %s", resp.Code, resp.Body.String())
	}

	var postResp struct {
		Message struct {
			ID   string `json:"id"`
			Body string `json:"body"`
		} `json:"message"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &postResp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// It should return the original message ("Hello idempotency"), NOT the duplicate one!
	if postResp.Message.ID != clientMsgID {
		t.Fatalf("expected returned ID to be %s, got %s", clientMsgID, postResp.Message.ID)
	}
	if postResp.Message.Body != "Hello idempotency" {
		t.Fatalf("idempotency check failed: expected original body 'Hello idempotency', got '%s'", postResp.Message.Body)
	}
}
