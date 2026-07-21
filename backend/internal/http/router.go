package http

import (
	"net/http"
	"time"

	"chatsphere/backend/internal/config"
	"chatsphere/backend/internal/realtime"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config, hub *realtime.Hub) *gin.Engine {
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
	registerAuthRoutes(api.Group("/auth"))
	registerUserRoutes(api.Group("/users"))
	registerProfileRoutes(api.Group("/profile"))
	registerContactRoutes(api.Group("/contacts"))
	registerGroupRoutes(api.Group("/groups"))
	registerMessageRoutes(api.Group("/messages"))
	registerUploadRoutes(api.Group("/upload"))
	registerAdminRoutes(api.Group("/admin"))

	return router
}

func registerAuthRoutes(group *gin.RouterGroup) {
	group.POST("/register", accepted("register user"))
	group.POST("/login", accepted("login user"))
	group.POST("/refresh", accepted("refresh token"))
	group.POST("/logout", accepted("logout user"))
	group.POST("/forgot-password", accepted("start password reset"))
}

func registerUserRoutes(group *gin.RouterGroup) {
	group.GET("", accepted("search users"))
	group.GET("/:id", accepted("get user"))
}

func registerProfileRoutes(group *gin.RouterGroup) {
	group.GET("", accepted("get profile"))
	group.PATCH("", accepted("update profile"))
	group.PATCH("/privacy", accepted("update privacy"))
	group.PATCH("/status", accepted("update status"))
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
