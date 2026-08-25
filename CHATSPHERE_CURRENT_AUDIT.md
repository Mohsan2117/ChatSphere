# ChatSphere Current Audit

Source of truth: current source code and latest 30 git commits as of this audit. Documentation was not treated as authoritative. No application source files were modified for this report.

## 1. Executive Summary

ChatSphere is a full-stack real-time chat product with a Next.js web frontend, a Go/Gin backend, WebSocket realtime delivery, persistent messaging/status/group/call data, Cloudinary-backed media uploads with local database fallback, Gemini-powered AI chat, and an Android WebView wrapper around the hosted web app.

Architecture overview:

| Area | Current Architecture |
|---|---|
| Frontend | Next.js 14 app router. The main product shell is concentrated in `frontend/src/components/AppShell.tsx`; supporting components include `AudioCall.tsx`, `AIChat.tsx`, `mediaCompression.ts`, `webrtcConfig.ts`, and simple data mapping helpers. Styling is Tailwind with Geist typography. |
| Backend | Go module under `backend/`, Gin router in `backend/internal/http/router.go`, store abstraction in `backend/internal/store/store.go`, realtime hub/client in `backend/internal/realtime/`, Gemini client in `backend/internal/gemini/`, config in `backend/internal/config/`. |
| Database/storage | Primary configured path is PostgreSQL via `DATABASE_URL`. Store also contains MySQL migration code and a JSON file fallback for several systems. Direct messages, attachments, and some features require SQL DB. |
| Realtime | `/ws?token=...` authenticates a signed token and upgrades to Gorilla WebSocket. Hub tracks online users, last seen, targeted dispatch, call sessions, and message/call/group/reaction events. |
| Authentication | Email OTP request/verify for signup flow, password login, password reset by email code, profile onboarding, HMAC-signed bearer tokens, in-memory token revocation for logout, separate admin token. |
| Media storage | Upload endpoint accepts multipart files. If Cloudinary credentials are configured, files are uploaded to Cloudinary; otherwise files are stored in the database `attachments` table and downloaded via `/api/v1/files/:id`. Frontend compresses large images/videos before upload. |
| AI integration | Backend-only Gemini REST client with system instruction, daily quota, cooldown, IP rate limiting, timeout, and safe error responses. Frontend AI chat is session-only in `AppShell`. |
| Android | Native Kotlin WebView wrapper loads `https://chat-sphere-ruby.vercel.app/`, enables JavaScript/DOM storage/cookies, file chooser, camera/microphone permission handling, and `AndroidBridge.setCallActive`. |
| Deployment | Frontend appears Vercel/Netlify compatible. Backend has Railway config and docs mention Render/Railway. PostgreSQL/Supabase variables exist; Cloudinary, Brevo, Gemini, Metered TURN are supported by env configuration. |

## 2. Complete Feature Inventory

Statuses: COMPLETE means implemented end-to-end enough to be usable. PARTIAL means implemented with gaps. PLACEHOLDER/STUBBED means route/UI exists but returns stub or is not wired. NOT IMPLEMENTED means no meaningful code path found.

