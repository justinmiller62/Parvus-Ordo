# Parvus Studio — iOS API

The REST contract the **Parvus Studio** iOS app uses to log in, list the signed-in
creator's projects, download a project package (script + slides), and upload a
recording. All endpoints are served by Parvus Ordo (web).

- **Base URL (dev):** `https://dev.parvusordo.com`
- **Content type:** JSON, except the recording upload (multipart).
- **Dates:** ISO 8601 UTC.
- **All `/api/v1/parvus-studio/*` endpoints require auth** (see below). `auth/login` does not.

---

## Authentication

1. `POST /api/v1/auth/login` with email + password → returns a **`jwt`**.
2. Store the `jwt` in the **Keychain**.
3. Send it on every other call as **`Authorization: Bearer <jwt>`**.
4. The token is valid **30 days** (`expires_at`). On a `401` from any endpoint,
   clear it and route back to sign-in.

> The password is the creator's Parvus Ordo password (set when they accept their
> invitation email). Accounts that only use Google/SSO sign-in have no password and
> cannot use this endpoint.

### `POST /api/v1/auth/login`

Request:
```json
{ "email": "creator@example.com", "password": "their-password" }
```
Response `200`:
```json
{
  "jwt": "eyJhbGciOiJIUzI1NiJ9...",
  "user_id": "11111111-1111-1111-1111-111111111111",
  "display_name": "Sarah",
  "expires_at": "2026-07-01T18:00:00.000Z"
}
```
Errors: `400` (missing email/password), `401` (`{ "error": "invalid credentials" }`
— wrong password, or the user has no parish membership).

---

## `GET /api/v1/parvus-studio/projects/mine`

The signed-in creator's projects. Header: `Authorization: Bearer <jwt>`.

Response `200`:
```json
{
  "projects": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "title": "What Catholics actually believe about the Real Presence",
      "status": "ready_to_record",
      "topic_category": "Sacraments"
    }
  ]
}
```
`status` ∈ `"drafting" | "ready_to_record" | "submitted"`. `topic_category` may be `null`.
Errors: `401`.

---

## `GET /api/v1/parvus-studio/projects/{id}/package`

Everything needed to record: the script + presigned slide image URLs + where to
upload. Header: `Authorization: Bearer <jwt>`.

Response `200`:
```json
{
  "project_id": "33333333-3333-3333-3333-333333333333",
  "title": "What Catholics actually believe about the Real Presence",
  "script": {
    "full_text": "Hi, I'm Sarah, and today...",
    "segments": [
      { "id": "s1", "text": "Hi, I'm Sarah...", "slide_id": "v1" },
      { "id": "s2", "text": "Most Catholics think...", "slide_id": "v2" }
    ]
  },
  "visuals": [
    { "id": "0e2e...-d3", "order": 1, "url": "https://<acct>.r2.cloudflarestorage.com/...&X-Amz-Signature=..." },
    { "id": "0e2e...-d4", "order": 2, "url": "https://...presigned..." }
  ],
  "upload_endpoint": "/api/v1/parvus-studio/projects/33333333-.../recording"
}
```

Notes:
- `visuals` are the project's uploaded slides, **ordered by `order`** (1-based).
  Each `url` is a **short-lived presigned GET** (~1 hour). If you cache slides and a
  URL later 403s, **re-fetch the package** to get fresh URLs. Slides are authored at
  **1920×1080 (16:9)**.
- `visuals` may be empty if no slides have been uploaded yet.
- `script.segments[].slide_id` is an optional hint linking a script segment to a
  visual; alignment is set by whoever authored the script (don't assume it's present).
- `upload_endpoint` is the path to POST the recording to (same as below).
- Errors: `401`, `404` (`{ "error": "not found" }` — not this creator's parish / no such project).

---

## `POST /api/v1/parvus-studio/projects/{id}/recording`  — video upload

Upload the recorded MP4. Header: `Authorization: Bearer <jwt>`, body
`multipart/form-data`:

| field | type | required | notes |
|---|---|---|---|
| `file` | file (MP4) | yes | the recorded video |
| `duration_seconds` | number | no | take length |
| `slide_advance_count` | number | no | how many times slides advanced |

The server uploads the MP4 to Bunny Stream and records it. Response `200`:
```json
{
  "recording_id": "aaaa....",
  "playback_url": "https://iframe.mediadelivery.net/embed/<lib>/<videoId>",
  "project_status": "submitted"
}
```
`playback_url` is a Bunny iframe embed URL; the project flips to `submitted`.
Errors: `400` (`{ "error": "file is required" }`), `401`.

---

## Typical flow

```
POST /api/v1/auth/login                                  → store jwt
GET  /api/v1/parvus-studio/projects/mine                 → pick a project
GET  /api/v1/parvus-studio/projects/{id}/package         → script + slide URLs → record
POST /api/v1/parvus-studio/projects/{id}/recording       → upload MP4 → status: submitted
```

## Notes / status

- **AuthN model:** the app token is an HS256 JWT issued by the server after verifying
  the password against WorkOS; the app never sees WorkOS tokens. No refresh flow —
  just re-login when the 30-day token expires or a `401` is returned.
- **Slides on dev** require R2 to be configured for the deployment; if a project's
  `visuals` is unexpectedly empty, no slides have been uploaded for it yet (upload them
  in the web project page or via the MCP `upload_slide` tool).
