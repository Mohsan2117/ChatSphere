# ChatSphere Backend Architecture & Learning Guide

This document is a backend-focused teaching guide for the current ChatSphere project. It is closer to a Software Design Document, Technical Design Document, System Architecture Document, and Developer Learning Guide than a short README.

It is not an SRS. A Software Requirements Specification describes what a system must do from a product and stakeholder point of view. This guide explains how ChatSphere is currently built, why each backend concept exists, where to find it in the code, and what to study if you want to understand or improve it.

Source of truth: the current repository code, especially `backend/`, `frontend/src/components/`, `frontend/src/lib/`, deployment config, and the Android WebView wrapper.

## 1. Big-Picture Architecture

ChatSphere is a realtime messaging application with a Next.js frontend, a Go/Gin backend, PostgreSQL persistence, WebSocket realtime delivery, WebRTC calling, Cloudinary-backed media storage, Brevo email OTP delivery, and Gemini-powered AI chat.

```text
Browser / Android WebView
        |
        v
Next.js Frontend
        |
        +---- HTTP REST API ----> Go/Gin Backend
        |                         |
        |                         +---- PostgreSQL via pgxpool
        |                         +---- optional MySQL legacy path
        |                         +---- JSON file fallback when no DB URL
        |                         +---- Cloudinary media API
        |                         +---- Brevo email API
        |                         +---- Gemini API
        |
        +---- WebSocket --------> Realtime Hub in Go
        |                         |
        |                         +---- direct/group chat events
        |                         +---- presence events
        |                         +---- typing/read/reaction/edit/delete events
        |                         +---- WebRTC signaling events
        |
        +---- WebRTC -----------> peer-to-peer audio/video media
                                  |
                                  +---- Google STUN
                                  +---- Metered TURN when configured
```

The backend normally does not carry call audio/video. It carries signaling messages so browsers can establish `RTCPeerConnection` sessions. The actual media travels peer-to-peer when possible, or through TURN when needed.

Important source files:

