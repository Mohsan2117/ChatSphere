# Gemini AI Assistant

ChatSphere includes a Gemini-powered AI assistant that is protected by aggressive quota safeguards. This document explains the configuration, the quota- protection checks, and how to test the system.

## Endpoint

- **URL:** `POST /api/v1/ai/chat`
- **Auth:** Requires a valid ChatSphere Bearer token (reuses the existing auth system).
- **Request body:**
  ```json
  { "message": "Hello" }
  ```
- **Success response (200):**
  ```json
  { "response": "Hello! How can I help?" }
  ```
- **Error responses:**
  - `401` – `{ "error": "login required" }`
  - `400` – `{ "error": "message is required" }` or `{ "error": "message is too long" }`
  - `429` – `{ "error": "Daily AI limit reached. Please try again tomorrow." }` (daily) or a short cooldown/IP message (other 429s)
  - `500`/`503` – safe generic message; the raw Gemini error body is never exposed to users

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(none)* | The Gemini API key. **Backend only. Never set a `NEXT_PUBLIC_` version.** |
| `GEMINI_MODEL` | `gemini-2.0-flash` | The Gemini model. See model rationale below. |
| `GEMINI_DAILY_LIMIT` | `20` | Max AI requests per user per day (UTC). |
| `GEMINI_IP_RATE_LIMIT` | `5` | Max AI requests per IP per minute (sliding window). |
| `GEMINI_REQUEST_COOLDOWN_SECONDS` | `2` | Minimum seconds between AI requests from the same user. |
| `GEMINI_MAX_MESSAGE_LENGTH` | `2000` | Max characters (runes) in the user message. |
| `GEMINI_MAX_OUTPUT_TOKENS` | `500` | Max output tokens Gemini is allowed to generate. |
| `GEMINI_TIMEOUT_SECONDS` | `30` | Request timeout for the Gemini API call. |
| `TRUSTED_PROXIES` | *(none)* | Comma-separated proxy IPs that may set `X-Forwarded-For`. Leave empty to trust no proxy headers. |

Only the variables above are actually read by the implementation. `GEMINI_WEBHOOK_SECRET`, `GEMINI_HISTORY_LIMIT`, etc. are **not** used.

## Model Rationale

`gemini-2.0-flash` was selected because:

- It is a **currently supported, GA** Gemini model.
- It offers the best **cost/quota-to-quality** balance of the stable Gemini line.
- It is **fast**, which keeps the 30-second timeout comfortable.
- It is **explicitly supported** by the `generateContent` REST API with `maxOutputTokens`.

If you prefer a different model, set `GEMINI_MODEL` on the backend.

## Order Of Checks (Quota Protection)

The backend enforces this exact order **before** any request can reach Gemini:

1. **Authentication** – reuse `requireUser()`. Unauthenticated → `401`.
2. **Validate message** – empty / too long → `400`. Rejected before quota is consumed.
3. **Per-user cooldown** – rapid repeated requests from the same user → `429`.
4. **IP rate limit** – more than `GEMINI_IP_RATE_LIMIT` requests per IP per minute → `429`.
5. **Daily user limit** – atomic reserve. If the user would exceed `GEMINI_DAILY_LIMIT`, return `429` **without** calling Gemini and **without** consuming quota.
6. **Call Gemini** – only now is the API called.
7. **Refund on failure** – if Gemini fails, the reserved count is decremented so the user is only charged for requests that actually reached Gemini.
8. **Return response.**

The daily usage count is only incremented when the atomic reserve succeeds **and** Gemini is actually called. Rejected requests never consume quota.

## How Usage Is Stored

Usage is persisted using the **existing ChatSphere storage** — no separate database is created.

- **PostgreSQL / MySQL:** an `ai_usage(user_id, usage_date, request_count)` table is created automatically by the existing `migrate()` function (with a primary key on `(user_id, usage_date)`).
- **JSON file store:** an `aiUsage` map is stored in the same `data/chatsphere.json` file, keyed by `user_id → date → count`.
- Counting is **atomic** in every backend, so concurrent requests cannot bypass the daily limit.

The authenticated user ID (from the token) is the only ID used for quota tracking. Any `userId` sent by the client is **ignored** — see the spoofing test.

## Gemini API Key Protection

- The key is read **only** on the Go backend from `GEMINI_API_KEY` (or `.env`).
- It is **never** added to any frontend build, bundle, or `NEXT_PUBLIC_*` variable.
- It is **never** logged. The startup log only prints `GEMINI_API_KEY present=true/false`, never the value.
- It is **never** returned in any API response.
- It is **never** committed to Git: the root `.gitignore` already excludes `.env*`.

## Safe Logging

The backend logs only:

- `[gemini] success user=... status=200 latency_ms=...`
- `[gemini] rate_limit kind=cooldown|ip|daily user=... status=429 latency_ms=...`
- `[gemini] error user=... latency_ms=...` (generic error string, never request content)

Full user messages and the API key are never logged.

## Deployment

### Backend (Render)

1. Add the variables from the table above to your Render Web Service, including `GEMINI_API_KEY`.
2. Set `FRONTEND_ORIGIN` to your Vercel URL.
3. If your Render service is behind Render's proxy and you need real client IPs, set `TRUSTED_PROXIES` to the Render proxy IPs. **Leave it empty** to trust no proxy headers (the safe default).
4. Deploy. The endpoint will 503 if `GEMINI_API_KEY` is missing.

### Frontend (Vercel)

1. Set `NEXT_PUBLIC_API_URL` to your Render backend URL (e.g. `https://your-backend.onrender.com`).
2. **Do not** add `NEXT_PUBLIC_GEMINI_API_KEY` or any Gemini key on Vercel.

## Testing The Full System

1. **Start the backend** with `GEMINI_API_KEY` set, then `go run ./cmd/server`.
2. **Start the frontend** with `npm run dev` from `frontend/`.
3. **Login** as an existing ChatSphere user.
4. Click the **AI Assistant** icon in the left nav.
5. Send a message. Verify you receive a Gemini response.
6. Send another message within 2 seconds → expect a cooldown `429` with the friendly "AI usage limit reached" message.
7. Trigger the **daily limit** by sending `GEMINI_DAILY_LIMIT` requests (or lower the variable for testing) → expect the daily-limit `429` and the "You've reached your daily AI limit" message.
8. Send an **oversized message** (longer than `GEMINI_MAX_MESSAGE_LENGTH`) → expect `400`.
9. **Log out** and call the endpoint without a token → expect `401`.
10. Verify the Gemini key is never present in the browser devtools network tab (the request goes to your backend, not to Google).

## Unit Tests

The backend includes tests that prove rejected requests never reach Gemini:

- `TestAIChatRequiresAuthentication`
- `TestAIChatRejectsInvalidMessages`
- `TestAIChatCooldownBlocksRapidRequests`
- `TestAIChatIPRateLimit`
- `TestAIChatDailyLimit`
- `TestAIChatRefundsOnGeminiFailure`
- `TestAIChatSuccess`
- `TestAIChatIgnoresUserProvidedID`

Run them with:

```bash
cd backend && go test ./...