package http

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/gemini"
	"chatsphere/backend/internal/realtime"
	"chatsphere/backend/internal/store"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config, hub *realtime.Hub, dataStore *store.Store) *gin.Engine {
	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Trusted proxy configuration for safe client IP extraction. Gin's
	// ClientIP() only honors X-Forwarded-For when the peer is in this list.
	// By default we trust no proxy, so X-Forwarded-For is never trusted and
	// ClientIP() falls back to the immediate peer (RemoteAddr). Operators
	// behind Render should set TRUSTED_PROXIES to the Render proxy IPs.
	if strings.TrimSpace(cfg.TrustedProxies) != "" {
		_ = router.SetTrustedProxies(strings.Split(cfg.TrustedProxies, ","))
	} else {
		_ = router.SetTrustedProxies(nil)
	}

	router.Use(gin.Logger(), gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.FrontendOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	rootHandler := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "chatsphere-api"})
	}
	router.GET("/", rootHandler)

	healthHandler := func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()

		if err := dataStore.Ping(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"service":  "chatsphere-api",
				"status":   "error",
				"database": "error",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"service":  "chatsphere-api",
			"status":   "ok",
			"database": "ok",
		})
	}
	router.GET("/health", healthHandler)
	router.GET("/ws", func(c *gin.Context) {
		user, ok := authUserFromToken(c.Query("token"))
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
			return
		}
		realtime.Serve(c.Writer, c.Request, hub, user.ID, dataStore)
	})

	api := router.Group("/api/v1")
	api.GET("/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"maxUploadSizeMb":             cfg.MaxUploadSizeMB,
			"imageOptimizeThresholdBytes": cfg.ImageOptimizeThresholdBytes,
			"videoOptimizeThresholdBytes": cfg.VideoOptimizeThresholdBytes,
			"imageMaxDimension":           cfg.ImageMaxDimension,
			"videoMaxDimension":           cfg.VideoMaxDimension,
		})
	})
	registerAuthRoutes(api.Group("/auth"), cfg, dataStore)
	registerUserRoutes(api.Group("/users"), dataStore, hub)
	registerProfileRoutes(api.Group("/profile"), dataStore)
	registerContactRoutes(api.Group("/contacts"), dataStore)
	registerGroupRoutes(api.Group("/groups"))
	registerMessageRoutes(api.Group("/messages"), dataStore, hub)
	registerCallRoutes(api.Group("/calls"), dataStore)
	registerStatusRoutes(api.Group("/statuses"), dataStore)
	registerUploadRoutes(api.Group("/upload"), cfg, dataStore)
	registerFileRoutes(api.Group("/files"), dataStore)
	registerAdminRoutes(api.Group("/admin"), cfg, dataStore)
	registerAIRoutes(api.Group("/ai"), cfg, dataStore)

	return router
}

func registerAuthRoutes(group *gin.RouterGroup, cfg config.Config, dataStore *store.Store) {
	emailAuth := newEmailAuthHandler(cfg)
	emailAuth.register(group)
	emailAuth.registerPasswordReset(group, dataStore)
	group.POST("/register", accepted("register user"))
	group.POST("/login", loginUser(dataStore))
	group.POST("/refresh", accepted("refresh token"))
	group.POST("/logout", func(c *gin.Context) {
		token := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
		revokeToken(token)
		c.JSON(http.StatusOK, gin.H{"status": "logged-out"})
	})
}

func loginUser(dataStore *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}

		user, err := dataStore.Authenticate(normalizeEmail(body.Email), body.Password)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"user":   publicUser(user),
			"token":  signUserToken(user),
		})
	}
}

func registerUserRoutes(group *gin.RouterGroup, dataStore *store.Store, hub *realtime.Hub) {
	group.GET("", func(c *gin.Context) {
		if _, ok := requireUser(c); !ok {
			return
		}
		query := c.Query("q")
		users, err := dataStore.SearchUsersWithError(query)
		if err != nil {
			log.Printf("load users failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load users"})
			return
		}
		results := make([]gin.H, 0, len(users))
		for _, user := range users {
			result := publicUser(user)
			result["online"] = hub.IsOnline(user.ID)
			results = append(results, result)
		}
		c.JSON(http.StatusOK, gin.H{"users": results})
	})
	group.GET("/:id", accepted("get user"))
}

func registerProfileRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("", accepted("get profile"))
	group.POST("/onboarding", completeOnboarding(dataStore))
	group.PATCH("", updateProfile(dataStore))
	group.PATCH("/privacy", accepted("update privacy"))
	group.PATCH("/status", accepted("update status"))
}

func completeOnboarding(dataStore *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "profile request is too large"})
			return
		}

		email := normalizeEmail(c.PostForm("email"))
		firstName := strings.TrimSpace(c.PostForm("firstName"))
		lastName := strings.TrimSpace(c.PostForm("lastName"))
		password := strings.TrimSpace(c.PostForm("password"))

		if _, err := mail.ParseAddress(email); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
			return
		}
		if firstName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "first name is required"})
			return
		}
		if len(password) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
			return
		}

		avatarURL, avatarUploaded, err := avatarDataURL(c, "avatar")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		user, err := dataStore.UpsertUser(email, firstName, lastName, password, avatarURL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save profile"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":         "completed",
			"profile":        publicUser(user),
			"token":          signUserToken(user),
			"avatarUploaded": avatarUploaded,
			"passwordSet":    true,
		})
	}
}

func updateProfile(dataStore *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "profile request is too large"})
			return
		}

		email := authUser.Email
		firstName := strings.TrimSpace(c.PostForm("firstName"))
		lastName := strings.TrimSpace(c.PostForm("lastName"))

		if _, err := mail.ParseAddress(email); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
			return
		}
		if firstName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "first name is required"})
			return
		}

		avatarURL, avatarUploaded, err := avatarDataURL(c, "avatar")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		user, err := dataStore.UpdateProfile(email, firstName, lastName, avatarURL)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "could not update profile"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":         "updated",
			"profile":        publicUser(user),
			"avatarUploaded": avatarUploaded,
		})
	}
}

func avatarDataURL(c *gin.Context, field string) (string, bool, error) {
	file, err := c.FormFile(field)
	if err != nil || file.Size <= 0 {
		return "", false, nil
	}
	if file.Size > 2<<20 {
		return "", false, fmt.Errorf("profile photo must be 2 MB or smaller")
	}
	if !strings.HasPrefix(file.Header.Get("Content-Type"), "image/") {
		return "", false, fmt.Errorf("profile photo must be an image")
	}

	source, err := file.Open()
	if err != nil {
		return "", false, fmt.Errorf("could not read profile photo")
	}
	defer source.Close()

	content, err := io.ReadAll(io.LimitReader(source, 2<<20))
	if err != nil {
		return "", false, fmt.Errorf("could not read profile photo")
	}
	mimeType := file.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content), true, nil
}

func publicUser(user store.User) gin.H {
	return gin.H{
		"id":        user.ID,
		"email":     user.Email,
		"firstName": user.FirstName,
		"lastName":  user.LastName,
		"avatarUrl": user.AvatarURL,
		"blocked":   user.Blocked,
		"createdAt": user.CreatedAt,
		"updatedAt": user.UpdatedAt,
	}
}

func registerContactRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("", accepted("list contacts"))
	group.POST("/requests", accepted("send contact request"))
	group.POST("/:id/block", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.BlockUser(authUser.Email, c.Param("id")); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "blocked"})
	})
	group.DELETE("/:id/block", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.UnblockUser(authUser.Email, c.Param("id")); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "unblocked"})
	})
	group.POST("/:id/report", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		var body struct {
			Reason    string `json:"reason"`
			MessageID string `json:"messageId"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		report, err := dataStore.CreateReport(authUser.Email, c.Param("id"), body.MessageID, body.Reason)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "reported", "report": report})
	})
}

func registerGroupRoutes(group *gin.RouterGroup) {
	group.POST("", accepted("create group"))
	group.GET("", accepted("list groups"))
	group.PATCH("/:id", accepted("rename group"))
	group.POST("/:id/members", accepted("invite group member"))
	group.DELETE("/:id/members/:userId", accepted("remove group member"))
}

func registerCallRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("/history", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		history, err := dataStore.GetCallHistory(authUser.ID, queryInt(c, "limit", 50))
		if err != nil {
			log.Printf("load call history failed user=%s: %v", authUser.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load call history"})
			return
		}

		results := make([]gin.H, 0, len(history))
		for _, call := range history {
			otherUserID := call.CallerID
			direction := "incoming"
			if call.CallerID == authUser.ID {
				otherUserID = call.RecipientID
				direction = "outgoing"
			}

			otherUser := gin.H{
				"id":        otherUserID,
				"name":      "Unknown user",
				"avatarUrl": "",
			}
			if user, err := dataStore.UserByID(otherUserID); err == nil {
				name := strings.TrimSpace(user.FirstName + " " + user.LastName)
				if name == "" {
					name = user.Email
				}
				otherUser = gin.H{
					"id":        user.ID,
					"name":      name,
					"avatarUrl": user.AvatarURL,
				}
			}

			callType := call.CallType
			if callType != "video" {
				callType = "audio"
			}

			results = append(results, gin.H{
				"id":              call.ID,
				"otherUser":       otherUser,
				"direction":       direction,
				"callType":        callType,
				"status":          call.Status,
				"startedAt":       call.StartedAt,
				"answeredAt":      call.AnsweredAt,
				"endedAt":         call.EndedAt,
				"durationSeconds": call.DurationSeconds,
			})
		}
		c.JSON(http.StatusOK, gin.H{"calls": results})
	})
}

func registerStatusRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	publicStatus := func(item store.StatusWithUser) gin.H {
		name := strings.TrimSpace(item.User.FirstName + " " + item.User.LastName)
		if name == "" {
			name = item.User.Email
		}
		return gin.H{
			"id": item.ID, "userId": item.UserID, "type": item.Type,
			"textContent": item.Text, "mediaUrl": item.MediaURL, "caption": item.Caption,
			"background": item.Background, "createdAt": item.CreatedAt, "expiresAt": item.ExpiresAt,
			"viewed": item.IsViewed,
			"user":   gin.H{"id": item.User.ID, "name": name, "avatarUrl": item.User.AvatarURL},
		}
	}
	publicStoredStatus := func(status store.Status, user store.User) gin.H {
		name := strings.TrimSpace(user.FirstName + " " + user.LastName)
		if name == "" {
			name = user.Email
		}
		return gin.H{
			"id": status.ID, "userId": status.UserID, "type": status.Type,
			"textContent": status.Text, "mediaUrl": status.MediaURL, "caption": status.Caption,
			"background": status.Background, "createdAt": status.CreatedAt, "expiresAt": status.ExpiresAt,
			"viewed": false,
			"user":   gin.H{"id": user.ID, "name": name, "avatarUrl": user.AvatarURL},
		}
	}
	list := func(c *gin.Context, ownerID string) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		statuses, err := dataStore.GetActiveStatuses(authUser.ID, ownerID, queryInt(c, "limit", 200))
		if err != nil {
			log.Printf("load statuses failed user=%s: %v", authUser.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load statuses"})
			return
		}
		result := make([]gin.H, 0, len(statuses))
		for _, item := range statuses {
			result = append(result, publicStatus(item))
		}
		c.JSON(http.StatusOK, gin.H{"statuses": result})
	}
	group.GET("", func(c *gin.Context) { list(c, "") })
	group.GET("/user/:id", func(c *gin.Context) { list(c, c.Param("id")) })
	group.POST("", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		var body struct {
			Type       string `json:"type"`
			Text       string `json:"textContent"`
			MediaURL   string `json:"mediaUrl"`
			Caption    string `json:"caption"`
			Background string `json:"background"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		body.Type = strings.ToLower(strings.TrimSpace(body.Type))
		body.Text, body.MediaURL, body.Caption, body.Background = strings.TrimSpace(body.Text), strings.TrimSpace(body.MediaURL), strings.TrimSpace(body.Caption), strings.TrimSpace(body.Background)
		if body.Type != "text" && body.Type != "image" && body.Type != "video" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status type must be text, image, or video"})
			return
		}
		if body.Type == "text" && body.Text == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "text content is required"})
			return
		}
		if body.Type != "text" && body.MediaURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "media is required"})
			return
		}
		if len([]rune(body.Text)) > 2000 || len([]rune(body.Caption)) > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status text is too long"})
			return
		}
		status, err := dataStore.CreateStatus(authUser.ID, body.Type, body.Text, body.MediaURL, body.Caption, body.Background)
		if err != nil {
			log.Printf("create status failed user=%s: %v", authUser.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create status"})
			return
		}
		user, err := dataStore.UserByID(authUser.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load status owner"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": publicStoredStatus(status, user)})
	})
	group.POST("/:id/view", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.MarkStatusViewed(c.Param("id"), authUser.ID); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "status not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "viewed"})
	})
	group.GET("/:id/viewers", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		viewers, err := dataStore.GetStatusViewers(c.Param("id"), authUser.ID)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "status not found"})
			return
		}
		result := make([]gin.H, 0, len(viewers))
		for _, viewer := range viewers {
			name := strings.TrimSpace(viewer.User.FirstName + " " + viewer.User.LastName)
			if name == "" {
				name = viewer.User.Email
			}
			result = append(result, gin.H{"user": gin.H{"id": viewer.User.ID, "name": name, "avatarUrl": viewer.User.AvatarURL}, "viewedAt": viewer.ViewedAt})
		}
		c.JSON(http.StatusOK, gin.H{"viewers": result})
	})
	group.DELETE("/:id", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.DeleteStatus(c.Param("id"), authUser.ID); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "status not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "deleted"})
	})
}