| Feature | Status | Frontend | Backend | Realtime | Persistent | Notes |
|---|---:|---|---|---|---|---|
| Email OTP request | COMPLETE | Signup/forgot flows call email code routes | Brevo SMTP code sending, 10 min expiry, 5 per 15 min limit | No | In-memory code store | Requires Brevo config; codes lost on server restart. |
| Email OTP verify | COMPLETE | Code screens | `/api/v1/auth/email/verify-code` | No | No | Verifies code and then frontend proceeds. |
| Signup/onboarding | COMPLETE | Signup then profile step | `/api/v1/profile/onboarding` creates user | No | Users table/JSON | Includes password and avatar. |
| Login | COMPLETE | Login form | `/api/v1/auth/login` | No | User table | Password hash checked. |
| Logout | PARTIAL | Clears localStorage | `/api/v1/auth/logout` revokes token | No | In-memory revocation | Revocation lost on restart. |
| Token/session handling | PARTIAL | localStorage auth/profile/admin tokens | HMAC bearer token with TTL | WebSocket uses token query | No server session table | Uses `AUTH_SECRET`, not `JWT_SECRET`; default dev secret if unset. |
| Password reset | COMPLETE | Forgot/reset screens | request, verify, complete endpoints | No | User password hash | Code store is in-memory. |
| Profile creation | COMPLETE | Onboarding profile UI | `UpsertUser` | No | User profile fields | Includes uploaded or built-in/random avatar. |
| Profile editing | COMPLETE | Profile editor modal | `PATCH /api/v1/profile` | No | User table | First/last/avatar update. |
| First/last name | COMPLETE | Shown/edited | Stored in `app_users` | No | Yes | Used in directory/messages/status/groups. |
| Uploaded profile picture | COMPLETE | File picker preview/upload | Multipart onboarding/profile upload path | No | URL in user | Upload uses existing upload handling. |
| Built-in profile avatars | COMPLETE | 10-avatar picker | Approved `/avatars/avatar-01..10.png` validation | No | `avatar_url` path | Uses local public assets. |
| Random default avatar | COMPLETE | On profile completion if none chosen | Accepts built-in path | No | Saved once as avatar URL | Frontend chooses once during onboarding. |
| Avatar validation | COMPLETE | Restricts picker list | Backend allows known local paths or uploaded URLs | No | N/A | Prevents arbitrary local paths. |
| Online status | COMPLETE | Directory/chats show online | Hub online map exposed via users list | `presence.updated` | In-memory | Not persisted. |
| Last seen | PARTIAL | Shows last seen | Hub lastSeen map | `presence.updated` | In-memory | Lost on restart; 15s disconnect grace. |
| User search/directory | COMPLETE | Search/users views | `/api/v1/users` search | Presence folded in | Users table | Excludes current user, blocked users filtered. |
| Direct conversation creation | COMPLETE | Selecting/sending to user | Message save creates conversation ID | `chat.message` | Messages table | Conversation ID derived from sorted users. |
| Direct text messages | COMPLETE | Composer, bubbles | `SaveMessage` | WebSocket and HTTP | Messages table | SQL DB required for direct messages. |
| Optimistic messages | COMPLETE | Local pending message and retry | Idempotent client IDs | `message_sent` ack | Yes after save | Retry queue in frontend. |
| Message ordering | COMPLETE | Sorted by created time/list order | Queries order desc then reverse | N/A | Yes | Uses indexes on conversation. |
| Send queue/retry | COMPLETE | Queue, failed state, retry | Save via WS or HTTP | Ack/fail events | Yes | Handles upload and send progress. |
| Realtime delivery | COMPLETE | WebSocket listener | Hub targeted broadcast | `chat.message` | Yes | Also HTTP send broadcasts. |
| Timestamps | COMPLETE | UI formats time | `created_at` | Included | Yes | Direct/group/status/calls. |
| Auto-scroll | COMPLETE | Scroll refs/effects | N/A | N/A | N/A | Present for chats/groups. |
| Drafts | PARTIAL | In-memory per-chat drafts | No | No | No | Not persisted across reload. |
| Typing indicators | COMPLETE | Sends start/stop | `/api/v1/messages/typing` | `typing.start`, `typing.stop` | No | Direct chats only. |
| Images/videos/files | COMPLETE | Attachment preview, file picker | Upload + message attachment fields | Message payload includes attachment | Yes | Cloudinary or DB file storage. |
| Voice messages | COMPLETE | MediaRecorder and custom voice player | Upload audio attachment | Message payload includes audio | Yes | Direct and group support. |
| Media compression | COMPLETE | Image canvas, video ffmpeg.wasm | Backend config endpoint controls limits | No | N/A | Uses CDN-loaded ffmpeg core. |
| Cloudinary | COMPLETE | Upload receives URL | Signed server upload to Cloudinary | No | Attachment metadata | Falls back to DB storage. |
| Message reactions | COMPLETE | Picker, chips, details modal | Direct/group endpoints, summary storage | `message.reaction` | `message_reactions` | One reaction per user per message; same toggles off. |
| Reaction counts/details | COMPLETE | Chips and modal users | Summary includes users | Included in events | Yes | Sends user list in message summaries. |
| Replies/quote messages | NOT IMPLEMENTED | No UI | No schema/endpoint | No | No | Missing. |
| Forwarding | NOT IMPLEMENTED | No UI | No endpoint | No | No | Missing. |
| Editing messages | PARTIAL | No visible edit UI found | `PATCH /api/v1/messages/:id` | No realtime edit event | Yes | Backend supports sender updating body only. |
| Deleting messages | PARTIAL | Some menu/delete support exists for clearing/deleting | Delete own message/conversation endpoints | No delete event | Yes | Not "delete for everyone"; access is sender-scoped. |
| Read receipts | PARTIAL | Sent/Seen display | `read_at`, mark conversation read endpoint | `chat.read` | Yes | Read state exists, delivered receipt does not. |
| Delivered receipts | NOT IMPLEMENTED | No distinct delivered state | No delivered field | No | No | Missing. |
| Unread counts | PARTIAL | ChatSeed has `unread`; not clearly maintained from backend | No explicit unread endpoint | No | ReadAt can infer | Needs robust counters. |
| Pinning/archiving/muting | NOT IMPLEMENTED | No verified UI | No schema/endpoints | No | No | Missing. |
| Message search | PARTIAL | In-chat search UI state | No backend search endpoint | No | No | Client-side only over loaded messages. |
| Link previews | NOT IMPLEMENTED | No previewer | No metadata fetch | No | No | Missing. |
| Blocking | COMPLETE | Contact/chat menu/admin | User block store and routes | Blocks checked in send/call/search | Yes | Direct message/call restrictions present. |
| Reporting | PARTIAL | Report endpoints/admin reports | `/contacts/:id/report` and admin list/resolve | No | Yes | UI exposure may be limited. |
| Group creation | COMPLETE | Create group modal | `CreateGroup` | No creation event | Groups/members tables | Owner plus selected members. |
| Group avatar | PARTIAL | File selected but group create/update sends avatarUrl | Store has avatar_url | No | Yes | Group photo upload flow appears less complete than profile/media upload. |
| Group owner/admins | COMPLETE | Info panel roles | Role checks and promote/demote | No | `group_members.role` | Owner/admin permissions enforced. |
| Add/remove/leave group | COMPLETE | Group info actions | Endpoints implemented | No membership events | Yes | Owner cannot leave per UI. |
| Group info | COMPLETE | Side panel | `GET /groups/:id` | No | Yes | Members/roles returned. |
| Group messages | COMPLETE | Group chat panel | HTTP and WS save/list | `group.message`, ack | Yes | Attachments and voice supported. |
| Group reactions | COMPLETE | Same reaction UI | Group reaction endpoint | `message.reaction` | Yes | Membership checked. |
| Status text/image/video | COMPLETE | Composer, media/text viewer | Status endpoints | No | `statuses` | 24h expiry. |
| Status captions/backgrounds | COMPLETE | Caption/background UI | Fields stored | No | Yes | Text backgrounds and media captions. |
| Status grouping/recent/viewed | COMPLETE | Groups by user and viewed state | List includes viewed flag | No | Status + views | Client groups active statuses. |
| Status viewer/progress/auto advance | COMPLETE | Full-screen viewer | N/A | No | N/A | Video metadata controls duration. |
| Status view tracking/list | COMPLETE | Marks viewed, owners can see viewers | View endpoints | No | `status_views` | Owner-only viewer list. |
| Delete status | COMPLETE | Owner delete button | Delete endpoint owner-check | No | Yes | Owner only. |
| Audio calling | COMPLETE | WebRTC hook/overlay | Signaling hub + history | `call_*` events | Call history | Direct and invited multiparty calls supported by signaling. |
| Video calling | COMPLETE | Camera controls/video UI | Same signaling | `call_*` | Call history | Uses getUserMedia and RTCPeerConnection. |
| TURN/STUN | COMPLETE | `webrtcConfig.ts` | N/A | N/A | Env controlled | Google STUN plus Metered TURN if env set. |
| Incoming/outgoing/answer/reject/end | COMPLETE | Overlay and state machine | WebSocket validates sessions | `call_offer`, `call_answer`, etc. | History for initial call | Reconnect grace included. |
| Call history/missed/duration | COMPLETE | Calls tab/list | `call_history` table and endpoint | No | Yes | History status updates on signaling/end. |
| Group calling | PARTIAL | Invite participant and up to 4 peers | Hub call sessions support invited users | `call_join`, participant events | Initial history only | Not tied to chat group membership as a group call feature. |
| Gemini AI integration | COMPLETE | AIChat component | `/api/v1/ai/chat` | No | Usage count only | No AI conversation persistence. |
| AI quotas/rate limiting | COMPLETE | Error display | Daily, cooldown, IP limiter | No | `ai_usage` | Per-user daily persisted in SQL/JSON. |
| AI conversation persistence | NOT IMPLEMENTED | Session state only | No messages table | No | No | Missing. |
| Desktop sidebar/nav | COMPLETE | Sidebar for chats/search/users/files/AI and panels | N/A | N/A | N/A | Documents nav removed; shared files still accessible in workspace mode. |
| Mobile bottom navigation | COMPLETE | Chats/status/groups/calls bottom tabs | N/A | N/A | N/A | AI opens as mobile overlay/drawer. |
| Mobile drawer | PARTIAL | Drawer state exists | N/A | N/A | N/A | Documents removed; AI/profile/admin access from UI. |
| Shared files functionality | PARTIAL | Workspace mode `"files"` remains | Upload/file download exists | No | Attachments | Navigation entry for Documents removed; code may be reachable indirectly/legacy. |
| Admin functionality | PARTIAL | Admin screen | Login/users/block/delete/reports/resolve | No | Users/reports | Admin credentials are static env/default password. |
| Notifications/browser push | NOT IMPLEMENTED | No service worker/push | No notification service | No | No | Missing. |
| PWA/offline | NOT IMPLEMENTED | No manifest/service worker found | N/A | N/A | No | Missing. |