- `backend/cmd/server/main.go`
- `backend/internal/config/config.go`
- `backend/internal/http/router.go`
- `backend/internal/http/email_auth.go`
- `backend/internal/http/ai.go`
- `backend/internal/realtime/hub.go`
- `backend/internal/realtime/client.go`
- `backend/internal/store/store.go`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/components/AudioCall.tsx`
- `frontend/src/lib/webrtcConfig.ts`
- `ChatSphere_Android/app/src/main/java/com/chatsphere/app/MainActivity.kt`

## 2. Backend Tech Stack

| Technology | Where Used | Why Used | Alternatives | What To Learn |
|---|---|---|---|---|
| Go | Entire backend | Fast compiled server, strong standard library, simple concurrency | Node.js, Java, C#, Python | packages, structs, methods, errors, goroutines |
| Gin | `internal/http/router.go`, `ai.go`, `email_auth.go` | HTTP routing, JSON binding, middleware | Echo, Fiber, chi, net/http | routes, handlers, middleware, context |
| Gorilla WebSocket | `internal/realtime/client.go` | Upgrades HTTP to persistent WebSocket connections | nhooyr/websocket, raw net/http | upgrade, read/write pumps, ping/pong |
| PostgreSQL | `internal/store/store.go` | Main relational database | MySQL, SQLite, MongoDB | tables, indexes, constraints, SQL |
| pgx/pgxpool | `store.New`, migrations, queries | PostgreSQL driver and connection pool | lib/pq, database/sql | pooling, context, Scan |
| database/sql | MySQL legacy path in store | Standard SQL interface | pgx-only, ORM | QueryRow, ExecContext, Rows |
| bcrypt | `UpsertUser`, `Authenticate`, `UpdatePassword` | Password hashing | Argon2id, scrypt | hashes, salts, cost |
| HMAC tokens | `signUserToken`, `authUserFromToken`, `signPayload` | Stateless signed auth tokens | JWT library, sessions | HMAC, token expiry, constant-time compare |
| REST APIs | `router.go` | CRUD and request/response workflows | GraphQL, RPC | methods, status codes, bodies |
| JSON | handlers and realtime events | Frontend/backend data format | protobuf, MessagePack | struct tags, marshaling |
| multipart/form-data | profile photos and file upload | Browser file upload format | direct-to-cloud upload | form parsing, size limits |
| WebSocket | `/ws`, realtime hub | Low-latency bidirectional events | SSE, polling | persistent connections |
| WebRTC signaling | `client.go`, `AudioCall.tsx` | Real-time calls | hosted call SDKs | offer, answer, ICE |
| STUN/TURN | `frontend/src/lib/webrtcConfig.ts` | NAT traversal | Twilio/Neynar/other RTC infra | NAT, relay, ICE |
| Cloudinary | upload handlers | CDN media hosting and transformations | S3, R2, Firebase Storage | public IDs, resource types |
| Brevo | `email_auth.go` | Sends OTP/password reset email | SendGrid, SES, Mailgun | email API, rate limiting |
| Gemini API | `internal/gemini`, `ai.go` | AI assistant | OpenAI, Anthropic, local LLM | backend-only secrets, quota |
| Environment variables | `config.go`, `.env.example` | Config without hard-coding secrets | config files, secret manager | 12-factor config |
| CORS | `NewRouter` | Allows frontend origin to call backend | same-origin deployment | browser origins |
| Middleware | Gin logger, recovery, CORS, admin auth | Cross-cutting request behavior | manual checks | request pipelines |
| Rate limiting | email code store, AI handler | Abuse protection | Redis-backed limiters | sliding windows, cooldowns |
| Goroutines/channels/mutexes | realtime hub, email/AI maps | Concurrent realtime server | actor systems, queues | synchronization |
| Testing packages | `_test.go` files | Integration/unit tests | Ginkgo, testify | httptest, fake clients |
| ID generation | `randomID()` | Unique entity IDs | UUID package, ULID | crypto randomness |
| time handling | TTLs, status expiry, call duration | Expiration and ordering | external scheduler | `time.Time`, UTC, durations |

## 3. Go Fundamentals Used

Packages split the backend by responsibility: `config`, `http`, `store`, `realtime`, `gemini`, and `cmd/server`. This keeps startup, routing, persistence, realtime, and external AI calls separate.

Structs model data and services. Examples: `store.User`, `store.Message`, `realtime.Hub`, `realtime.Event`, and `config.Config`.

Interfaces appear in `backend/internal/http/ai.go` with `geminiCaller`. This lets tests pass a fake Gemini implementation without network calls.

Pointers are used when data may be optional or large: `*store.Store`, `*realtime.Hub`, `*time.Time`, `*MessageReply`, `*gin.Context`.

Methods attach behavior to structs: `func (s *Store) SaveMessage(...)`, `func (h *Hub) Run()`, `func (c *Client) readPump()`.

Slices are used for lists of users, messages, group members, reactions, call histories, and event targets.

Maps are used for in-memory state: token revocation, OTP codes, email request timestamps, online counts, last-seen state, call sessions, AI cooldowns, and IP rate windows.

Errors are returned from store methods and translated into HTTP responses by handlers. For example, blocked messaging returns forbidden behavior, and missing messages return not found behavior.

JSON tags control API field names, such as `json:"replyToMessageId"` and `json:"deletedForEveryoneAt,omitempty"`.

Context appears in DB calls and HTTP request handling, especially with `context.Background()` and timeout checks in `/health`.

Goroutines run the realtime hub, per-WebSocket read/write loops, delayed disconnect cleanup, Cloudinary cleanup, and call history writes.

Channels power the realtime hub: `register`, `unregister`, `broadcast`, and per-client `send`.

Mutex/RWMutex protects shared state. `Hub.mu` protects online, lastSeen, and call maps. `Store.mu` protects JSON fallback data. Email and AI handlers use mutexes for in-memory rate maps.

`defer` appears for cleanup: request body close, file close, unlocking mutexes, cancelling contexts, closing WebSocket connections.

`time.Time` is central for tokens, OTP expiry, status expiry, read/edit/delete timestamps, call history, AI windows, and last seen.

HTTP handlers are Gin handler functions that validate input, call the store, broadcast realtime events where needed, and return JSON.

Dependency injection is simple constructor passing: `main.go` loads config, creates store and hub, then calls `NewRouter(cfg, hub, dataStore)`.

SQL scanning appears throughout `store.go`: rows are queried, then `Scan` fills Go variables and structs.

## 4. Backend Folder Structure

`backend/cmd/server/`

- Starts the application.
- Loads config.
- Logs Brevo/Gemini/Cloudinary configuration without exposing secrets.
- Creates the store and realtime hub.
- Starts Gin on `PORT`.

`backend/cmd/keepalive/`

- Small PostgreSQL connectivity check using `DATABASE_URL`.
- Useful for hosted environments that need DB keepalive behavior.

`backend/internal/config/`

- Loads `.env`.
- Reads environment variables into `Config`.
- Provides integer parsing helpers and defaults.

`backend/internal/http/`

- Defines REST routes, auth token helpers, upload handlers, admin routes, email OTP routes, and AI route wiring.
- Main files: `router.go`, `email_auth.go`, `ai.go`.

`backend/internal/store/`

- Data access and persistence.
- Holds database migrations, data structs, SQL queries, JSON fallback behavior, reactions, replies, edits, deletes, stars, calls, statuses, groups, blocks, reports, and AI usage.

`backend/internal/realtime/`

- WebSocket hub and client pumps.
- Tracks online users, last seen, call sessions, and broadcasts events.

`backend/internal/gemini/`

- Calls Gemini API with ChatSphere system instruction, generation config, timeout, and safe errors.

`backend/internal/models/`

- Additional model structs. The active persistence models mostly live in `store.go`.

## 5. Request Lifecycle

Login:

1. Frontend posts email/password to `POST /api/v1/auth/login`.
2. Handler validates JSON.
3. Store authenticates by normalized email.
4. bcrypt compares plaintext password to stored hash.
5. Blocked users are rejected.
6. Handler signs an HMAC token with user ID, email, and expiry.
7. Frontend stores the token and sends it as `Authorization: Bearer ...`.

Profile update:

1. Frontend sends multipart form to `PATCH /api/v1/profile`.
2. `requireUser` verifies token.
3. Handler parses first/last name and optional avatar.
4. Built-in avatar paths are validated against the approved list.
5. Uploaded avatar is encoded as a data URL for profile photo storage.
6. Store updates `app_users`.

Send direct message:

1. Frontend sends via WebSocket `message_send` or HTTP `POST /api/v1/messages`.
2. Backend validates recipient/body/attachment.
3. Store validates sender, recipient, blocking, reply target, and idempotent client ID.
4. Message is inserted in `messages`.
5. Backend broadcasts `chat.message` to sender and recipient.
6. Sender receives `message_sent` ack on WebSocket.

Send group message:

1. Frontend sends `group_message_send` over WebSocket or `POST /api/v1/groups/:id/messages`.
2. Store verifies sender is a group member.
3. Reply target must belong to the same group.
4. Message is stored in `group_messages`.
5. Backend loads group members and broadcasts `group.message` to them.

Reaction:

1. Frontend posts emoji to direct or group reaction endpoint.
2. Backend accepts only the configured emoji set.
3. Store verifies access and message visibility.
4. Existing same emoji toggles off; different emoji replaces prior reaction.
5. Recomputed reaction summaries are returned and broadcast as `message.reaction`.

Reply:

1. Frontend sends `replyToMessageId`.
2. Store checks original message exists in the same conversation/group.
3. Message stores only the reference ID.
4. List endpoints resolve a quote preview into `replyTo`.
5. If original is deleted for everyone, quote is marked unavailable/scrubbed.

Edit:

1. Frontend sends `PATCH` with new body.
2. Store verifies sender ownership.
3. Attachment-only or deleted messages are not editable.
4. Body updates, `edited_at` is set.
5. Backend broadcasts `message.edited`.

Delete:

1. Delete for Me inserts into `message_deletions` for the current user and removes that user's star.
2. Delete for Everyone verifies sender ownership.
3. Message becomes a tombstone with `deleted_for_everyone_at/by`.
4. Reactions and stars for that message are removed.
5. Backend broadcasts `message.deleted`.

Star:

1. Frontend calls direct or group star endpoint.
2. Store verifies the user can access the message.
3. Star is inserted into `starred_messages`.
4. Stars are private per user and are read back as `isStarred`.

Status creation:

1. Frontend posts type/text/media to `POST /api/v1/statuses`.
2. Backend validates type and length.
3. Store inserts a status with `expires_at` about 24 hours later.
4. Listing filters active statuses.
5. Views are recorded in `status_views`.

Call history:

1. WebSocket call signaling creates/updates in-memory call sessions.
2. Initial `call_offer` creates `call_history` asynchronously.
3. `call_answer`, `call_reject`, and `call_end` update status/timestamps.
4. Frontend lists calls via `GET /api/v1/calls/history`.

AI request:

1. Frontend posts to `POST /api/v1/ai/chat`.
2. Backend authenticates, validates message length, checks cooldown, IP limit, and daily quota.
3. Store atomically reserves AI usage.
4. Gemini is called server-side.
5. On Gemini failure, usage is refunded.

## 6. REST API Fundamentals In ChatSphere

REST uses HTTP methods to represent operations:

- `GET /api/v1/users?q=ali`: read/search users.
- `POST /api/v1/messages`: create a direct message.
- `PATCH /api/v1/messages/:id`: edit a message.
- `DELETE /api/v1/messages/:id/me`: hide a message for me.

Path params identify resources: `:id`, `:recipientId`, `:messageId`, `:userId`.

Query params tune reads: `?limit=50`, `?q=search`, `?token=...`.

Request bodies carry JSON for messages, groups, status, admin login, AI chat, and reactions. Multipart bodies carry profile photos and uploaded files.

Status codes:

- `200 OK`: success.
- `202 Accepted`: stubbed endpoints.
- `400 Bad Request`: malformed input.
- `401 Unauthorized`: missing/invalid token.
- `403 Forbidden`: authenticated but not allowed.
- `404 Not Found`: missing resource.
- `429 Too Many Requests`: rate limited.
- `500 Internal Server Error`: server/storage failure.
- `503 Service Unavailable`: Gemini not configured.

Idempotency appears in message sending: if a client sends a stable client-generated ID again, the backend returns the existing message instead of duplicating it.

HTTP is used for durable operations and list loading. WebSocket is used for low-latency realtime delivery, typing, presence, and call signaling.

## 7. Authentication System

ChatSphere has:

- Email OTP verification for signup/login steps.
- Password-based login after profile completion.
- Password reset using OTP.
- HMAC-signed user tokens.
- HMAC-signed admin tokens.
- In-memory logout revocation.

OTP flow:

1. `POST /api/v1/auth/email/request-code` validates email.
2. It enforces 5 requests per 15 minutes per email in memory.
3. It creates a 6-digit random code using `crypto/rand`.
4. Code expires after 10 minutes.
5. Brevo sends the email.
6. `POST /api/v1/auth/email/verify-code` validates and removes the code.

Signup/profile completion:

- `POST /api/v1/profile/onboarding` validates email, name, password length, avatar choice, then calls `UpsertUser`.
- Passwords are hashed with bcrypt before storage.
- The response includes an auth token.

Token format:

```text
base64url(userID|email|expiresUnix|hmacSignature)
```

HMAC means Hash-based Message Authentication Code. The backend signs the payload with `AUTH_SECRET` and verifies the signature with `hmac.Equal`, which avoids timing leaks. If someone modifies the user ID, email, or expiry, the signature no longer matches.

Passwords are never stored as plaintext. bcrypt stores a slow one-way hash. If the database leaks, attackers do not immediately get the original passwords.

Authentication answers "who are you?" Authorization answers "what are you allowed to do?"

Current limitations:

- Token revocation is in memory, so logout revocation is lost if the backend restarts.
- OTP codes and OTP rate windows are in memory, so they are also restart-local.
- `JWT_SECRET` exists in config but `AUTH_SECRET` is what `signPayload` currently uses.
- Admin credentials come from environment variables and are checked directly.

Source references:

- `backend/internal/http/router.go`
- `backend/internal/http/email_auth.go`
- `backend/internal/store/store.go`

## 8. Authorization

ChatSphere must never trust the frontend for authorization. The backend decides what the current token user may do.

Examples:

- Direct message list requires a valid token and uses the authenticated email/user ID.
- Sending direct messages checks sender/recipient existence and blocking.
- Editing direct messages requires `lower(sender_email) = current email`.
- Deleting for everyone requires the sender.
- Deleting for me requires the user has access, then writes private deletion state.
- Starring requires access to the message and stores star state under the current user.
- Group message reads require group membership.
- Group edits require sender ownership and group membership.
- Group member/admin management requires owner/admin role checks in store methods.
- Status viewers are visible only to the status owner.
- Blocking affects messaging and call setup.

## 9. Database Fundamentals

ChatSphere uses PostgreSQL as the primary current database path when `DATABASE_URL` is configured. `store.New` also contains a MySQL legacy path if the URL starts with `mysql://`, and a JSON file fallback if no DB URL exists.

