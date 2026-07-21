# ChatSphere SRS Implementation Map

## Covered In This Scaffold

- Authentication endpoints: register, login, refresh, logout, forgot password.
- Profile endpoints: avatar, bio, privacy, status.
- Contact endpoints: search/list, requests, block/unblock.
- Private and group chat route groups.
- Message lifecycle endpoints: create, edit, delete, reactions.
- Upload endpoint placeholder for Supabase signed uploads.
- WebSocket hub for realtime events: connect, join, send message, typing, delivered, seen, online, offline, new message.
- Frontend modules: chat list, conversation, contacts, groups/modules, profile-style presence, notifications, readiness panel.

## Persistence Plan

- MySQL: users, sessions, contacts, friend_requests, groups, group_members, notifications.
- MongoDB: conversations, messages, message_reactions.
- Supabase Storage: avatars, chat-media, voice-notes, documents.

## Next Engineering Milestones

1. Add request validation and centralized error responses.
2. Add JWT authentication middleware and bcrypt password hashing.
3. Connect MySQL repositories for users, sessions, contacts, groups, and notifications.
4. Connect MongoDB repositories for conversations, messages, and reactions.
5. Replace WebSocket broadcast-all behavior with authenticated rooms.
6. Add Supabase signed upload URLs and media metadata persistence.
7. Add rate limiting, audit logging, and moderation report workflows.