## 3. Database Schema

Store supports:

- PostgreSQL via `DATABASE_URL`: primary production path in `store.New`.
- JSON file fallback via `DATA_PATH`: supports users, statuses, groups, group messages, reactions, call history, reports, blocks, etc., but direct message and attachment saving currently require SQL DB.
- MySQL code exists in migrations and helpers but `store.New` currently opens Postgres from `DATABASE_URL`; `MySQLDSN` is in config but not passed from `cmd/server/main.go`.
- Mongo/Supabase env fields exist but no active Mongo/Supabase client implementation was found.

Current SQL tables from migration code:

| Table | Purpose | Important Columns | Primary Key / Constraints | Indexes | Used By |
|---|---|---|---|---|---|
| `app_users` | Accounts/profiles/admin user management | `id`, `email`, `first_name`, `last_name`, `password_hash`, `avatar_url`, `blocked`, `created_at`, `updated_at` | `id` PK, `email` unique | Email unique implicit | Auth, profiles, directory, groups, messages, status, calls, admin |
| `messages` | Direct chat messages | `seq`, `id`, `conversation_id`, `sender_email`, `sender_id`, `recipient_id`, `body`, `attachment_*`, `read_at`, `created_at` | `id` PK; MySQL `seq` unique/autoincrement; Postgres `seq bigserial` added | `idx_messages_conversation_created(conversation_id, created_at, seq)` | Direct messages, inbox, read receipts, reactions |
| `user_blocks` | User blocking relationships | `blocker_id`, `blocked_id`, `created_at` | Composite PK `(blocker_id, blocked_id)` | None explicit | Blocking, search filtering, send/call authorization |
| `reports` | Moderation reports | `id`, `reporter_id`, `reported_id`, `message_id`, `reason`, `status`, `created_at`, `resolved_at` | `id` PK | None explicit | Report user/admin moderation |
| `attachments` | Local DB file storage and Cloudinary metadata | `id`, `owner_id`, `name`, `content_type`, `kind`, `size_bytes`, `content`, `cloudinary_url`, `cloudinary_public_id`, `created_at` | `id` PK | `idx_attachments_owner(owner_id)` | Uploads/downloads/direct/group/status media |
| `ai_usage` | Daily AI quota usage | `user_id`, `usage_date`, `request_count`, `updated_at` | Composite PK `(user_id, usage_date)` | None explicit | Gemini quota |
| `call_history` | Persisted call logs | `id`, `caller_id`, `recipient_id`, `call_type`, `status`, `started_at`, `answered_at`, `ended_at`, `duration_seconds` | `id` PK | `idx_call_history_caller`, `idx_call_history_recipient` | Calls tab/history |
| `statuses` | Status updates | `id`, `user_id`, `type`, `text_content`, `media_url`, `caption`, `background`, `created_at`, `expires_at` | `id` PK | `statuses_user_expiry(user_id, expires_at)` | Status feed/viewer |
| `status_views` | Status view tracking | `status_id`, `viewer_id`, `viewed_at` | Composite PK `(status_id, viewer_id)` | None explicit | Viewed state/viewer list |
| `groups` | Chat groups | `id`, `name`, `avatar_url`, `owner_id`, `created_at`, `updated_at` | `id` PK | None explicit | Groups list/details |
| `group_members` | Group membership and roles | `group_id`, `user_id`, `role`, `joined_at` | Composite PK `(group_id, user_id)` | None explicit | Group permissions/members |
| `group_messages` | Group messages | `id`, `group_id`, `sender_id`, `sender_email`, `body`, `attachment_*`, `created_at` | `id` PK | `group_messages_group_created(group_id, created_at)` | Group chat |
| `message_reactions` | Direct/group reactions | `message_type`, `message_id`, `user_id`, `emoji`, `created_at` | Composite PK `(message_type, message_id, user_id)` | `idx_message_reactions_message(message_type, message_id)` | Reaction add/replace/toggle and summaries |

JSON fallback structure (`dataFile`) contains arrays for users, messages, attachments, blocks, reports, calls, statuses, status views, groups, group members, group messages, and reactions. It does not provide all SQL-only behavior for direct message/attachment save paths.

## 4. Complete API Inventory

Auth:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| POST | `/api/v1/auth/register` | No | Legacy register placeholder | STUBBED |
| POST | `/api/v1/auth/login` | No | Password login, returns signed token/profile | COMPLETE |
| POST | `/api/v1/auth/refresh` | No | Token refresh placeholder | STUBBED |
| POST | `/api/v1/auth/logout` | Bearer | Revoke current token in memory | PARTIAL |
| POST | `/api/v1/auth/email/request-code` | No | Send OTP code via Brevo | COMPLETE |
| POST | `/api/v1/auth/email/verify-code` | No | Verify OTP code | COMPLETE |
| POST | `/api/v1/auth/forgot-password` | No | Send password reset code | COMPLETE |
| POST | `/api/v1/auth/password-reset/verify` | No | Verify reset code | COMPLETE |
| POST | `/api/v1/auth/password-reset/complete` | No | Change password after valid code | COMPLETE |

Users/profile/contacts:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| GET | `/api/v1/users` | Bearer | Search/list users with presence | COMPLETE |
| GET | `/api/v1/users/:id` | No/implicit | Placeholder get user | STUBBED |
| GET | `/api/v1/profile` | No/implicit | Placeholder get profile | STUBBED |
| POST | `/api/v1/profile/onboarding` | No | Create profile/account; multipart or JSON | COMPLETE |
| PATCH | `/api/v1/profile` | Bearer | Update profile/avatar | COMPLETE |
| PATCH | `/api/v1/profile/privacy` | No/implicit | Privacy placeholder | STUBBED |
| PATCH | `/api/v1/profile/status` | No/implicit | Status placeholder, unrelated to status feature | STUBBED |
| GET | `/api/v1/contacts` | No/implicit | Contacts placeholder | STUBBED |
| POST | `/api/v1/contacts/requests` | No/implicit | Contact request placeholder | STUBBED |
| POST | `/api/v1/contacts/:id/block` | Bearer | Block user | COMPLETE |
| DELETE | `/api/v1/contacts/:id/block` | Bearer | Unblock user | COMPLETE |
| POST | `/api/v1/contacts/:id/report` | Bearer | Report user/message | COMPLETE |

