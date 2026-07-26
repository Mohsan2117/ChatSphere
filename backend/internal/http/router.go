package http

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"chatsphere/backend/internal/config"
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
	router.Use(gin.Logger(), gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.FrontendOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	healthHandler := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "chatsphere-api"})
	}
	router.GET("/", healthHandler)
	router.GET("/health", healthHandler)
	router.GET("/ws", func(c *gin.Context) {
		user, ok := authUserFromToken(c.Query("token"))
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
			return
		}
		realtime.Serve(c.Writer, c.Request, hub, user.ID)
	})

	api := router.Group("/api/v1")
	registerAuthRoutes(api.Group("/auth"), cfg, dataStore)
	registerUserRoutes(api.Group("/users"), dataStore, hub)
	registerProfileRoutes(api.Group("/profile"), dataStore)
	registerContactRoutes(api.Group("/contacts"), dataStore)
	registerGroupRoutes(api.Group("/groups"))
	registerMessageRoutes(api.Group("/messages"), dataStore, hub)
	registerUploadRoutes(api.Group("/upload"), dataStore)
	registerFileRoutes(api.Group("/files"), dataStore)
	registerAdminRoutes(api.Group("/admin"), cfg, dataStore)

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
		message, err := dataStore.SaveMessage(authUser.Email, body.RecipientID, body.Body, body.Attachment.Name, body.Attachment.Type, body.Attachment.Kind, body.Attachment.URL)
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
		c.JSON(http.StatusOK, gin.H{"message": publicMessage(message, authUser.Email)})
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

func registerUploadRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	const maxUploadBytes int64 = 10 << 20
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
		if file.Size > maxUploadBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file must be 10 MB or smaller"})
			return
		}
		source, err := file.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
			return
		}
		defer source.Close()
		content, err := io.ReadAll(io.LimitReader(source, maxUploadBytes+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
			return
		}
		if int64(len(content)) > maxUploadBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file must be 10 MB or smaller"})
			return
		}
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
		c.Header("Cache-Control", "private, max-age=300")
		c.Header("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, safeFilename(attachment.Name)))
		c.Data(http.StatusOK, attachment.ContentType, attachment.Content)
	})
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
