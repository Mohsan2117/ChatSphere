package http

import (
	"net/http"
	"net/mail"
	"strings"
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
		realtime.Serve(c.Writer, c.Request, hub)
	})

	api := router.Group("/api/v1")
	registerAuthRoutes(api.Group("/auth"), cfg, dataStore)
	registerUserRoutes(api.Group("/users"), dataStore)
	registerProfileRoutes(api.Group("/profile"), dataStore)
	registerContactRoutes(api.Group("/contacts"))
	registerGroupRoutes(api.Group("/groups"))
	registerMessageRoutes(api.Group("/messages"), dataStore)
	registerUploadRoutes(api.Group("/upload"))
	registerAdminRoutes(api.Group("/admin"), dataStore)

	return router
}

func registerAuthRoutes(group *gin.RouterGroup, cfg config.Config, dataStore *store.Store) {
	newEmailAuthHandler(cfg).register(group)
	group.POST("/register", accepted("register user"))
	group.POST("/login", loginUser(dataStore))
	group.POST("/refresh", accepted("refresh token"))
	group.POST("/logout", accepted("logout user"))
	group.POST("/forgot-password", accepted("start password reset"))
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
		})
	}
}

func registerUserRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("", func(c *gin.Context) {
		query := c.Query("q")
		users := dataStore.SearchUsers(query)
		results := make([]gin.H, 0, len(users))
		for _, user := range users {
			results = append(results, publicUser(user))
		}
		c.JSON(http.StatusOK, gin.H{"users": results})
	})
	group.GET("/:id", accepted("get user"))
}

func registerProfileRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("", accepted("get profile"))
	group.POST("/onboarding", completeOnboarding(dataStore))
	group.PATCH("", accepted("update profile"))
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

		avatarURL := ""
		avatarUploaded := false
		file, err := c.FormFile("avatar")
		if err == nil && file.Size > 0 {
			avatarUploaded = true
			avatarURL = "uploaded:" + file.Filename
		}

		user, err := dataStore.UpsertUser(email, firstName, lastName, password, avatarURL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save profile"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":         "completed",
			"profile":        publicUser(user),
			"avatarUploaded": avatarUploaded,
			"passwordSet":    true,
		})
	}
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

func registerContactRoutes(group *gin.RouterGroup) {
	group.GET("", accepted("list contacts"))
	group.POST("/requests", accepted("send contact request"))
	group.POST("/:id/block", accepted("block contact"))
	group.DELETE("/:id/block", accepted("unblock contact"))
}

func registerGroupRoutes(group *gin.RouterGroup) {
	group.POST("", accepted("create group"))
	group.GET("", accepted("list groups"))
	group.PATCH("/:id", accepted("rename group"))
	group.POST("/:id/members", accepted("invite group member"))
	group.DELETE("/:id/members/:userId", accepted("remove group member"))
}

func registerMessageRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.GET("/:recipientId", func(c *gin.Context) {
		email := normalizeEmail(c.Query("email"))
		if _, err := mail.ParseAddress(email); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
			return
		}
		messages, err := dataStore.ListMessages(email, c.Param("recipientId"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load messages"})
			return
		}
		results := make([]gin.H, 0, len(messages))
		for _, message := range messages {
			results = append(results, publicMessage(message, email))
		}
		c.JSON(http.StatusOK, gin.H{"messages": results})
	})
	group.POST("", func(c *gin.Context) {
		var body struct {
			SenderEmail string `json:"senderEmail"`
			RecipientID string `json:"recipientId"`
			Body        string `json:"body"`
			Attachment  struct {
				Name string `json:"name"`
				Type string `json:"type"`
				Kind string `json:"kind"`
			} `json:"attachment"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		email := normalizeEmail(body.SenderEmail)
		if _, err := mail.ParseAddress(email); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sender email is required"})
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
		message, err := dataStore.SaveMessage(email, body.RecipientID, body.Body, body.Attachment.Name, body.Attachment.Type, body.Attachment.Kind)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save message"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": publicMessage(message, email)})
	})
	group.PATCH("/:id", accepted("edit message"))
	group.DELETE("/:id", accepted("delete message"))
	group.POST("/:id/reactions", accepted("react to message"))
}

func publicMessage(message store.Message, viewerEmail string) gin.H {
	result := gin.H{
		"id":          message.ID,
		"body":        message.Body,
		"time":        message.CreatedAt.Format("3:04 PM"),
		"mine":        strings.EqualFold(message.SenderEmail, viewerEmail),
		"senderEmail": message.SenderEmail,
		"createdAt":   message.CreatedAt,
	}
	if message.AttachmentName != "" {
		result["attachment"] = gin.H{
			"name": message.AttachmentName,
			"type": message.AttachmentType,
			"kind": message.AttachmentKind,
			"url":  "",
		}
	}
	return result
}

func registerUploadRoutes(group *gin.RouterGroup) {
	group.POST("", accepted("create signed upload"))
}

func registerAdminRoutes(group *gin.RouterGroup, dataStore *store.Store) {
	group.POST("/login", func(c *gin.Context) {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if strings.TrimSpace(body.Email) != "ChatSphere" || body.Password != "1234123" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid admin credentials"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "token": "chatsphere-admin-session"})
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
	protected.GET("/reports", accepted("list moderation reports"))
	protected.POST("/reports/:id/resolve", accepted("resolve report"))
}

func requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Authorization") != "Bearer chatsphere-admin-session" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "admin login required"})
			c.Abort()
			return
		}
		c.Next()
	}
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
