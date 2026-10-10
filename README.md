# [blank]

A desktop music library for the records you already own. Upload a collection, keep it in the cloud, and play it back. The layout follows the quiet dark player in the reference shots: a library of covers, an album page, and a pill-shaped waveform bar along the bottom.

Synced lyrics come from [LRCLIB](https://lrclib.net). Word-synced records highlight word by word; line-synced records are highlighted with estimated word timing; unsynced lyrics are shown as plain text.

## How it is put together

```
browser (Vite + React)
  ├─ Neon Auth (Managed Better Auth)  ← sign up / sign in, issues a short-lived JWT
  └─ Bearer JWT ─▶ Neon Function "api" (Hono, api/src)
                     ├─ Postgres  (folders, albums, tracks, playlist_tracks)
                     └─ Object Storage bucket "uploads" (audio + cover art, private)
```

Every row and file is scoped to the signed-in user's id. The bucket stays private. Audio is uploaded and played through short-lived presigned URLs, because the Function rejects request bodies above roughly 10 MB. Cover art (max 8 MB) goes through the Function.

## Set up the Neon database

Needs Node 22.20+ and a Neon account.

```bash
npm i -g neon@latest && neon login          # opens a browser to sign in
neon skills -y                              # optional: agent skills for this repo
neon link --project-id noisy-heart-23370832 --branch production -y
neon deploy                                 # applies neon.ts: Auth, the "uploads" bucket, the "api" Function
neon env pull                               # writes DATABASE_URL, NEON_AUTH_*, AWS_* to .env
```

`neon.ts` declares everything Neon should provision:

- `auth: true` turns on Neon Auth (users and sessions live in the `neon_auth` schema).
- `buckets.uploads` is the private Object Storage bucket for audio and artwork.
- `functions.api` deploys `api/src/index.ts`, the only thing that talks to Postgres and the bucket.

The tables are created by the Function on its first request (`api/src/schema.ts`, idempotent `create table if not exists`). To create them up front instead, run the SQL against your branch:

```bash
npm run db:schema | psql "$DATABASE_URL_UNPOOLED"
```

Then point the frontend at your branch. Put these in `.env.local`:

```bash
VITE_NEON_AUTH_URL=<NEON_AUTH_BASE_URL from .env>
VITE_API_URL=<invocation_url from `neon functions get api`>
```

Add every origin you serve the app from as a trusted Auth domain (localhost ports are allowed by default):

```bash
neon neon-auth domain add https://your-app.example.com
```

## Run

```bash
npm install
npm run dev          # the app on http://localhost:5173
```

With `VITE_NEON_AUTH_URL` unset, `npm run dev` uses a local stand-in so you can try the UI with no Neon project: run `npm run dev:api` in a second terminal (an embedded Postgres and a folder on disk, data in `.dev/`) and sign in with any email. This stand-in only exists in dev builds.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run dev:api` | Local API on :8787 with embedded Postgres, no Neon needed |
| `npm test` | API tests (embedded Postgres) and lyrics parser tests |
| `npm run db:schema` | Prints the schema SQL |
| `npm run build` | Typechecks and builds the app |
