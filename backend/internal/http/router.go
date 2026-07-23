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
	registerUserRoutes(api.Group("/users"))
	registerProfileRoutes(api.Group("/profile"), dataStore)
	registerContactRoutes(api.Group("/contacts"))
	registerGroupRoutes(api.Group("/groups"))
	registerMessageRoutes(api.Group("/messages"))
	registerUploadRoutes(api.Group("/upload"))
	registerAdminRoutes(api.Group("/admin"))

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

func registerUserRoutes(group *gin.RouterGroup) {
	group.GET("", accepted("search users"))
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

func registerMessageRoutes(group *gin.RouterGroup) {
	group.GET("/:conversationId", accepted("list messages"))
	group.POST("", accepted("create message"))
	group.PATCH("/:id", accepted("edit message"))
	group.DELETE("/:id", accepted("delete message"))
	group.POST("/:id/reactions", accepted("react to message"))
}

func registerUploadRoutes(group *gin.RouterGroup) {
	group.POST("", accepted("create signed upload"))
}

func registerAdminRoutes(group *gin.RouterGroup) {
	group.GET("/reports", accepted("list moderation reports"))
	group.POST("/reports/:id/resolve", accepted("resolve report"))
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
