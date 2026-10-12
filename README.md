# [blank]
[blank] is a minimalist music player for people to play their own curated music library on their devices

![Screenshot_20261010-141408.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/3a0a5148-a4b7-4077-80e3-4f57644ff225)

![Screenshot_20261010-141411.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/e8f898ad-ba1f-4ba0-8854-7f1224de9a5a)

# [blank]

A desktop music library for the records you already own. Upload a collection, keep it in the cloud, and play it back. The layout follows the quiet dark player in the reference shots: a library of covers, an album page, and a pill-shaped waveform bar along the bottom.

Lyrics are looked up in this order, and the first source that times every word wins:

1. the [AMLL TTML database](https://github.com/amll-dev/amll-ttml-db) (`src/lib/amll.ts`),
2. a community service that serves Apple Music's word-timed TTML, with backing vocals, duets and a reading under Korean, Japanese and Chinese lines (`src/lib/apple.ts`). Without an API key it only answers for songs it already has and allows a few lookups in a short while, so a refusal pauses it for 90 seconds and a song is looked up again later,
3. NetEase Cloud Music, word timing for most popular songs (`src/lib/ncm.ts`),
4. [LRCLIB](https://lrclib.net), which only sometimes has word timing.

Songs that only end up with line timing are given estimated word timing (`src/lib/estimate.ts`), shown with an "Estimated" tag instead of "Word-synced". **Settings > Lyrics > Estimated lyrics** turns that off, and **Word-synced sources > Test** looks a known song up in each source and shows which could not be reached from the phone. Unsynced lyrics are shown as plain text.

NetEase and the Apple Music service have no public API and send no CORS headers, so they are only queried in the Android app (through the native HTTP client, `src/lib/http.ts`) and are skipped in a plain browser. NetEase matching requires the same title, an overlapping artist and a length within 12 seconds of the file. Its word list sometimes runs words together, so spaces are restored from its plain lyric, and its bracketed ad-libs become backing vocals. Songs saved before this lookup existed are refreshed once if they have no word timing (`LYRICS_VERSION`).

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

## Local-only Android build (`cursor/android-local-788f`)

This branch builds a version of the Android app with no cloud: you create a profile (just a name), songs you add are copied into the app, and the whole library (songs, covers, albums, folders, playlists, lyrics cache) lives in the phone's storage. There is no sign-in, no server and no download option, since every song is already on the device. Lyrics are still looked up online when a song is first opened and then cached. The app id is `app.blank.local`, so it installs next to the cloud version.

Build it with `npm run android:apk`. The storage code is in `src/lib/local-store.ts`.

### Lyrics offline

**Settings > Lyrics** has a switch to keep the lyrics of every song you open (stored in IndexedDB `blank-lyrics`, see `src/lib/lyrics-store.ts`), and a **Save all** button that looks up lyrics for the whole library while you are online. Saved lyrics open with no connection and are looked up again if a song is retagged.

### Glyph Matrix

On a Nothing Phone (4a) Pro (13x13 matrix) or Phone (3) (25x25), **Settings > Playback** has a switch that draws what is playing on the back of the phone, with three looks:

- **Waveform**: a scrolling slice of the waveform slides past a fixed playhead in the middle column, bright for what has played (left) and dim for what is coming (right), with the playhead column blinking while playing.
- **Lyrics**: the line being sung is drawn in a 5x7 pixel font (`PixelFont.java`, from the public-domain X11 misc-fixed font, with the system font as a fallback for other scripts) and scrolls across as the line plays. It uses synced lyrics and falls back to the waveform when a song has none.
- **Pulse**: the whole disc flashes on every beat and a ring ripples out from the middle. It falls back to the waveform until the song's beats are known.

The drawing lives in the playback service (`LiveVisuals.java`, `WaveformFrame.java`, `LyricsFrame.java`, `PulseFrame.java`), so it keeps going with the screen off, and it uses `setAppMatrixFrame`, so a Glyph Toy you switch to takes over the display. Needs a system version from 20250801.

**Vibrate to the beat** (also in Settings > Playback) buzzes the vibration motor on the strong beats of the song: a sustained "zzz" that starts hard and eases off, as long as the gap to the next beat allows (`BuzzPattern.java`). It works on any phone with a vibration motor and does not need the Glyph Matrix.

Beats come from `src/lib/beat-detect.ts`, an onset detector that decodes the song once, finds the hits (drums, plucks) rather than a steady tempo, and caches them in IndexedDB (`blank-beats`).

### Lyrics look

The lyrics view follows the Apple Music / [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) style: large bold lines, the sung line sharp and the rest blurred by distance, a soft-edged highlight sweeping through each word with the current word lifting slightly, a staggered scroll, and breathing dots for long instrumental gaps (`src/components/LyricsView.tsx`).

- **Background vocals** (the `x-bg` spans in AMLL TTML) are drawn as smaller lines under the main one and fade in only while they are sung. A paragraph that holds only backing vocals is drawn as a small line on its own.
- **Duets**: lines of the second singer (`ttm:agent="v2"`) are right aligned.
- **Pronunciation** (**Settings > Playback > Show pronunciation**): readings the TTML supplies (`x-roman`, `amll:roman`) are used as is. Otherwise Korean is romanised (revised romanisation with the usual sound changes), Chinese gets pinyin (`pinyin-pro`, loaded on demand) and kana-only Japanese gets Hepburn romaji. Japanese lines with kanji get no generated reading. Plain LRCLIB lyrics carry no backing or duet information.

Lyrics saved before this feature are refreshed once (`LYRICS_VERSION` in `src/lib/lyric-types.ts`), keeping the old copy if the lookup fails.

### Queue and button feel

The queue (`src/components/QueuePanel.tsx`) shows the current song, the songs up next with cover, length and a remove button, and the songs already played. Every button, link and `[role=button]` springs in when pressed and overshoots when released (`src/lib/bounce.ts`, Web Animations on the `scale` property, skipped with reduced motion). A press that turns into a scroll or drag eases back without the bounce. Add `data-no-bounce` to opt an element out.

### Keep the screen on for lyrics

**Settings > Playback > Keep the screen on for lyrics** holds the screen awake while the lyrics view is open (the window's keep-screen-on flag in the app, the Screen Wake Lock API in a browser).

### Equalizer and crossfade

**Settings > Sound** has a three-point equalizer (bass, mid, treble, -12 to +12 dB) you drag on a graph, and a crossfade switch with a 1 to 12 second slider. Both run on the Web Audio API (`src/lib/audio-engine.ts`): each song plays through its own gain into a low shelf, a peaking filter and a high shelf. Crossfading uses two audio elements that swap roles, with an equal-power fade, so the next song starts under the end of the current one. The audio graph is only built once the equalizer is not flat or crossfade is on.

Nothing's licence does not allow redistributing the Glyph Matrix SDK, so it is not in the repo: `fetchGlyphSdk` in `android/app/build.gradle` downloads it from their developer kit the first time you build.