Messages/media:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| GET | `/api/v1/messages/inbox` | Bearer | Latest direct messages/inbox | COMPLETE |
| GET | `/api/v1/messages/:recipientId` | Bearer | Direct conversation history | COMPLETE |
| POST | `/api/v1/messages` | Bearer | Send direct message via HTTP | COMPLETE |
| POST | `/api/v1/messages/:recipientId/read` | Bearer | Mark conversation read and broadcast | COMPLETE |
| PATCH | `/api/v1/messages/:id` | Bearer | Update own message body | PARTIAL |
| DELETE | `/api/v1/messages/conversation/:recipientId` | Bearer | Clear conversation for actor | PARTIAL |
| DELETE | `/api/v1/messages/:id` | Bearer | Delete own message | PARTIAL |
| POST | `/api/v1/messages/typing` | Bearer | Broadcast typing start/stop | COMPLETE |
| POST | `/api/v1/messages/reactions/:id` | Bearer | Toggle direct message reaction | COMPLETE |
| POST | `/api/v1/upload` | Bearer | Upload attachment/avatar/media | COMPLETE |
| GET | `/api/v1/files/:id` | Bearer | Download stored DB attachment | COMPLETE |

Groups:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| GET | `/api/v1/groups` | Bearer | List groups for current user | COMPLETE |
| POST | `/api/v1/groups` | Bearer | Create group | COMPLETE |
| GET | `/api/v1/groups/:id` | Bearer/member | Group details | COMPLETE |
| PATCH | `/api/v1/groups/:id` | Bearer/admin-owner | Update group name/avatar URL | COMPLETE |
| POST | `/api/v1/groups/:id/members` | Bearer/admin-owner | Add members | COMPLETE |
| DELETE | `/api/v1/groups/:id/members/:userId` | Bearer/role checks | Remove member or leave | COMPLETE |
| POST | `/api/v1/groups/:id/admins/:userId` | Bearer/owner | Promote admin | COMPLETE |
| DELETE | `/api/v1/groups/:id/admins/:userId` | Bearer/owner | Demote admin | COMPLETE |
| GET | `/api/v1/groups/:id/messages` | Bearer/member | List group messages | COMPLETE |
| POST | `/api/v1/groups/:id/messages` | Bearer/member | Send group message | COMPLETE |
| POST | `/api/v1/groups/:id/messages/:messageId/reactions` | Bearer/member | Toggle group reaction | COMPLETE |

Status:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| GET | `/api/v1/statuses` | Bearer | List active statuses | COMPLETE |
| GET | `/api/v1/statuses/user/:id` | Bearer | List active statuses by owner | COMPLETE |
| POST | `/api/v1/statuses` | Bearer | Create text/image/video status | COMPLETE |
| POST | `/api/v1/statuses/:id/view` | Bearer | Mark viewed | COMPLETE |
| GET | `/api/v1/statuses/:id/viewers` | Bearer/owner | List viewers | COMPLETE |
| DELETE | `/api/v1/statuses/:id` | Bearer/owner | Delete status | COMPLETE |

Calls/AI/admin/other:

| Method | Path | Auth | Purpose | Status |
|---|---|---:|---|---|
| GET | `/api/v1/calls/history` | Bearer | Call history | COMPLETE |
| POST | `/api/v1/ai/chat` | Bearer | Gemini response with quotas | COMPLETE |
| POST | `/api/v1/admin/login` | No | Static admin login | COMPLETE |
| GET | `/api/v1/admin/users` | Admin bearer | List users | COMPLETE |
| DELETE | `/api/v1/admin/users/:id` | Admin bearer | Delete user | COMPLETE |
| POST | `/api/v1/admin/users/:id/block` | Admin bearer | Block user | COMPLETE |
| POST | `/api/v1/admin/users/:id/unblock` | Admin bearer | Unblock user | COMPLETE |
| GET | `/api/v1/admin/reports` | Admin bearer | List reports | COMPLETE |
| POST | `/api/v1/admin/reports/:id/resolve` | Admin bearer | Resolve report | COMPLETE |
| GET | `/api/v1/config` | No auth in code | Upload/compression config | COMPLETE |
| GET | `/` | No | Service status | COMPLETE |
| GET | `/health` | No | DB health | COMPLETE |
| GET | `/ws?token=` | Token query | WebSocket upgrade | COMPLETE |

## 5. WebSocket / Realtime Inventory

Connection lifecycle:

- Frontend opens WebSocket with `wsUrl(authToken)` when authenticated.
- Backend validates token query before upgrade.
- Hub registers client, increments online count, broadcasts `presence.updated` when first connection comes online.
- Ping/pong keepalive is configured in client write/read pumps.
- On disconnect, hub waits 15 seconds before marking offline and cleaning calls to tolerate reconnects.
- Frontend reconnects by incrementing `socketAttempt`; during active calls it rejoins call after reconnect and has a 15s call reconnect grace period.

Events:

| Event | Direction | Purpose | Persistent? | Used By |
|---|---|---|---:|---|
| `presence.updated` | Server to clients | Online/offline and last seen | No | User lists, chat headers |
| `message_send` | Client to server | Send direct message over WS | Yes | Direct message queue |
| `message_sent` | Server to sender | Ack/fail direct message | Message yes, ack no | Send queue |
| `chat.message` | Server to clients | Deliver direct message | Yes | Direct chats/inbox |
| `chat.read` | Server to clients | Conversation read state | Yes (`read_at`) | Read receipt UI |
| `typing.start` | Server to clients | Direct typing started | No | Chat header typing |
| `typing.stop` | Server to clients | Direct typing stopped | No | Chat header typing |
| `group_message_send` | Client to server | Send group message over WS | Yes | Group chat |
| `group_message_sent` | Server to sender | Ack/fail group message | Message yes, ack no | Group send flow |
| `group.message` | Server to group members | Deliver group message | Yes | Groups |
| `message.reaction` | Server to participants/members | Updated reaction summary | Yes | Direct/group reaction UI |
| `call_offer` | Both | WebRTC offer / invite signaling | Call history for initial call | Calls |
| `call_answer` | Both | WebRTC answer | Status history answered | Calls |
| `call_ice_candidate` | Both | ICE signaling | No | Calls |
| `call_reject` | Both | Reject/busy/blocked | Updates initial history | Calls |
| `call_end` | Both | End call or cleanup | Updates history ended/missed | Calls |
| `call_camera_toggle` | Both | Camera state | No | Video call UI |
| `call_join` | Client to server | Rejoin/join call session | No | Multiparty call |
| `call_full` | Server to caller | Capacity reached | No | Calls |
| `call_participant_joined` | Server to participants | New participant | No | Multiparty calls |
| `call_participant_left` | Server to participants | Participant left | No | Multiparty calls |