Tables are collections of rows. Rows are records. Columns are fields. Primary keys uniquely identify rows. Unique constraints prevent duplicates. Indexes speed up common lookup/order patterns. NULL values represent missing optional values, such as `edited_at` before a message is edited. Timestamps record when things happen.

### Current Tables

`app_users`

- Purpose: user accounts and profiles.
- Columns: `id`, `email`, `first_name`, `last_name`, `password_hash`, `avatar_url`, `blocked`, `created_at`, `updated_at`.
- Constraints/indexes: primary key `id`, unique `email`.
- Used by auth, users search, profile, groups, statuses, calls, reports.

`messages`

- Purpose: direct chat messages.
- Columns: `seq`, `id`, `conversation_id`, `sender_email`, `sender_id`, `recipient_id`, `body`, attachment fields, `reply_to_message_id`, `read_at`, `edited_at`, `deleted_for_everyone_at`, `deleted_for_everyone_by`, `created_at`.
- Indexes: `idx_messages_conversation_created(conversation_id, created_at, seq)`.
- Used by direct messaging, replies, edits, deletes, stars, reactions, inbox.

`attachments`

- Purpose: local DB fallback file storage and Cloudinary metadata.
- Columns: `id`, `owner_id`, `name`, `content_type`, `kind`, `size_bytes`, `content`, `cloudinary_url`, `cloudinary_public_id`, `created_at`.
- Indexes: `idx_attachments_owner(owner_id)`.
- Used by upload and file serving.

`user_blocks`

- Purpose: private blocking relationships.
- Columns: `blocker_id`, `blocked_id`, `created_at`.
- Primary key: `(blocker_id, blocked_id)`.
- Used by contact block/unblock, messaging, calls.

`reports`

- Purpose: moderation reports.
- Columns: `id`, `reporter_id`, `reported_id`, `message_id`, `reason`, `status`, `created_at`, `resolved_at`.
- Used by user report and admin report list/resolve.

`ai_usage`

- Purpose: per-user daily Gemini quota.
- Columns: `user_id`, `usage_date`, `request_count`.
- Primary key: `(user_id, usage_date)`.
- Used by AI chat rate/quota enforcement.

`call_history`

- Purpose: persistent call records.
- Columns: `id`, `caller_id`, `recipient_id`, `call_type`, `status`, `started_at`, `answered_at`, `ended_at`, `duration_seconds`.
- Indexes: caller and recipient indexes.
- Used by call history endpoint and WebSocket call events.

`statuses`

- Purpose: WhatsApp-style stories/statuses.
- Columns: `id`, `user_id`, `type`, `text_content`, `media_url`, `caption`, `background`, `created_at`, `expires_at`.
- Index: `statuses_user_expiry(user_id, expires_at)`.
- Used by status create/list/delete.

`status_views`

- Purpose: one view record per viewer per status.
- Columns: `status_id`, `viewer_id`, `viewed_at`.
- Primary key: `(status_id, viewer_id)`.
- Used by viewed state and viewer lists.

`groups`

- Purpose: group metadata.
- Columns: `id`, `name`, `avatar_url`, `owner_id`, `created_at`, `updated_at`.
- Used by group list/details/update.

`group_members`

- Purpose: group membership and roles.
- Columns: `group_id`, `user_id`, `role`, `joined_at`.
- Primary key: `(group_id, user_id)`.
- Used by authorization, member list, admin/owner actions.

`group_messages`

- Purpose: group chat messages.
- Columns: `id`, `group_id`, `sender_id`, `sender_email`, `body`, attachment fields, `reply_to_message_id`, `edited_at`, `deleted_for_everyone_at`, `deleted_for_everyone_by`, `created_at`.
- Index: `group_messages_group_created(group_id, created_at)`.
- Used by group messaging, replies, edits, deletes, stars, reactions.

`message_reactions`

- Purpose: one reaction per user per message.
- Columns: `message_type`, `message_id`, `user_id`, `emoji`, `created_at`.
- Primary key: `(message_type, message_id, user_id)`.
- Index: `idx_message_reactions_message(message_type, message_id)`.
- Used by direct and group reaction summaries.

`message_deletions`

- Purpose: Delete for Me state.
- Columns: `message_type`, `message_id`, `user_id`, `deleted_at`.
- Primary key: `(message_type, message_id, user_id)`.
- Used to hide messages privately for one user.

`starred_messages`

