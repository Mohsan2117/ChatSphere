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
- Database: Supabase PostgreSQL for users and messages.
- Email: Brevo for OTP and password reset codes.

Copy `.env.example` files before running locally.

## Required Production Environment

Before the final Netlify/Railway publish, set these Railway backend variables:

- `DATABASE_URL` for Supabase PostgreSQL.
- `AUTH_SECRET` as a long random secret.
- `AUTH_TOKEN_TTL_HOURS`, usually `168`.
- `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME`.
- `FRONTEND_ORIGIN` set to the Netlify site URL.

Set these Netlify frontend variables:

- `NEXT_PUBLIC_API_URL` set to the Railway backend URL.
- `NEXT_PUBLIC_WS_URL` set to the Railway WebSocket URL.
- `NEXT_PUBLIC_ADMIN_EMAIL` matching the backend admin email.
