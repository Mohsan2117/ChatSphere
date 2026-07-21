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

## Production Services

- MySQL can be hosted on Railway, PlanetScale, or another managed provider.
- MongoDB should use MongoDB Atlas.
- Supabase Storage should define buckets named `avatars`, `chat-media`, `voice-notes`, and `documents`.
