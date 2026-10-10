# [blank]
[blank] is a minimalist music player for people to play their own curated music library on their devices
![Screenshot_20261010-141345.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/4cf502e6-4f63-4cb1-9597-add7e637e7de)

![Screenshot_20261010-141348.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/678d2f63-efa8-43ee-8dd3-f92d14cbeecc)

![Screenshot_20261010-141353.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/1c694a37-efc0-449b-ac64-9ea40b98a10c)

![Screenshot_20261010-141408.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/3a0a5148-a4b7-4077-80e3-4f57644ff225)

![Screenshot_20261010-141411.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/e8f898ad-ba1f-4ba0-8854-7f1224de9a5a)

![Screenshot_20261010-141414.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/ea135712-abb2-49b2-bfd4-0f04e552f36a)

![Screenshot_20261010-141421.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/0aa4e970-1ce0-414a-865d-d57dde64e3cb)

![Screenshot_20261010-141427.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/7c093f8e-23df-4617-a7b8-a798a5809cdb)


# [blank]

A desktop music library for the records you already own. Upload a collection, keep it in the cloud, and play it back. The layout follows the quiet dark player in the reference shots: a library of covers, an album page, and a pill-shaped waveform bar along the bottom.

Lyrics are looked up in the [AMLL TTML database](https://github.com/amll-dev/amll-ttml-db) first, which carries real per-word timing, then in [LRCLIB](https://lrclib.net). Word timing is only ever shown when a source provides it: those songs highlight word by word, songs with line timing highlight the whole line, and unsynced lyrics are shown as plain text.

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

`.env.production` holds the same two public URLs so Vercel (or any host) builds work without extra settings. Add every origin you serve the app from as a trusted Auth domain, including each Vercel domain you sign in on (localhost ports are allowed by default):

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

## Android app

The Android app is the same web app wrapped with [Capacitor](https://capacitorjs.com) (`android/`). It talks to the same Neon Auth and API as the web version, using the public URLs in `.env.production`.

Build a debug APK (needs JDK 21 and the Android SDK with platform 36; set `ANDROID_HOME` or `android/local.properties`):

```bash
npm run android:apk
# android/app/build/outputs/apk/debug/app-debug.apk
```

The Android app's origin is `https://localhost`, which must be a trusted Neon Auth domain: `neon neon-auth domain add https://localhost`.

## Offline

Right-click (long-press on Android) a song or album and choose **Make available offline**. The audio, cover art and lyrics are stored on the device in IndexedDB, and a snapshot of the library is kept so the app opens and plays downloaded songs with no connection. Songs that are not downloaded are greyed out while offline. **Settings** shows how much space downloads use and can remove them all.
