# Deployment

## Frontend To Netlify

1. Create a Netlify site from this repository.
2. Set the base directory to `frontend`.
3. Use build command `npm run build`.
4. Use publish directory `.next`.
5. Add environment variables:
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_WS_URL`

## Backend To Railway

1. Create a Railway service from this repository.
2. Set the root directory to `backend`.
3. Railway will use `railway.json`.
4. Add environment variables from `backend/.env.example`.
5. Point `FRONTEND_ORIGIN` to the Netlify production URL.

## Backend To Render

1. Create a Render Web Service from this repository.
2. Set the root directory to `backend`.
3. Use a Go build and start command (Render auto-detects Go with `go.mod`).
4. Add environment variables from `backend/.env.example`.
5. Point `FRONTEND_ORIGIN` to the Vercel production URL.
6. Add the Gemini variables documented in `docs/GEMINI_AI.md`.

## Frontend To Vercel

1. Create a Vercel project from the `frontend` directory.
2. Use build command `npm run build` (Vercel uses the `next.config.mjs` output).
3. Add environment variables:
   - `NEXT_PUBLIC_API_URL` → your Render backend URL (e.g. `https://your-backend.onrender.com`)
4. Redeploy whenever the backend URL changes.

## Production Services

- MySQL can be hosted on Railway, PlanetScale, or another managed provider.
- MongoDB should use MongoDB Atlas.
- Supabase Storage should define buckets named `avatars`, `chat-media`, `voice-notes`, and `documents`.
- The Gemini AI assistant is documented in `docs/GEMINI_AI.md`.