func registerMessageRoutes(group *gin.RouterGroup, dataStore *store.Store, hub *realtime.Hub) {
	group.GET("/inbox", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		messages, err := dataStore.ListInboxMessages(authUser.Email, queryInt(c, "limit", 200))
		if err != nil {
			log.Printf("load inbox failed user=%s: %v", authUser.Email, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load inbox"})
			return
		}
		results := make([]gin.H, 0, len(messages))
		for _, message := range messages {
			results = append(results, publicMessage(message, authUser.Email))
		}
		c.JSON(http.StatusOK, gin.H{"messages": results})
	})
	group.GET("/:recipientId", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		messages, err := dataStore.ListMessages(authUser.Email, c.Param("recipientId"), queryInt(c, "limit", 50))
		if err != nil {
			log.Printf("load messages failed user=%s recipient=%s: %v", authUser.Email, c.Param("recipientId"), err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load messages"})
			return
		}
		results := make([]gin.H, 0, len(messages))
		for _, message := range messages {
			results = append(results, publicMessage(message, authUser.Email))
		}
		c.JSON(http.StatusOK, gin.H{"messages": results})
	})
	group.POST("", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		var body struct {
			ID          string `json:"id"`
			RecipientID string `json:"recipientId"`
			Body        string `json:"body"`
			Attachment  struct {
				Name string `json:"name"`
				Type string `json:"type"`
				Kind string `json:"kind"`
				URL  string `json:"url"`
			} `json:"attachment"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if strings.TrimSpace(body.RecipientID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "recipient is required"})
			return
		}
		if strings.TrimSpace(body.Body) == "" && strings.TrimSpace(body.Attachment.Name) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "message is empty"})
			return
		}
		if body.ID != "" {
			if existingMsg, err := dataStore.MessageByID(body.ID); err == nil {
				c.JSON(http.StatusOK, gin.H{
					"message":           publicMessage(existingMsg, authUser.Email),
					"client_message_id": body.ID,
				})
				return
			}
		}
		message, err := dataStore.SaveMessage(body.ID, authUser.Email, body.RecipientID, body.Body, body.Attachment.Name, body.Attachment.Type, body.Attachment.Kind, body.Attachment.URL)
		if err != nil {
			log.Printf("save message failed sender=%s recipient=%s: %v", authUser.Email, body.RecipientID, err)
			if strings.Contains(err.Error(), "blocked") {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save message"})
			return
		}
		if sender, err := dataStore.UserByEmail(authUser.Email); err == nil {
			message.SenderID = sender.ID
		}
		if payload, err := json.Marshal(publicMessage(message, "")); err == nil {
			hub.Broadcast(realtime.Event{
				Type:           "chat.message",
				ConversationID: message.ConversationID,
				TargetUserIDs:  []string{message.SenderID, message.RecipientID},
				Payload:        payload,
			})
		}
		c.JSON(http.StatusOK, gin.H{
			"message":           publicMessage(message, authUser.Email),
			"client_message_id": body.ID,
		})
	})
	group.POST("/:recipientId/read", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.MarkConversationRead(authUser.Email, c.Param("recipientId")); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not mark messages read"})
			return
		}
		if recipient, err := dataStore.UserByID(c.Param("recipientId")); err == nil {
			left := authUser.ID
			right := recipient.ID
			var convID string
			if left < right {
				convID = left + ":" + right
			} else {
				convID = right + ":" + left
			}
			payload, _ := json.Marshal(map[string]string{
				"readerId":       authUser.ID,
				"conversationId": convID,
			})
			hub.Broadcast(realtime.Event{
				Type:           "chat.read",
				ConversationID: convID,
				TargetUserIDs:  []string{authUser.ID, recipient.ID},
				Payload:        payload,
			})
		}
		c.JSON(http.StatusOK, gin.H{"status": "read"})
	})
	group.PATCH("/:id", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		var body struct {
			Body string `json:"body"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Body) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "message body is required"})
			return
		}
		message, err := dataStore.UpdateMessage(authUser.Email, c.Param("id"), body.Body)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": publicMessage(message, authUser.Email)})
	})
	group.DELETE("/conversation/:recipientId", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.ClearConversation(authUser.Email, c.Param("recipientId")); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear conversation"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "cleared"})
	})
	group.DELETE("/:id", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		if err := dataStore.DeleteMessage(authUser.Email, c.Param("id")); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "deleted"})
	})
	group.POST("/typing", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		var body struct {
			RecipientID string `json:"recipientId"`
			Event       string `json:"event"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		recipient, err := dataStore.UserByID(body.RecipientID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
			return
		}
		left := authUser.ID
		right := recipient.ID
		var convID string
		if left < right {
			convID = left + ":" + right
		} else {
			convID = right + ":" + left
		}
		var eventType string
		if body.Event == "start" {
			eventType = "typing.start"
		} else {
			eventType = "typing.stop"
		}
		sender, err := dataStore.UserByEmail(authUser.Email)
		var userName string
		if err == nil {
			userName = sender.FirstName + " " + sender.LastName
		} else {
			userName = authUser.Email
		}
		payload, _ := json.Marshal(map[string]string{
			"userId":         authUser.ID,
			"userName":       userName,
			"conversationId": convID,
		})
		hub.Broadcast(realtime.Event{
			Type:           eventType,
			ConversationID: convID,
			TargetUserIDs:  []string{authUser.ID, recipient.ID},
			Payload:        payload,
		})
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	group.POST("/reactions/:id", accepted("react to message"))
}

func publicMessage(message store.Message, viewerEmail string) gin.H {
	result := gin.H{
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
		result["attachment"] = gin.H{
			"name": message.AttachmentName,
			"type": message.AttachmentType,
			"kind": message.AttachmentKind,
			"url":  message.AttachmentURL,
		}
	}
	return result
}

type CloudinaryResponse struct {
	SecureURL string `json:"secure_url"`
	PublicID  string `json:"public_id"`
	Error     *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func uploadToCloudinary(cloudName, apiKey, apiSecret, uploadPreset, kind, filename string, fileReader io.Reader) (string, string, error) {
	resourceType := "raw"
	if kind == "image" {
		resourceType = "image"
	} else if kind == "video" || kind == "audio" {
		resourceType = "video"
	}

	uploadURL := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/%s/upload", cloudName, resourceType)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	if uploadPreset != "" {
		if err := writer.WriteField("upload_preset", uploadPreset); err != nil {
			return "", "", err
		}
	}

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", "", err
	}
	if _, err := io.Copy(part, fileReader); err != nil {
		return "", "", err
	}

	if err := writer.Close(); err != nil {
		return "", "", err
	}

	req, err := http.NewRequest("POST", uploadURL, body)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.SetBasicAuth(apiKey, apiSecret)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", err
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var errResponse CloudinaryResponse
		_ = json.Unmarshal(respBytes, &errResponse)
		if errResponse.Error != nil {
			return "", "", fmt.Errorf("cloudinary upload failed (status %d): %s", resp.StatusCode, errResponse.Error.Message)
		}
		return "", "", fmt.Errorf("cloudinary upload failed with status %d: %s", resp.StatusCode, string(respBytes))
	}

	var uploadResult CloudinaryResponse
	if err := json.Unmarshal(respBytes, &uploadResult); err != nil {
		return "", "", err
	}

	if uploadResult.SecureURL == "" {
		return "", "", fmt.Errorf("cloudinary response missing secure_url")
	}

	return uploadResult.SecureURL, uploadResult.PublicID, nil
}

func deleteFromCloudinary(cloudName, apiKey, apiSecret, kind, publicID string) error {
	resourceType := "raw"
	if kind == "image" {
		resourceType = "image"
	} else if kind == "video" || kind == "audio" {
		resourceType = "video"
	}

	destroyURL := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/%s/destroy", cloudName, resourceType)
	timestamp := fmt.Sprintf("%d", time.Now().Unix())

	signStr := fmt.Sprintf("public_id=%s&timestamp=%s%s", publicID, timestamp, apiSecret)
	hash := sha1.New()
	hash.Write([]byte(signStr))
	signature := hex.EncodeToString(hash.Sum(nil))

	data := url.Values{}
	data.Set("public_id", publicID)
	data.Set("timestamp", timestamp)
	data.Set("api_key", apiKey)
	data.Set("signature", signature)

	resp, err := http.PostForm(destroyURL, data)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cloudinary destroy failed (status %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func optimizeCloudinaryURL(rawURL string, kind string, size int64, cfg config.Config) string {
	// Only optimize images and videos
	if kind != "image" && kind != "video" {
		return rawURL
	}
	if !strings.Contains(rawURL, "cloudinary.com") {
		return rawURL
	}

	// Check if file is large enough to warrant optimization
	isLarge := false
	var transformStr string
	if kind == "image" && size > cfg.ImageOptimizeThresholdBytes {
		isLarge = true
		transformStr = fmt.Sprintf("f_auto,q_auto,c_limit,w_%d,h_%d", cfg.ImageMaxDimension, cfg.ImageMaxDimension)
	} else if kind == "video" && size > cfg.VideoOptimizeThresholdBytes {
		isLarge = true
		transformStr = fmt.Sprintf("f_auto,q_auto,c_limit,w_%d,h_%d", cfg.VideoMaxDimension, cfg.VideoMaxDimension)
	}

	if !isLarge {
		return rawURL
	}

	// Insert transformation string right after "/upload/" in the Cloudinary URL
	// A typical URL is: https://res.cloudinary.com/<cloud>/<resource_type>/upload/v<version>/<public_id>
	const uploadMarker = "/upload/"
	idx := strings.Index(rawURL, uploadMarker)
	if idx == -1 {
		return rawURL
	}

	insertIdx := idx + len(uploadMarker)
	return rawURL[:insertIdx] + transformStr + "/" + rawURL[insertIdx:]
}

func registerUploadRoutes(group *gin.RouterGroup, cfg config.Config, dataStore *store.Store) {
	group.POST("", func(c *gin.Context) {
		authUser, ok := requireUser(c)
		if !ok {
			return
		}
		file, err := c.FormFile("file")
		if err != nil || file.Size <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
			return
		}

		maxUploadBytes := int64(cfg.MaxUploadSizeMB) << 20
		if file.Size > maxUploadBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("file must be %d MB or smaller", cfg.MaxUploadSizeMB)})
			return
		}

		source, err := file.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
			return
		}
		defer source.Close()

		contentType := file.Header.Get("Content-Type")
		if contentType == "" || contentType == "application/octet-stream" {
			if inferred := mime.TypeByExtension(strings.ToLower(filepath.Ext(file.Filename))); inferred != "" {
				contentType = inferred
			}
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		kind := "file"
		if strings.HasPrefix(contentType, "image/") {
			kind = "image"
		} else if strings.HasPrefix(contentType, "video/") {
			kind = "video"
		} else if strings.HasPrefix(contentType, "audio/") {
			kind = "audio"
		}

		if cfg.CloudinaryCloudName != "" && cfg.CloudinaryAPIKey != "" && cfg.CloudinaryAPISecret != "" {
			// Streaming directly from file without buffering into []byte first
			uploadReader := io.LimitReader(source, maxUploadBytes)
			cloudinaryURL, cloudinaryPublicID, err := uploadToCloudinary(
				cfg.CloudinaryCloudName,
				cfg.CloudinaryAPIKey,
				cfg.CloudinaryAPISecret,
				cfg.CloudinaryUploadPreset,
				kind,
				file.Filename,
				uploadReader,
			)
			if err != nil {
				log.Printf("cloudinary upload failed user=%s name=%s size=%d: %v", authUser.Email, file.Filename, file.Size, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not upload file to cloud storage"})
				return
			}

			// Apply Cloudinary Dynamic URL transformations for optimization on delivery if size exceeds threshold
			cloudinaryURL = optimizeCloudinaryURL(cloudinaryURL, kind, file.Size, cfg)

			_, err = dataStore.SaveCloudinaryAttachment(
				authUser.Email,
				file.Filename,
				contentType,
				kind,
				file.Size,
				cloudinaryURL,
				cloudinaryPublicID,
			)
			if err != nil {
				log.Printf("save cloudinary attachment metadata failed user=%s name=%s: %v", authUser.Email, file.Filename, err)
				go func() {
					if delErr := deleteFromCloudinary(cfg.CloudinaryCloudName, cfg.CloudinaryAPIKey, cfg.CloudinaryAPISecret, kind, cloudinaryPublicID); delErr != nil {
						log.Printf("failed to clean up orphaned Cloudinary asset %s: %v", cloudinaryPublicID, delErr)
					}
				}()
				if strings.Contains(strings.ToLower(err.Error()), "user not found") {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "login expired. Please sign in again"})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save file metadata"})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"name": file.Filename,
				"type": contentType,
				"kind": kind,
				"url":  cloudinaryURL,
			})
			return
		}

		// Fallback to local DB storage
		content, err := io.ReadAll(io.LimitReader(source, maxUploadBytes+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
			return
		}
		if int64(len(content)) > maxUploadBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("file must be %d MB or smaller", cfg.MaxUploadSizeMB)})
			return
		}

		attachment, err := dataStore.SaveAttachment(authUser.Email, file.Filename, contentType, kind, content)
		if err != nil {
			log.Printf("save attachment failed user=%s name=%s size=%d: %v", authUser.Email, file.Filename, file.Size, err)
			if strings.Contains(strings.ToLower(err.Error()), "user not found") {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "login expired. Please sign in again"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save file"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"name": file.Filename,
			"type": contentType,
			"kind": kind,
			"url":  "attachment:" + attachment.ID,
		})
	})
}

func registerFileRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("/:id", func(c *gin.Context) {
		token := c.Query("token")
		if token == "" {
			token = strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
		}
		authUser, ok := authUserFromToken(token)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
			return
		}
		attachment, err := dataStore.AttachmentByID(authUser.Email, c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		if attachment.CloudinaryURL != "" {
			c.Redirect(http.StatusFound, attachment.CloudinaryURL)
			return
		}
		c.Header("Cache-Control", "private, max-age=300")
		c.Header("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, safeFilename(attachment.Name)))
		c.Data(http.StatusOK, attachment.ContentType, attachment.Content)
	})
}

// registerAIRoutes wires the Gemini-powered AI assistant endpoint. The Gemini
// client is created here so the API key only ever lives on the backend.
func registerAIRoutes(group *gin.RouterGroup, cfg config.Config, dataStore *store.Store) {
	if strings.TrimSpace(cfg.GeminiAPIKey) == "" {
		// No key configured: register a stub that returns 503 so the endpoint
		// exists but never attempts to contact Gemini.
		group.POST("/chat", func(c *gin.Context) {
			if _, ok := requireUser(c); !ok {
				return
			}
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI assistant is not configured"})
		})
		return
	}
	caller := gemini.New(
		cfg.GeminiAPIKey,
		cfg.GeminiModel,
		cfg.GeminiMaxOutputTokens,
		time.Duration(cfg.GeminiTimeoutSeconds)*time.Second,
	)
	newAIHandler(cfg, dataStore, caller).register(group)
}

func registerAdminRoutes(group *gin.RouterGroup, cfg config.Config, dataStore *store.Store) {
	group.POST("/login", func(c *gin.Context) {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if !strings.EqualFold(strings.TrimSpace(body.Email), cfg.AdminEmail) || body.Password != cfg.AdminPassword {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid admin credentials"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "token": signAdminToken(cfg.AdminEmail)})
	})

	protected := group.Group("")
	protected.Use(requireAdmin())
	protected.GET("/users", func(c *gin.Context) {
		users := dataStore.AllUsers()
		results := make([]gin.H, 0, len(users))
		for _, user := range users {
			results = append(results, publicUser(user))
		}
		c.JSON(http.StatusOK, gin.H{"users": results})
	})
	protected.DELETE("/users/:id", func(c *gin.Context) {
		if !dataStore.DeleteUser(c.Param("id")) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "deleted"})
	})
	protected.POST("/users/:id/block", func(c *gin.Context) {
		user, ok := dataStore.SetUserBlocked(c.Param("id"), true)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "blocked", "user": publicUser(user)})
	})
	protected.POST("/users/:id/unblock", func(c *gin.Context) {
		user, ok := dataStore.SetUserBlocked(c.Param("id"), false)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "unblocked", "user": publicUser(user)})
	})
	protected.GET("/reports", func(c *gin.Context) {
		reports, err := dataStore.ListReports()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load reports"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"reports": reports})
	})
	protected.POST("/reports/:id/resolve", func(c *gin.Context) {
		if err := dataStore.ResolveReport(c.Param("id")); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "resolved"})
	})
}

func requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
		if !validAdminToken(token) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "admin login required"})
			c.Abort()
			return
		}
		c.Next()
	}
}

type authUser struct {
	ID    string
	Email string
}

var revokedTokens = struct {
	sync.Mutex
	values map[string]time.Time
}{values: map[string]time.Time{}}

func requireUser(c *gin.Context) (authUser, bool) {
	header := c.GetHeader("Authorization")
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	user, ok := authUserFromToken(token)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		c.Abort()
		return authUser{}, false
	}
	return user, true
}

func signUserToken(user store.User) string {
	payload := user.ID + "|" + user.Email + "|" + strconv.FormatInt(time.Now().Add(tokenTTL()).Unix(), 10)
	signature := signPayload(payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + signature))
}

func authUserFromToken(token string) (authUser, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return authUser{}, false
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 4 {
		return authUser{}, false
	}
	payload := parts[0] + "|" + parts[1] + "|" + parts[2]
	if !hmac.Equal([]byte(parts[3]), []byte(signPayload(payload))) {
		return authUser{}, false
	}
	expiresAt, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || time.Now().Unix() > expiresAt || tokenRevoked(token) {
		return authUser{}, false
	}
	return authUser{ID: parts[0], Email: normalizeEmail(parts[1])}, true
}

func signAdminToken(email string) string {
	payload := "admin|" + strings.ToLower(strings.TrimSpace(email)) + "|" + strconv.FormatInt(time.Now().Add(tokenTTL()).Unix(), 10)
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + signPayload(payload)))
}

func validAdminToken(token string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return false
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 4 || parts[0] != "admin" {
		return false
	}
	payload := parts[0] + "|" + parts[1] + "|" + parts[2]
	if !hmac.Equal([]byte(parts[3]), []byte(signPayload(payload))) {
		return false
	}
	expiresAt, err := strconv.ParseInt(parts[2], 10, 64)
	return err == nil && time.Now().Unix() <= expiresAt
}

func tokenTTL() time.Duration {
	hours, err := strconv.Atoi(os.Getenv("AUTH_TOKEN_TTL_HOURS"))
	if err != nil || hours <= 0 {
		hours = 168
	}
	return time.Duration(hours) * time.Hour
}

func tokenRevoked(token string) bool {
	revokedTokens.Lock()
	defer revokedTokens.Unlock()
	expiresAt, ok := revokedTokens.values[token]
	if ok && time.Now().Before(expiresAt) {
		return true
	}
	if ok {
		delete(revokedTokens.values, token)
	}
	return false
}

func revokeToken(token string) {
	if strings.TrimSpace(token) == "" {
		return
	}
	revokedTokens.Lock()
	revokedTokens.values[token] = time.Now().Add(tokenTTL())
	revokedTokens.Unlock()
}

func queryInt(c *gin.Context, key string, fallback int) int {
	value, err := strconv.Atoi(c.Query(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func safeFilename(name string) string {
	name = strings.ReplaceAll(name, `"`, "")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	name = strings.TrimSpace(name)
	if name == "" {
		return "attachment"
	}
	return name
}

func signPayload(payload string) string {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		secret = "chatsphere-local-auth-secret"
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func accepted(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusAccepted, gin.H{
			"action": action,
			"status": "stubbed",
			"next":   "connect service layer, validation, persistence, and auth middleware",
		})
	}
}