- Purpose: private per-user starred messages.
- Columns: `message_type`, `message_id`, `user_id`, `starred_at`.
- Primary key: `(user_id, message_type, message_id)`.
- Index: `idx_starred_messages_user(user_id, message_type, starred_at)`.
- Used by direct/group starred message lists and `isStarred`.

Note: The schema currently declares primary keys and indexes but mostly does not declare foreign keys. The store layer enforces relationships in code.

## 10. Store Layer

`backend/internal/store/store.go` is the data access layer. Handlers call store methods instead of placing every SQL query in router functions.

Why this matters:

- Keeps HTTP code focused on request/response.
- Keeps persistence logic reusable for HTTP and WebSocket paths.
- Centralizes authorization checks around data.
- Makes tests easier because workflows use the same methods.

Common patterns:

- Insert: `SaveMessage`, `CreateGroup`, `CreateStatus`.
- Update: `UpdateMessage`, `UpdateGroupMessage`, `UpdateCallHistoryStatus`.
- Delete: `DeleteStatus`, `RemoveGroupMember`.
- Tombstone update: `DeleteMessageForEveryone`, `DeleteGroupMessageForEveryone`.
- Select one: `UserByID`, `MessageByID`, `groupMessageByID`.
- Select many: `ListMessages`, `ListGroupMessages`, `ListInboxMessages`.
- Scan: fill struct fields from SQL result columns.
- Rows iteration: loop `rows.Next()`, scan each row, check `rows.Err()`.

PostgreSQL path uses `pgxpool.Pool`. MySQL path uses `database/sql`. JSON fallback uses `data/chatsphere.json` guarded by a mutex.

Current limitation: supporting PostgreSQL, MySQL, and JSON in one file makes `store.go` very large and increases the chance of behavior differences across storage modes.

## 11. WebSocket Fundamentals

HTTP is request/response: client asks, server answers. WebSocket is persistent: after an HTTP upgrade, both sides can send events anytime.

ChatSphere WebSocket:

- Endpoint: `GET /ws?token=...`.
- Token is verified before upgrade.
- `realtime.Serve` creates a `Client`.
- One goroutine reads from the socket.
- One goroutine writes to the socket.
- The `Hub` receives register/unregister/broadcast events.

Hub concepts:

- `clients`: connected WebSocket clients.
- `online`: user ID to active connection count.
- `lastSeen`: in-memory last seen time.
- `calls`: active call sessions.
- `broadcast`: channel for events.
- `TargetUserIDs`: optional targeting list.

Current event names:

| Event | Sender | Receivers | Persisted? | Purpose |
|---|---|---|---|---|
| `presence.updated` | Hub | all connected clients | lastSeen in memory only | online/offline updates |
| `message_send` | client | server | yes | direct message send over WS |
| `message_sent` | server | sender | no | send ack/failure |
| `chat.message` | server | direct participants | yes | new direct message |
| `chat.read` | server | direct participants | yes via `read_at` | read receipt |
| `typing.start` | server | direct participants | no | typing indicator |
| `typing.stop` | server | direct participants | no | typing indicator |
| `group_message_send` | client | server | yes | group send over WS |
| `group_message_sent` | server | sender | no | group send ack/failure |
| `group.message` | server | group members | yes | new group message |
| `message.reaction` | server | participants/members | yes | reaction summary update |
| `message.edited` | server | participants/members | yes | patched message text |
| `message.deleted` | server | participants/members | yes | tombstone update |
| `call_offer` | client/server | call target(s) | call history for initial call | WebRTC offer/invite |
| `call_answer` | client/server | call peer | updates call history answered | WebRTC answer |
| `call_ice_candidate` | client/server | call peer | no | ICE candidate exchange |
| `call_reject` | client/server | caller/inviter | updates call history rejected | reject/busy/blocked |
| `call_end` | client/server | call participant(s) | updates call history missed/ended | hangup/cleanup |
| `call_join` | client/server | call participants | no | join existing call |
| `call_participant_joined` | server | call participants | no | group call participant joined |
| `call_participant_left` | server | call participants | no | group call participant left |
| `call_camera_toggle` | client/server | call peer | no | video state signaling |
| `call_full` | server | caller/inviter | no | call capacity reached |

Current WebSocket origin behavior: `CheckOrigin` returns true. That is convenient for development but should be reviewed for production hardening.

## 12. Concurrency In Go

The realtime server handles many users at once. Without synchronization, maps like `online`, `lastSeen`, and `calls` could be read and written at the same time, causing races or crashes.

ChatSphere uses:

- Goroutines: hub loop, WebSocket read/write pumps, delayed disconnect cleanup, asynchronous call history writes, Cloudinary cleanup.
- Channels: `register`, `unregister`, `broadcast`, client `send`.
- `sync.RWMutex`: protects online state, last seen, and calls.
- `sync.Mutex`: protects token revocation, OTP codes/rates, AI cooldown/rate maps, and JSON fallback data.

Why `online` is a count instead of a boolean: one user can have multiple active connections, for example desktop and mobile. The user should only go offline when the count reaches zero.

Disconnect grace period: after unregister, the hub waits 15 seconds before marking offline and cleaning calls. This tolerates quick reconnects.

## 13. Direct Messaging Architecture

Conversation IDs are deterministic: the two user IDs are sorted and joined, so both participants get the same conversation ID.

Direct messages support:

- text
- image/video/audio/file attachments
- client-generated IDs for idempotency
- optimistic frontend sending
- retry/failure UI
- read receipts via `read_at`
- reactions
- reply/quote
- edit
- Delete for Me
- Delete for Everyone tombstones
- starred messages

Persistence path:

- `messages` stores durable message data.
- `message_reactions` stores reaction state.
- `message_deletions` hides messages per user.
- `starred_messages` stores private stars.

Realtime path:

- New messages broadcast as `chat.message`.
- Read receipts broadcast as `chat.read`.
- Reactions broadcast as `message.reaction`.
- Edits broadcast as `message.edited`.
- Deletes broadcast as `message.deleted`.

## 14. Group System

Groups use three main tables:

- `groups`: group metadata.
- `group_members`: membership and role.
- `group_messages`: group chat messages.

Roles:

- `owner`: created the group, can manage admins/members and update group.
- `admin`: can manage many member operations depending on store checks.
- `member`: normal participant.

Backend checks membership before listing group details/messages or sending messages. Role checks happen server-side for update, adding/removing members, and promoting/demoting admins.

Group messages support reactions, replies, edits, deletes, stars, attachments, and realtime delivery to all group members.

## 15. Message Reactions

Reactions are stored in `message_reactions`.

The primary key `(message_type, message_id, user_id)` enforces one reaction per user per message. This matters because it prevents duplicate reaction rows and makes replace/toggle behavior deterministic.

Behavior:

- If user reacts with a new emoji, insert it.
- If user reacts with a different emoji, replace the old emoji.
- If user reacts with the same emoji again, remove it.
- Reactions are summarized into emoji count, whether current viewer reacted, and users.

Approved emoji in the backend: `👍`, `❤️`, `😂`, `😮`, `😢`, `🙏`.

## 16. Reply / Quote System

Replies store `reply_to_message_id`, not a full copy of the original message. This keeps data normalized and allows the quote preview to reflect deletion/unavailable state.

Validation:

- Direct replies must refer to a message in the same conversation.
- Group replies must refer to a message in the same group.