## 6. Frontend Component / State Map

Major components/files:

| File/Component | Role |
|---|---|
| `frontend/src/app/layout.tsx` | Root metadata, Geist font, global CSS. |
| `frontend/src/app/page.tsx` | Renders `AppShell`. |
| `frontend/src/app/privacy/page.tsx`, `terms/page.tsx` | Static legal pages. |
| `frontend/src/components/AppShell.tsx` | Main application: auth, profile, chats, groups, status, calls, AI, admin, uploads, reactions, modals, responsive navigation. Very large and tightly coupled. |
| `frontend/src/components/AudioCall.tsx` | WebRTC call hook and overlay UI. |
| `frontend/src/components/AIChat.tsx` | AI chat presentation. |
| `frontend/src/lib/data.ts` | User-to-chat mapping and types. |
| `frontend/src/lib/mediaCompression.ts` | Image/video compression and ffmpeg.wasm loading. |
| `frontend/src/lib/webrtcConfig.ts` | STUN/TURN ICE server config. |

Important `AppShell.tsx` state clusters:

- Auth/profile: `isAuthed`, `authStep`, email/code/password/profile fields, `authToken`, `currentUserId`, profile editor, built-in avatar picker.
- Admin: `isAdmin`, `adminToken`, `adminUsers`, `adminReports`, admin error/loading.
- Direct chat: selected chat, snapshots, `chatMessages`, `drafts`, send queue refs, upload progress, typing refs, search/menu/clear state, blocked IDs.
- Groups: selected group, summaries, details, messages, loading/error, group info state.
- Status: nested `StatusPanel` owns status list, composer, viewer, progress, viewers.
- Calls: `useAudioCall` state plus call history tab/search/loading in `AppShell`.
- Reactions: `reactionPicker`, `reactionDetails`, `MessageReactions` component, `reactToMessage`, websocket reaction patching.
- AI: `aiMessages`, `aiInput`, `isAiLoading`, `aiError`, `isMobileAIChatOpen`.
- Responsive/mobile: `mobileTab`, `isMobileDrawerOpen`, conditional panels, bottom nav.
- Local storage: `chatsphere-admin-token`, `chatsphere-auth`, `chatsphere-email`, `chatsphere-user-id`, `chatsphere-token`, `chatsphere-profile-complete`, `chatsphere-profile`, `chatsphere-onboarding-draft`; message cache key removal exists for `chatsphere-messages:${email}`.

Tight coupling:

- `AppShell.tsx` is over 5,000 lines and owns authentication, routing-like view selection, messaging, groups, status, AI, admin, uploads, reactions, and profile modals.
- Direct and group message rendering/upload/sending code is duplicated in spirit.
- Mobile and desktop UI are conditionally interleaved in the same component.
- Several endpoints/features exist in backend but have little or no visible frontend wiring.

## 7. Mobile vs Desktop

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| Chats | Multi-pane layout with sidebar/list and chat pane | Mobile tab/list/detail behavior | Mobile bottom navigation exists. |
| Groups | Groups panel and group chat pane | Groups bottom tab and back button | Same backend; mobile layout tighter. |
| Status | Status panel in main workspace | Status bottom tab | Status viewer is full-screen on both. |
| Calls | Calls navigation/tab and call overlay | Calls bottom tab and overlay | WebRTC uses same code. |
| AI | Workspace mode `"ai"` panel | Mobile AI overlay/open state | AI chat not persisted on either. |
| Profile | Header/sidebar/profile editor modal | Mobile-accessible modal/drawer/profile controls | Same profile update endpoint. |
| Search/users | Desktop workspace modes | Mobile drawer/search states | User directory backend shared. |
| Navigation | Left sidebar/workspace modes | Bottom tabs plus drawer | Documents navigation removed; files mode still in type/code. |
| Attachments | File picker, previews, compression | Same browser file input; Android WebView file chooser supports native picker | Upload behavior shared. |
| Voice messages | MediaRecorder UI and voice player | Same if browser/WebView supports media APIs | Android grants mic. |
| Reactions | Button/chips/picker below bubbles | Tap-friendly same controls | Hover-only dependency avoided. |
| Calling | Audio/video overlay, invite controls | Same overlay, Android bridge keeps WebView active | Native Android only wraps WebView. |

## 8. Android App

Current Android wrapper functionality:

| Area | Current State |
|---|---|
| Native architecture | Kotlin Android app with a single `MainActivity` extending `AppCompatActivity`. |
| WebView | Creates a full-screen `WebView`, enables JavaScript, DOM storage, database storage, cookies, and third-party cookies. |
| Loaded website | Hard-coded `https://chat-sphere-ruby.vercel.app/`. |
| File picker | Implements `WebChromeClient.onShowFileChooser` with `ActivityResultContracts.StartActivityForResult`; supports web app file inputs. |
| Permissions | Manifest has `INTERNET`, `RECORD_AUDIO`, `CAMERA`; camera feature optional. Runtime permission grant maps WebView audio/video capture requests to Android permissions. |
| Microphone/camera | WebRTC/media recording in web app can request mic/camera; native shell grants/denies resources. |
| Native bridge | `AndroidBridge.setCallActive(active)` lets web app tell Android not to pause WebView during active calls. |
| Back button | Goes back in WebView history; exits/minimizes if no history. |
| Downloads/uploads | Uploads handled through WebView file chooser and web app upload API. No custom native download manager found. |
| Limitations | No native push notifications, contacts integration, share sheet, background service, call notification, deep links, native downloads, biometric auth, or native offline storage. Most app functionality is web-provided. |

## 9. Environment Variables

Backend:

