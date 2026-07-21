# ChatSphere

Real-time messaging platform scaffold based on the provided SRS.

## Structure

- `frontend` - Next.js, React, TypeScript, Tailwind CSS app deployable to Netlify.
- `backend` - Go, Gin, WebSocket API service deployable to Railway.
- `docs` - SRS implementation notes and deployment checklist.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

```bash
cd backend
go mod tidy
go run ./cmd/server
```

## Deployment Targets

- Frontend: Netlify, using `frontend/netlify.toml`.
- Backend: Railway, using `backend/railway.json`.
- Databases: MySQL for accounts/relations and MongoDB Atlas for conversations/messages.
- Storage: Supabase Storage for avatars and chat media.

Copy `.env.example` files before running locally.