Read/list endpoints resolve quote metadata into a `replyTo` object with sender name, body, attachment kind, and unavailable state.

Frontend scroll-to-original/highlight behavior lives in the chat UI components. Backend only stores and resolves the reference.

## 17. Edit Message System

Direct edit endpoint: `PATCH /api/v1/messages/:id`.

Group edit endpoint: `PATCH /api/v1/groups/:id/messages/:messageId`.

Rules:

- Only sender can edit.
- Body must be non-empty.
- Deleted-for-everyone messages are not editable.
- Edit updates `body` and `edited_at`.
- `created_at`, attachments, replies, reactions, deletions, and stars remain intact.
- Realtime event `message.edited` patches other clients.

## 18. Delete System

Delete for Me:

- Private to the current user.
- Stored in `message_deletions`.
- Does not remove the original message for other users.
- Also removes the current user's star for that message.

Delete for Everyone:

- Sender-only.
- Sets tombstone metadata on the message row.
- Scrubs body and attachment from public response.
- Removes reactions and starred rows for that message.
- Preserves ordering and reply references.
- Broadcasts `message.deleted`.

Hard deleting chat messages can break ordering, replies, audits, and realtime consistency. Tombstones avoid those problems.

## 19. Starred Messages

Stars are private per user. They live in `starred_messages`, not directly on `messages`, because different users may star different messages.

Direct starred list: `GET /api/v1/messages/starred/:recipientId`.

Group starred list: `GET /api/v1/groups/:id/messages/starred`.

Compatibility:

- Edited messages show current edited content in starred lists.
- Delete for Me hides the message from that user's starred list.
- Delete for Everyone removes stars for everyone.

## 20. Status System

Status endpoints:

- `GET /api/v1/statuses`
- `GET /api/v1/statuses/user/:id`
- `POST /api/v1/statuses`
- `POST /api/v1/statuses/:id/view`
- `GET /api/v1/statuses/:id/viewers`
- `DELETE /api/v1/statuses/:id`

Status types: `text`, `image`, `video`.

Rules:

- Text status requires text.
- Media status requires `mediaUrl`.
- Text and caption length are limited.
- Store sets `expires_at`; listing only returns active statuses.
- `status_views` tracks unique viewer records.
- Only owner can view status viewers or delete their status.

## 21. Media Upload Architecture

Uploads use `multipart/form-data` at `POST /api/v1/upload`.

Validation:

- Auth required.
- File is required.
- Size must be within `MAX_UPLOAD_SIZE_MB`.
- Kind is inferred from content type: image, video, audio, or file.

Cloudinary path:

- If Cloudinary credentials are configured, file streams to Cloudinary.
- Store saves metadata: URL and public ID.
- Large images/videos get optimized delivery URLs with `f_auto`, `q_auto`, and size limits.
- If metadata save fails, backend tries to clean up the Cloudinary asset.

Fallback path:

- If Cloudinary is not configured, file bytes are stored in `attachments.content`.
- API returns `attachment:<id>`.
- File route `GET /api/v1/files/:id` serves bytes or redirects to Cloudinary.

Frontend compression exists because large media can be expensive to upload, store, and deliver. Compressing before upload reduces bandwidth and speeds message sending.

## 22. Cloudinary

Cloudinary is a cloud media service/CDN. ChatSphere uses it for uploaded attachments when configured.

Environment variables:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_PRESET`

Uploads use Cloudinary's upload endpoint with basic auth. Deletes use signed destroy requests. The backend never exposes Cloudinary API secrets to the frontend.

Resource type mapping:

- image -> `image`
- video/audio -> `video`
- other files -> `raw`

## 23. Email / Brevo

Brevo sends OTP and password reset emails.

Environment variables:

- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`

The code sends JSON to `https://api.brevo.com/v3/smtp/email`.

Rate limiting:

- 5 code requests per email per 15 minutes.
- Codes expire after 10 minutes.
- Current storage is in memory.

## 24. AI / Gemini

Gemini is wired through `backend/internal/gemini` and `backend/internal/http/ai.go`.

The API key lives only on the backend. This matters because frontend secrets are not secret: users can inspect bundled JavaScript and network calls.

AI protections:

- Auth required.
- Message cannot be empty.
- Rune length limit.
- Per-user cooldown.
- Per-IP sliding window.
- Daily per-user quota in `ai_usage`.
- Quota reservation is refunded if Gemini fails.
- Timeout configured from env.
- Safe generic user-facing errors.

Important tests:

- Gemini request shape and system instruction tests in `gemini_test.go`.
- AI auth, cooldown, IP limit, daily limit, refund, success tests in `ai_router_test.go`.

## 25. Rate Limiting

Rate limiting controls how often users can perform sensitive or expensive actions.

ChatSphere uses it for:

- OTP email requests: protects inboxes and Brevo quota.
- AI chat cooldown: prevents rapid repeated prompts.
- AI IP rate limit: slows abuse across accounts.
- AI daily per-user quota: protects Gemini cost/quota.

Current rate limit maps are in memory except daily AI usage, which persists in `ai_usage`.

## 26. CORS

CORS is a browser security rule around cross-origin requests. If the frontend runs on one origin and backend on another, the backend must explicitly allow the frontend origin.

ChatSphere configures Gin CORS with:

- `AllowOrigins`: `FRONTEND_ORIGIN`
- methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- headers: `Authorization`, `Content-Type`
- credentials allowed

WebSocket origin checking is currently permissive in `client.go`, which should be reviewed before production hardening.

## 27. WebRTC, STUN, And TURN

WebRTC lets browsers send audio/video directly using `RTCPeerConnection`.

Terms:

- Offer: caller's session description.
- Answer: callee's session description.
- ICE candidate: possible network route.
- Media tracks: microphone/camera streams.
- Signaling: app-specific exchange of offer/answer/candidates.

The backend is the signaling path, not the media path.

STUN helps a browser discover its public network address through NAT. ChatSphere uses Google STUN: `stun:stun.l.google.com:19302`.

TURN relays media when direct peer-to-peer routes fail. ChatSphere uses Metered TURN if `NEXT_PUBLIC_TURN_USERNAME` and `NEXT_PUBLIC_TURN_CREDENTIAL` are set. Configured TURN URLs include UDP/TCP and TLS variants under `global.relay.metered.ca`.

## 28. Call Signaling Backend

Call events are handled in `backend/internal/realtime/client.go`.

- `call_offer`: starts a call, sends WebRTC offer, or invites a user.
- `call_answer`: answers a peer connection and marks call history answered.
- `call_ice_candidate`: forwards ICE candidates to target peer.
- `call_reject`: rejects a call/invite; may mark call history rejected.
- `call_end`: leaves or ends a call; may mark ringing calls missed or answered calls ended.
- `call_join`: joins an existing call if invited/authorized.
- `call_participant_joined`: emitted after successful join.
- `call_participant_left`: emitted after participant leaves.
- `call_camera_toggle`: forwards camera state.
- `call_full`: tells inviter/caller that capacity is reached.

The hub tracks call sessions in memory with a max of 4 participants.

## 29. Call History

`call_history` stores:

- caller/recipient
- audio/video type
- status: `ringing`, `answered`, `rejected`, `missed`, `ended`
- started/answered/ended timestamps
- duration seconds