| Variable | Required/Optional | Purpose | Secret? |
|---|---|---|---:|
| `PORT` | Optional | Backend listen port; default `8080` | No |
| `APP_ENV` | Optional | Gin release mode if `production` | No |
| `FRONTEND_ORIGIN` | Required in deployment | CORS allowed origin | No |
| `JWT_SECRET` | Optional/currently unused for signing | Config field only | Yes |
| `AUTH_SECRET` | Required in production | HMAC token signing secret | Yes |
| `AUTH_TOKEN_TTL_HOURS` | Optional | User/admin token TTL | No |
| `MYSQL_DSN` | Optional/legacy | Config field and MySQL helpers; not wired in server main | Yes |
| `MONGO_URI` | Optional/unused | Config field only | Yes |
| `DATABASE_URL` | Required for direct messages/uploads in production | PostgreSQL connection | Yes |
| `SUPABASE_URL` | Optional/unused | Config field only | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional/unused | Config field only | Yes |
| `BREVO_API_KEY` | Required for OTP email | Brevo SMTP API | Yes |
| `BREVO_SENDER_EMAIL` | Required for OTP email | Sender email | No |
| `BREVO_SENDER_NAME` | Optional | Sender display name | No |
| `ADMIN_EMAIL` | Optional but should set | Admin login email | No |
| `ADMIN_PASSWORD` | Optional but should set | Admin login password | Yes |
| `DATA_PATH` | Optional | JSON fallback path | No |
| `GEMINI_API_KEY` | Required for AI | Gemini API key | Yes |
| `GEMINI_MODEL` | Optional | Gemini model | No |
| `GEMINI_DAILY_LIMIT` | Optional | Per-user daily AI quota | No |
| `GEMINI_IP_RATE_LIMIT` | Optional | Per-minute IP AI limit | No |
| `GEMINI_REQUEST_COOLDOWN_SECONDS` | Optional | Per-user AI cooldown | No |
| `GEMINI_MAX_MESSAGE_LENGTH` | Optional | Prompt max length | No |
| `GEMINI_MAX_OUTPUT_TOKENS` | Optional | Gemini output cap | No |
| `GEMINI_TIMEOUT_SECONDS` | Optional | Gemini request timeout | No |
| `TRUSTED_PROXIES` | Optional | Gin trusted proxy list for client IP | No |
| `CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary upload target | No |
| `CLOUDINARY_API_KEY` | Optional | Cloudinary API key | Yes |
| `CLOUDINARY_API_SECRET` | Optional | Cloudinary API secret | Yes |
| `CLOUDINARY_UPLOAD_PRESET` | Optional | Cloudinary unsigned/signed preset reference | Maybe |
| `MAX_UPLOAD_SIZE_MB` | Optional | Upload limit and frontend config | No |
| `IMAGE_OPTIMIZE_THRESHOLD_BYTES` | Optional | Frontend compression threshold | No |
| `VIDEO_OPTIMIZE_THRESHOLD_BYTES` | Optional | Frontend compression threshold | No |
| `IMAGE_MAX_DIMENSION` | Optional | Image resize cap | No |
| `VIDEO_MAX_DIMENSION` | Optional | Video resize cap | No |

Frontend:

| Variable | Required/Optional | Purpose | Secret? |
|---|---|---|---:|
| `NEXT_PUBLIC_API_URL` | Required in deployment | Backend API base URL | No |
| `NEXT_PUBLIC_WS_URL` | Optional | Explicit WebSocket URL | No |
| `NEXT_PUBLIC_ADMIN_EMAIL` | Optional | Admin UI email default | No |
| `NEXT_PUBLIC_TURN_USERNAME` | Optional | Metered TURN username | Not highly secret but public |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | Optional | Metered TURN credential sent to clients | Treat as sensitive-ish but public by design |
| `PORT` | Optional | Local static server port | No |

Android:

- No environment variable mechanism found. Host URL is hard-coded in `MainActivity.kt`.

## 10. Deployment

| Area | Current Evidence |
|---|---|
| Frontend | Next.js project with `next.config.mjs`; root and frontend `netlify.toml`; docs mention Vercel. Android loads a Vercel URL. |
| Backend | Go server under `backend/cmd/server`; `backend/railway.json` present. Docs mention Render/Railway style deployment. |
| Database | PostgreSQL via `DATABASE_URL` is the active SQL path. Supabase env variables are present but no Supabase client code found. |
| Media | Cloudinary credentials supported; if absent, uploads fall back to local DB attachment rows. |
| AI | Gemini API key/model envs used by backend. |
| Email | Brevo SMTP API used for OTP/reset email. |
| Realtime/calls | WebSocket endpoint on backend; WebRTC uses Google STUN and optional Metered TURN. |
| Legacy/unused | Netlify configs may be legacy if Vercel is current. `MYSQL_DSN`, `MONGO_URI`, Supabase service role fields appear unused or not wired in current server entrypoint. |

## 11. Test Coverage

Existing backend tests found:

| Test File | Coverage |
|---|---|
| `backend/internal/http/router_integration_test.go` | Private messaging flow with DB skip, call history endpoint, status lifecycle, groups lifecycle/authorization, voice upload, config defaults, message idempotency/client IDs, reactions for direct and group messages. |
| `backend/internal/http/health_test.go` | Health/root behavior. |
| `backend/internal/http/ai_router_test.go` | AI route validation/rate/quota behavior. |
| `backend/internal/gemini/gemini_test.go` | Gemini client behavior and safety around API key/request handling. |

Covered areas:

- Auth/profile indirectly through `createTestUser`.
- Direct messages, blocked messaging, idempotency, voice upload.
- Calls history.
- Status create/view/viewers/delete.
- Groups lifecycle and permissions.
- Message reactions add/replace/toggle/unauthorized/readback.
- AI quota/rate/error behavior.
- Upload config defaults.

Important gaps:

- Frontend has no automated UI tests found.
- WebSocket realtime behavior is not deeply integration-tested end-to-end.
- WebRTC call signaling is complex and only partially covered through call history; peer negotiation UI is not tested.
- Admin routes have limited explicit test coverage.
- Profile avatar validation/built-in picker behavior is not clearly covered by tests.
- Media compression has no unit tests.
- Android wrapper has only generated example tests.

## 12. Security / Permissions Audit

| Area | Classification | Notes |
|---|---|---|
| Direct message access | GOOD | List/send/update/delete check authenticated sender/recipient in store methods. |
| Group permissions | GOOD | Group role checks for details, messages, admins, members; owner/admin distinction present. |
| Reaction authorization | GOOD | Direct reactions require sender/recipient; group reactions require membership. |
| Status ownership/access | GOOD | Create requires auth; viewers owner-only; delete owner-only; active statuses only. |
| Call signaling auth | NEEDS REVIEW | WebSocket is authenticated and validates participants, busy/block checks; signaling remains complex and should get more tests. |
| Upload authorization | GOOD | Upload requires auth; file download checks owner for DB attachments. Cloudinary URLs are public once shared. |
| Admin authorization | NEEDS REVIEW | Admin protected endpoints require admin token, but credentials have insecure defaults and are static env-based. |
| Avatar validation | GOOD | Built-in avatar paths restricted to known list; uploaded image behavior separate. |
| WebSocket origin | POTENTIAL ISSUE | WebSocket upgrader `CheckOrigin` returns true; token auth protects access, but origin restrictions are not enforced. |
| Token signing | NEEDS REVIEW | Uses `AUTH_SECRET`; if unset, defaults to local secret. `JWT_SECRET` config exists but is not signing source. |
| Logout/revocation | NEEDS REVIEW | Revoked token map is in-memory only; restart revalidates unexpired tokens. |
| OTP storage | NEEDS REVIEW | Codes/rate limits are in-memory only; restart clears them. |
| Trusted proxies/client IP | GOOD | Gin trusted proxies configured from env; defaults to trust none. |
| Large uploads | GOOD | Backend max upload size and frontend compression exist. |

## 13. UX / Technical Debt

Technical debt:

- `AppShell.tsx` is very large and tightly coupled across auth, chat, groups, status, calls, AI, admin, uploads, profile, and responsive UI.
- Direct/group message rendering and upload flows are separate and partially duplicated.
- Some backend route patterns are inconsistent: several `accepted(...)` stubs remain alongside real endpoints.
- Store supports JSON/Postgres/MySQL-shaped code, but direct message paths are SQL-only and MySQL is not wired in main.
- Token config names are confusing (`JWT_SECRET` in config, `AUTH_SECRET` in signing).
- Admin auth is separate/static rather than role-based user auth.
- Group avatar upload path appears less polished than profile/message uploads.

UX gaps:

- No mature chat management features: pin/archive/mute/star/reply/forward.
- Drafts are not persisted.
- AI chat is not persistent.
- No browser/push notifications.
- No visible onboarding around permissions/calls.
- Some mobile/desktop behavior is in one file and could regress easily.

Performance concerns:

- Reaction summaries include user lists with every message and can grow heavier in large groups.
- `reactionSummaries` queries per message ID instead of batching with `IN`.
- No explicit pagination UI beyond backend `limit` params; infinite scroll/history loading is limited.
- Large `AppShell` can slow iteration and increases bundle/component complexity.
- ffmpeg.wasm loads from CDN at runtime and can be heavy on mobile.
- Some group/member tables lack extra indexes beyond primary keys; acceptable now, needs review as scale grows.

## 14. Missing Modern Chat Features

Verified missing or partial:

| Feature | Current Status |
|---|---|
| Read receipts | PARTIAL: `read_at` and `chat.read`, but limited UX. |
| Delivered receipts | NOT IMPLEMENTED. |
| Unread counters | PARTIAL: type exists but robust backend counters not found. |
| Reply/quote message | NOT IMPLEMENTED. |
| Edit message | PARTIAL: backend endpoint exists; no clear full UI/realtime edit. |
| Delete for everyone | NOT IMPLEMENTED. |
| Forwarding | NOT IMPLEMENTED. |
| Pinned chats | NOT IMPLEMENTED. |
| Archived chats | NOT IMPLEMENTED. |
| Muted chats | NOT IMPLEMENTED. |
| Conversation/message search | PARTIAL: client-side loaded message search only. |
| Starred messages | NOT IMPLEMENTED. |
| Disappearing messages | NOT IMPLEMENTED. |
| Link previews | NOT IMPLEMENTED. |
| Browser/push notifications | NOT IMPLEMENTED. |
| Blocked users management screen | PARTIAL: block/unblock exists; full settings screen not found. |
| Report user | PARTIAL: endpoint/admin reports exist; UX likely limited. |
| Privacy settings | STUBBED route only. |
| Profile About/Bio | NOT IMPLEMENTED. |
| Group descriptions | NOT IMPLEMENTED. |
| Group invite links | NOT IMPLEMENTED. |
| Ownership transfer | NOT IMPLEMENTED. |
| Polls | NOT IMPLEMENTED. |
| Stickers/GIFs beyond profile avatars | NOT IMPLEMENTED. |
| Contact sharing | NOT IMPLEMENTED. |
| Location sharing | NOT IMPLEMENTED. |
| Screen sharing | NOT IMPLEMENTED. |
| PWA/offline support | NOT IMPLEMENTED. |

## 15. Recommended Next Features

Quick wins:

| Feature | Why It Matters | Complexity | Backend? | DB? | Realtime? | Likely Files |
|---|---|---:|---:|---:|---:|---|
| Persist drafts in localStorage | Users do not lose typed messages on reload | Low | No | No | No | `AppShell.tsx` |
| Full blocked users/settings screen | Makes existing block feature discoverable | Low | Maybe list endpoint | Maybe no | No | `AppShell.tsx`, `router.go`, `store.go` |
| Group description/about | Improves group identity | Low/Medium | Yes | Yes | No | `store.go`, `router.go`, `AppShell.tsx` |
| AI conversation persistence | Makes AI useful across sessions | Medium | Yes | Yes | No | `AIChat.tsx`, `AppShell.tsx`, `store.go`, `router.go` |
| Backend batched reaction summaries | Reduces future group latency | Medium | Yes | No schema | No | `store.go` |

Core messaging:

| Feature | Why It Matters | Complexity | Backend? | DB? | Realtime? | Likely Files |
|---|---|---:|---:|---:|---:|---|
| Reply/quote message | Modern chat baseline | Medium | Yes | Yes | Yes | `store.go`, `router.go`, `client.go`, `AppShell.tsx` |
| Edit message with realtime update | Completes existing backend partial | Medium | Yes | Maybe no | Yes | `router.go`, `client.go`, `AppShell.tsx` |
| Delete for everyone | User expectation and moderation | Medium | Yes | Maybe yes | Yes | `store.go`, `router.go`, `client.go`, `AppShell.tsx` |
| Robust unread counters | Essential chat list signal | Medium | Yes | Maybe yes | Yes | `store.go`, `router.go`, `AppShell.tsx` |
| Conversation search | Makes history usable | Medium | Yes | Indexes likely | No | `store.go`, `router.go`, `AppShell.tsx` |

Advanced/later:

| Feature | Why It Matters | Complexity | Backend? | DB? | Realtime? | Likely Files |
|---|---|---:|---:|---:|---:|---|
| Push notifications/PWA | Mobile retention and offline affordance | High | Yes | Yes | Maybe | Frontend app, backend notification service |
| Group invite links | Growth and group onboarding | Medium/High | Yes | Yes | No | Groups store/router/UI |
| Screen sharing | Advanced calling | High | Maybe | No | Yes | `AudioCall.tsx`, realtime |
| Polls | Rich group collaboration | Medium/High | Yes | Yes | Yes | Groups/messages schema/UI |
| Refactor AppShell into modules | Reduces regression risk | High | No | No | No | Frontend components/hooks |

Top 10 next features:

1. Reply/quote messages.
2. Robust unread counters and better chat list read state.
3. Edit message UI plus realtime edit event.
4. Delete for everyone plus realtime delete event.
5. Conversation/message search backed by API.
6. Persist AI conversations.
7. Full privacy/block/report settings screen.
8. Group descriptions and invite links.
9. Browser/PWA push notifications.
10. Refactor `AppShell.tsx` into feature modules/hooks.

## 16. Current Project Scorecard

| Area | Score | Explanation |
|---|---:|---|
| Direct messaging | 8/10 | Text/media/voice/realtime/retry/reactions/read state are strong; lacks replies, forwarding, delivery, mature search. |
| Groups | 7/10 | Persistent groups, roles, messages, attachments, reactions exist; lacks descriptions/invites/ownership transfer and stronger group-call integration. |
| Status | 8/10 | Text/image/video, expiry, viewer, progress, views, delete are solid. |
| Calls | 7/10 | Real WebRTC audio/video, TURN config, history, invite support; complex flow needs more tests and native notifications. |
| Profiles | 8/10 | Creation/editing, uploads, built-in avatars, random default, validation. Missing bio/about/privacy settings. |
| Realtime | 8/10 | Presence, messages, typing, reads, calls, groups, reactions. WebSocket origin and test coverage need review. |
| Mobile UX | 7/10 | Bottom tabs, responsive panels, Android wrapper; no native notifications/offline, AppShell complexity. |
| Desktop UX | 7/10 | Multi-pane app feels complete; some legacy/files/admin/AI flows are uneven. |
| Security/permissions | 7/10 | Good authorization checks; concerns around default secrets/admin defaults/in-memory revocation/WebSocket origin. |
| Code maintainability | 5/10 | Backend is organized, but `AppShell.tsx` is very large and coupled. |
| Testing | 6/10 | Backend integration coverage is meaningful; frontend/WebRTC/Android coverage sparse. |
| Overall product completeness | 7/10 | Strong chat foundation with modern media/status/calls/reactions; missing mature messaging and notification features. |

## 17. Git History

Latest 30 commits:

| Commit | Summary |
|---|---|
| `4ce6dff` | Add message reactions |
| `d4750da` | Remove Documents navigation |
| `cc96886` | Use 10 built-in profile avatars |
| `a0c1957` | Improve Chats profile and stats layout |
| `d96d6c6` | Add built-in profile avatars |
| `ef0920d` | Add built-in profile avatars |
| `538aad9` | Fix large screen group message alignment |
| `f00e590` | Fix group chat message alignment |
| `4a83587` | Fix bottom navigation layout |
| `195b781` | Remove mobile chats header pill |
| `02c33c1` | Improve mobile chats and last seen |
| `ed01d03` | Implement persistent groups system |
| `50f210b` | Fix status viewer progress and media previews |
| `475e07c` | Redesign status updates UI |
| `f7ef1a6` | Add persistent status updates |
| `cb0865e` | Fix desktop bottom navigation position |
| `b73f4ac` | Add persistent call history |
| `00b0b3f` | Add mobile bottom navigation and hide top stats on mobile |
| `b380968` | Fix large video compression |
| `4b34db5` | Fix large video compression |
| `b2d603b` | Add client-side media compression and upload progress |
| `6a3f8fc` | Implement reliable message delivery and retry |
| `7239b81` | Add automatic media optimization |
| `9b20227` | Add Cloudinary media storage integration |
| `fe9bbf8` | Add database health check endpoint |
| `1894d9c` | Upgrade voice message player UI |
| `466685a` | Add Metered TURN server configuration |
| `c84e3e9` | Update pnpm-lock.yaml to include geist font dependency |
| `4ab6445` | Implement authentication page responsive design and update font family to Geist Sans |
| `8d82678` | Fix group call UI flicker and stale call session handling |

Recent major feature themes:

- Calls: call history persistence, TURN config, group/multiparty call fixes.
- Status: persistent status updates, viewer/progress/media preview redesigns.
- Groups: persistent groups system, alignment fixes, group messaging.
- Mobile: bottom navigation, mobile chat/last seen improvements, layout fixes.
- Profiles: built-in avatars, 10-avatar picker, avatar rendering/layout.
- Messaging: reliable delivery/retry, Cloudinary/media compression, reactions.
- Navigation/layout: Documents nav removed, Chats profile/stats layout improved.

## 18. Final Report Summary

### Currently Complete

- Email OTP request/verify, password login/reset, onboarding/profile creation.
- Profile editing, uploaded avatars, built-in avatars, random default avatars.
- Direct text/media/file/video/image/voice messages with retry and realtime delivery.
- Cloudinary media storage with DB fallback.
- Message reactions for direct and group chats.
- Typing indicators, presence, last-seen display in current runtime.
- Persistent status updates with views, viewer list, expiry, delete.
- Persistent groups with roles, permissions, messages, attachments, reactions.
- WebRTC audio/video calling, signaling, TURN config, call history.
- Gemini AI endpoint with quota/rate/cooldown controls.
- Admin user/report moderation basics.
- Android WebView wrapper with file picker and media permissions.

### Currently Partial

- Logout/token revocation, because revocation is in-memory.
- Last seen, because it is in-memory.
- Read receipts and unread counts.
- Message editing/deleting, because backend exists but UX/realtime are incomplete.
- Group avatar upload polish.
- Group calling as a product feature, despite multiparty call signaling support.
- Shared files functionality, because backend/file code remains but navigation was removed.
- Admin/security settings, report UX, blocked-user management.
- AI chat experience, because conversations are not persisted.
- JSON/MySQL/Supabase storage support consistency.

### Currently Placeholder/Stubbed

- `/api/v1/auth/register`
- `/api/v1/auth/refresh`
- `/api/v1/users/:id`
- `/api/v1/profile`
- `/api/v1/profile/privacy`
- `/api/v1/profile/status`
- `/api/v1/contacts`
- `/api/v1/contacts/requests`

### Recommended Next 10 Features

1. Reply/quote messages.
2. Robust unread counters and better chat list read state.
3. Edit message UI plus realtime edit event.
4. Delete for everyone plus realtime delete event.
5. Conversation/message search backed by API.
6. Persist AI conversations.
7. Full privacy/block/report settings screen.
8. Group descriptions and invite links.
9. Browser/PWA push notifications.
10. Refactor `AppShell.tsx` into smaller feature modules and hooks.