The frontend reads history from `GET /api/v1/calls/history?limit=50`.

## 30. Presence / Online / Last Seen

Presence lives in the realtime hub:

- `online` map counts active WebSocket connections per user.
- `lastSeen` map stores offline time after disconnect grace.
- `presence.updated` is broadcast when a user becomes online/offline.
- User list endpoints include online state and last seen from the hub.
- Frontend green online badges reuse this presence data.

Current limitation: last seen is in memory. If the backend restarts, last-seen history is lost.

## 31. Blocking / Reporting

Blocking:

- `POST /api/v1/contacts/:id/block`
- `DELETE /api/v1/contacts/:id/block`
- Stored in `user_blocks`.
- Prevents messaging/calls when `IsBlockedBetween` returns true.

Reporting:

- `POST /api/v1/contacts/:id/report`
- Stored in `reports`.
- Admin can list and resolve reports.

## 32. Admin System

Admin endpoints:

- `POST /api/v1/admin/login`
- `GET /api/v1/admin/users`
- `DELETE /api/v1/admin/users/:id`
- `POST /api/v1/admin/users/:id/block`
- `POST /api/v1/admin/users/:id/unblock`
- `GET /api/v1/admin/reports`
- `POST /api/v1/admin/reports/:id/resolve`

Admin tokens use the same HMAC style with an `admin|email|expires` payload.

Current concerns to review before serious production use:

- Admin password comes from environment and is compared directly.
- There is no admin role table.
- Admin token revocation is not checked the same way user token revocation is.

## 33. Configuration / Environment Variables

| Name | Controls | Required? | Secret? | Example |
|---|---|---:|---:|---|
| `PORT` | backend listen port | no | no | `8080` |
| `APP_ENV` | Gin mode behavior | no | no | `production` |
| `FRONTEND_ORIGIN` | CORS allowed origin | yes for deployed frontend | no | `https://app.example.com` |
| `JWT_SECRET` | loaded but not currently used for signing | no | yes | `long-random-string` |
| `AUTH_SECRET` | HMAC token signing | yes in production | yes | `different-long-random-string` |
| `AUTH_TOKEN_TTL_HOURS` | token expiry | no | no | `168` |
| `ADMIN_EMAIL` | admin login email | yes for admin | maybe | `admin@example.com` |
| `ADMIN_PASSWORD` | admin login password | yes for admin | yes | `strong-password` |
| `MYSQL_DSN` | direct MySQL DSN config field | legacy | yes | `user:pass@tcp(host)/db?parseTime=true` |
| `MONGO_URI` | loaded but not used by current store | no | yes | `mongodb+srv://...` |
| `DATABASE_URL` | PostgreSQL or mysql URL | yes for DB deployment | yes | `postgresql://user:pass@host/db` |
| `SUPABASE_URL` | loaded but not used directly | no | maybe | `https://project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | loaded but not used directly | no | yes | `service-role-key` |
| `BREVO_API_KEY` | email API auth | yes for OTP email | yes | `xkeysib-...` |
| `BREVO_SENDER_EMAIL` | sender email | yes for OTP email | no | `hello@example.com` |
| `BREVO_SENDER_NAME` | sender display name | no | no | `ChatSphere` |
| `DATA_PATH` | JSON fallback path | no | no | `data/chatsphere.json` |
| `GEMINI_API_KEY` | Gemini API key | yes for AI | yes | `AIza...` |
| `GEMINI_MODEL` | Gemini model | no | no | `gemini-2.0-flash` |
| `GEMINI_DAILY_LIMIT` | AI daily quota | no | no | `20` |
| `GEMINI_IP_RATE_LIMIT` | AI per-IP per-minute limit | no | no | `5` |
| `GEMINI_REQUEST_COOLDOWN_SECONDS` | AI per-user cooldown | no | no | `2` |
| `GEMINI_MAX_MESSAGE_LENGTH` | prompt max runes | no | no | `2000` |
| `GEMINI_MAX_OUTPUT_TOKENS` | Gemini max output | no | no | `500` |
| `GEMINI_TIMEOUT_SECONDS` | Gemini timeout | no | no | `30` |
| `TRUSTED_PROXIES` | Gin trusted proxy list | deployment-dependent | no | `10.0.0.1,10.0.0.2` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account | yes for Cloudinary | no | `my-cloud` |
| `CLOUDINARY_API_KEY` | Cloudinary key | yes for Cloudinary | yes | `1234567890` |
| `CLOUDINARY_API_SECRET` | Cloudinary secret | yes for Cloudinary | yes | `secret` |
| `CLOUDINARY_UPLOAD_PRESET` | optional upload preset | no | maybe | `preset-name` |
| `MAX_UPLOAD_SIZE_MB` | upload max size | no | no | `50` |
| `IMAGE_OPTIMIZE_THRESHOLD_BYTES` | image transform threshold | no | no | `2097152` |
| `VIDEO_OPTIMIZE_THRESHOLD_BYTES` | video transform threshold | no | no | `10485760` |
| `IMAGE_MAX_DIMENSION` | Cloudinary image limit | no | no | `1920` |
| `VIDEO_MAX_DIMENSION` | Cloudinary video limit | no | no | `1280` |

Frontend/WebRTC variables:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_ADMIN_EMAIL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`

Never put backend-only secrets in `NEXT_PUBLIC_*`; those are visible to users.

## 34. Error Handling

Backend errors are translated into safe HTTP responses. For example:

- Auth failure: `login required`.
- Bad OTP: `invalid or expired code`.
- Gemini failure: generic AI unavailable message.
- Upload too large: explicit size message.
- Cloudinary metadata failure: safe file metadata error.

Good practices already visible:

- Gemini API key is not logged.
- Startup logs mask Brevo key.
- User-facing Gemini errors do not expose raw provider details.
- `gin.Recovery()` prevents panics from crashing the process.

Future review areas:

- Some internal errors are logged but not structured.
- Some route stubs return `202`.
- WebSocket event validation is basic for some events.

## 35. Testing

Current backend tests:

- `backend/internal/http/health_test.go`: root and health behavior.
- `backend/internal/http/ai_router_test.go`: AI auth, validation, cooldown, IP limit, daily limit, refund, success, user ID safety.
- `backend/internal/http/router_integration_test.go`: private messaging, reactions, replies, edits, deletes, stars, blocking, call history, statuses, groups, voice upload, Cloudinary URL optimization, config defaults, idempotency.
- `backend/internal/gemini/gemini_test.go`: Gemini request construction, system instruction, API key placement, endpoint behavior.

Many integration tests require `DATABASE_URL`; they skip if it is not configured.

Important missing or future coverage:

- WebSocket end-to-end tests for connection lifecycle.
- Race tests around presence/calls.
- More upload security tests for content sniffing.
- Admin auth/rate limit tests.
- Persistent token revocation tests if revocation is moved to DB.

## 36. Deployment

Current backend deployment config:

- `backend/railway.json` uses Railway/Nixpacks.
- Start command: `./out`.
- Health check path: `/health`.
- Backend needs `DATABASE_URL`, `AUTH_SECRET`, `FRONTEND_ORIGIN`, and provider secrets.

Current frontend deployment config:

- `netlify.toml` at root builds from `frontend`.
- `frontend/netlify.toml` also builds `pnpm build` and publishes `out`.
- The Android app currently loads `https://chat-sphere-ruby.vercel.app/` in a WebView.

Deployment requirements:

- Frontend must know backend HTTP URL via `NEXT_PUBLIC_API_URL`.
- Frontend must know WebSocket URL via `NEXT_PUBLIC_WS_URL`; deployed production should use `wss://`.
- Backend CORS `FRONTEND_ORIGIN` must match the deployed frontend origin.
- HTTPS is required for camera/microphone WebRTC in browsers.
- TURN credentials must be configured for difficult networks.
- Cloudinary/Brevo/Gemini secrets must be backend env vars only.

Clearly current vs legacy:

- PostgreSQL via `DATABASE_URL` is the main current path.
- MySQL and JSON fallback exist in code but should be treated as legacy/fallback unless intentionally deployed.
- `MONGO_URI`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are loaded but not directly used by current store logic.

## 37. Security Topics To Learn

Handled reasonably in current code:

- bcrypt password hashing.
- HMAC token signature validation.
- Auth required for sensitive APIs.
- Server-side authorization for messages/groups/status/admin.
- SQL parameters instead of string-concatenated user input.
- File size limits.
- AI/OTP rate limits.
- Secrets loaded from environment.
- Safe Gemini user-facing errors.

Needs future review/hardening:

- WebSocket `CheckOrigin` permits all origins.
- User token revocation is in memory.
- OTP state and rate limits are in memory.
- Admin system is environment-password based.
- No database foreign keys in migrations.
- Upload content validation relies mostly on provided/inferred MIME and size.
- CSRF should be considered if token storage ever moves to cookies.
- More structured logging/monitoring.

Topics:

- Authentication: proving identity.
- Authorization: enforcing permissions.
- HMAC: signed token integrity.
- bcrypt: slow password hashing.
- CORS: browser cross-origin protection.
- SQL injection: prevented by parameterized queries.
- XSS: frontend concern, especially with user messages and media URLs.
- CSRF: less relevant with Authorization headers, more relevant with cookies.
- WebSocket security: origin checks, token validation, event validation.
- File upload security: size/type scanning, malware risk, CDN public URLs.
- Rate limiting: abuse/cost control.
- Least privilege: only give services minimal required permissions.

## 38. Backend Learning Roadmap

LEVEL 1 - Foundations

- HTTP: learn methods, headers, status codes. Matters because every REST endpoint uses it. Practice: trace `POST /api/v1/messages`.
- JSON: learn object encoding/decoding. Matters because frontend/backend share JSON. Practice: write sample request/response bodies.
- Go basics: variables, functions, structs, errors. Matters because all backend code is Go. Practice: read `store.User` and `publicUser`.
- SQL basics: SELECT, INSERT, UPDATE, DELETE. Matters because ChatSphere stores durable data. Practice: map each store method to SQL.

LEVEL 2 - Backend Web Development

- Gin: learn routes and handlers. Where: `router.go`. Practice: explain one handler step by step.
- Middleware: learn CORS, recovery, auth. Where: `NewRouter`, `requireAdmin`, `requireUser`. Practice: draw request path.
- Authentication: tokens/passwords. Where: token helpers and bcrypt store methods. Practice: explain why token tampering fails.
- `database/sql` and pgx: learn QueryRow, Exec, Scan. Practice: follow `ListMessages`.

LEVEL 3 - Realtime

- WebSockets: persistent events. Where: `client.go`. Practice: trace `message_send`.
- Goroutines: concurrent tasks. Where: hub startup and pumps. Practice: draw goroutine lifecycle per socket.
- Channels: communication between goroutines. Where: `Hub`. Practice: explain `broadcast`.
- Mutexes: shared state safety. Where: online/calls maps. Practice: describe race without locks.

LEVEL 4 - Advanced Chat Systems

- Idempotency: stable client IDs. Where: message send. Practice: send same ID twice in test.
- Optimistic UI: frontend sends before server ack. Where: AppShell/chat components. Practice: explain retry state.
- Message ordering: conversation indexes and timestamps. Practice: inspect `idx_messages_conversation_created`.
- Realtime consistency: HTTP writes plus WebSocket broadcasts. Practice: compare direct send HTTP vs WS path.
- Authorization: server-side trust boundary. Practice: explain why group membership is checked in store.

LEVEL 5 - Media / Calls

- Uploads: multipart and size limits. Where: upload route. Practice: trace Cloudinary vs fallback.
- CDN: Cloudinary delivery URLs. Practice: explain optimized URL insertion.
- WebRTC: offer/answer/candidates. Where: `AudioCall.tsx` and `client.go`. Practice: draw call setup.
- STUN/TURN: NAT traversal. Where: `webrtcConfig.ts`. Practice: explain why TURN relays media.

LEVEL 6 - Production

- Security: tokens, CORS, WS origin, uploads. Practice: make a hardening checklist.
- Deployment: env vars, health checks, WSS. Practice: list production variables.
- Logging/monitoring: observability. Practice: propose request IDs.
- Testing: integration and race tests. Practice: run targeted backend tests with `DATABASE_URL`.
- Scaling: multiple backend instances. Practice: identify what in-memory state would need Redis or DB.

## 39. Interview / Revision Questions

1. What is REST? A style for using HTTP resources and methods for client/server operations.
2. Why use `GET` for message lists? It reads existing data without creating new resources.
3. Why use `POST` for sending messages? It creates a new message.
4. Why use `PATCH` for edit? It partially updates an existing message.
5. Why use `DELETE` for Delete for Me/Everyone? It represents removal behavior, even if implemented as hidden state or tombstone.
6. What is authentication? Verifying who the user is.
7. What is authorization? Deciding what an authenticated user can do.
8. Why hash passwords? To avoid storing recoverable plaintext passwords.
9. What does bcrypt do? It creates a slow salted password hash.
10. What is HMAC? A keyed hash used to verify message/token integrity.
11. Why use `hmac.Equal`? To avoid timing attacks during signature comparison.
12. What is token TTL? The time before a token expires.
13. What is a middleware? Code that runs around handlers for cross-cutting behavior.
14. What is CORS? Browser policy controlling cross-origin requests.
15. Why does `FRONTEND_ORIGIN` matter? It tells backend which frontend origin can call it.
16. What is SQL injection? Attacker-controlled SQL due to unsafe query construction.
17. How does ChatSphere reduce SQL injection risk? It uses parameterized queries.
18. What is a primary key? Unique row identifier.
19. What is a unique constraint? A rule preventing duplicate values/combinations.
20. Why is `message_reactions` unique per user/message? To enforce one reaction per user per message.
21. What is an index? A data structure speeding lookups/order by.
22. Why index conversation messages? Message lists load by conversation and time.
23. What is `NULL`? Missing/unknown value, such as not-yet-edited timestamp.
24. What is `Scan` in Go DB code? It copies query columns into variables.
25. What is a goroutine? Lightweight concurrent execution in Go.
26. What is a channel? A typed communication path between goroutines.
27. What is a mutex? A lock protecting shared data.
28. What is a race condition? Unsynchronized concurrent access causing incorrect behavior.
29. Why count online connections? One user can have multiple sessions.
30. What is WebSocket? A persistent bidirectional connection.
31. Why use WebSockets for chat? Server can push new messages instantly.
32. What is ping/pong? WebSocket keepalive and dead connection detection.
33. What is idempotency? Repeating an operation safely without duplicate effects.
34. Where does ChatSphere use idempotency? Client-generated message IDs.
35. What is optimistic UI? UI updates before server confirmation.
36. What is a tombstone? A retained deleted record that hides original content.
37. Why not hard-delete messages? It can break ordering, replies, and sync.
38. Why store Delete for Me separately? It is private per user.
39. Why store stars separately? Stars are private per user.
40. Why store reply references instead of copied text? It keeps relationships normalized and handles deleted originals.
41. What is WebRTC? Browser technology for peer-to-peer media/data.
42. What is signaling? App messages used to exchange WebRTC setup data.
43. What is an offer? Caller session description.
44. What is an answer? Callee session description.
45. What is ICE? Process of finding a usable network path.
46. What is STUN? Server that helps discover public network address.
47. What is TURN? Relay server for media when direct routes fail.
48. Why does backend not carry normal call media? WebRTC sends media peer-to-peer or via TURN.
49. What is Cloudinary? Cloud media storage/CDN service.
50. Why keep Cloudinary secrets on backend? Frontend code is visible to users.
51. What is Brevo used for? OTP and password reset email.
52. Why rate-limit OTP? To prevent spam and abuse.
53. Why rate-limit AI? To protect quota, cost, and service stability.
54. What does `context.Context` help with? Cancellation, deadlines, and request-scoped work.
55. Why use environment variables? Configuration and secrets vary by environment.
56. What is a JSON tag? Go struct metadata controlling JSON field names.
57. Why should group role checks be server-side? Frontend can be modified by users.
58. What is a CDN? Distributed delivery network for faster media access.
59. Why is WebSocket origin checking important? It blocks unwanted origins from opening sockets.
60. What would be hard to scale horizontally today? In-memory presence, calls, OTPs, revocations, and rate maps.

## 40. Glossary

API: interface other software calls.

REST: HTTP resource-based architecture style.

HTTP: request/response web protocol.

HTTPS: encrypted HTTP over TLS.

JSON: text data format used by APIs.

JWT/HMAC token: ChatSphere uses an HMAC-signed token, not a standard JWT library token.

Hash: one-way digest of data.

bcrypt: password hashing algorithm designed to be slow.

Middleware: code that runs before/around route handlers.

Handler: function that processes an HTTP request.

Route: method/path mapping to a handler.

Database: persistent data storage system.

SQL: language for relational databases.

Index: database structure for faster lookup/order.

Primary key: unique row identifier.

Unique constraint: rule preventing duplicate values.

Migration: schema creation/update code.

WebSocket: persistent two-way network connection.

Realtime: server/client updates delivered immediately.

Goroutine: lightweight concurrent Go execution.

Channel: Go communication mechanism between goroutines.

Mutex: lock protecting shared state.

Race condition: bug from unsafe concurrent access.

WebRTC: browser peer-to-peer media technology.

ICE: network candidate gathering/connectivity process.

STUN: server for discovering public network address.

TURN: relay server for difficult networks.

CDN: content delivery network.

CORS: browser cross-origin request control.

Rate limit: cap on request frequency.

Idempotency: safe repeated operation with same result.

Optimistic update: frontend updates before final server confirmation.

Authorization: permission check.

Authentication: identity check.

Tombstone: deleted record placeholder preserving history/order.

## 41. What To Study First

If I want to understand the ChatSphere backend from zero, study these topics in this exact order:

1. HTTP basics - Easy.
2. JSON request/response bodies - Easy.
3. Go syntax, structs, methods, and errors - Medium.
4. SQL tables, rows, primary keys, and indexes - Medium.
5. Gin routing and handlers - Medium.
6. Password hashing and token authentication - Medium.
7. Store layer patterns with `QueryRow`, `Query`, `Exec`, and `Scan` - Medium.
8. Direct messaging lifecycle - Medium.
9. Group membership and authorization - Medium.
10. WebSocket fundamentals - Hard.
11. Go concurrency with goroutines, channels, and mutexes - Hard.
12. Reactions, replies, edits, deletes, and stars - Hard.
13. File uploads and Cloudinary - Medium.
14. Email OTP and rate limiting - Medium.
15. Gemini AI quota and backend-only secrets - Medium.
16. WebRTC offer/answer/ICE - Hard.
17. STUN/TURN and NAT traversal - Hard.
18. Deployment, HTTPS/WSS, and environment variables - Medium.
19. Security hardening checklist - Hard.
20. Testing and production observability - Hard.

## 42. Source References By Area

Authentication:

- `backend/internal/http/router.go`
- `backend/internal/http/email_auth.go`
- `backend/internal/store/store.go`

Routing and REST:

- `backend/internal/http/router.go`
- `backend/internal/http/ai.go`
- `backend/internal/http/email_auth.go`

Store/database:

- `backend/internal/store/store.go`

Realtime/WebSocket:

- `backend/internal/realtime/hub.go`
- `backend/internal/realtime/client.go`

Direct and group messaging:

- `backend/internal/http/router.go`
- `backend/internal/store/store.go`
- `backend/internal/realtime/client.go`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/components/chat/ChatPanel.tsx`
- `frontend/src/components/chat/MessageBubble.tsx`
- `frontend/src/components/chat/MessageComposer.tsx`

Reactions/replies/edits/deletes/stars:

- `backend/internal/store/store.go`
- `backend/internal/http/router.go`
- `backend/internal/realtime/client.go`
- `frontend/src/components/chat/MessageBubble.tsx`
- `frontend/src/components/chat/MessageReactions.tsx`
- `frontend/src/components/chat/MessageComposer.tsx`

Status:

- `backend/internal/http/router.go`
- `backend/internal/store/store.go`
- `frontend/src/components/AppShell.tsx`

Calls/WebRTC:

- `backend/internal/realtime/client.go`
- `backend/internal/realtime/hub.go`
- `backend/internal/store/store.go`
- `frontend/src/components/AudioCall.tsx`
- `frontend/src/lib/webrtcConfig.ts`

Media uploads:

- `backend/internal/http/router.go`
- `backend/internal/store/store.go`
- `frontend/src/lib/mediaCompression.ts`
- `frontend/src/components/AppShell.tsx`

Gemini AI:

- `backend/internal/http/ai.go`
- `backend/internal/gemini/gemini.go`
- `backend/internal/gemini/gemini_test.go`
- `docs/GEMINI_AI.md`
- `frontend/src/components/AIChat.tsx`

Email/Brevo:

- `backend/internal/http/email_auth.go`
- `backend/internal/config/config.go`

Admin:

- `backend/internal/http/router.go`
- `backend/internal/store/store.go`

Configuration/deployment:

- `backend/internal/config/config.go`
- `backend/.env.example`
- `backend/railway.json`
- `frontend/.env.example`
- `netlify.toml`
- `frontend/netlify.toml`
- `ChatSphere_Android/app/src/main/java/com/chatsphere/app/MainActivity.kt`

Testing:

- `backend/internal/http/health_test.go`
- `backend/internal/http/ai_router_test.go`
- `backend/internal/http/router_integration_test.go`
- `backend/internal/gemini/gemini_test.go`
