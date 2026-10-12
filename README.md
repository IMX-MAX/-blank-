# [blank]
[blank] is a minimalist music player for people to play their own curated music library on their devices

![Screenshot_20261010-141408.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/3a0a5148-a4b7-4077-80e3-4f57644ff225)

![Screenshot_20261010-141411.png](https://res.craft.do/user/full/de51101e-a7a3-46b3-331b-7ba5959ea98a/doc/f86ec001-4d6c-49d6-bcfd-c73e0be00083/e8f898ad-ba1f-4ba0-8854-7f1224de9a5a)

# [blank]

A music library for the records you already own, with no account and no server. Add songs and they are copied into the browser's IndexedDB (or the app's storage on Android), so the library, covers, playlists and saved lyrics all live on your device. The same code runs as a web app and, wrapped with Capacitor, as an Android app.

Lyrics are looked up in this order, and the first source that times every word wins:

1. the [AMLL TTML database](https://github.com/amll-dev/amll-ttml-db) (`src/lib/amll.ts`),
2. a community service that serves Apple Music's word-timed TTML, with backing vocals, duets and a reading under Korean, Japanese and Chinese lines (`src/lib/apple.ts`). Without an API key it only answers for songs it already has and allows a few lookups in a short while, so a refusal pauses it for 90 seconds and a song is looked up again later,
3. NetEase Cloud Music, word timing for most popular songs (`src/lib/ncm.ts`),
4. [LRCLIB](https://lrclib.net), which only sometimes has word timing.

Songs that only end up with line timing are given estimated word timing (`src/lib/estimate.ts`), shown with an "Estimated" tag instead of "Word-synced". **Settings > Lyrics > Estimated lyrics** turns that off, and **Word-synced sources > Test** looks a known song up in each source and shows which could not be reached from the phone. Tapping the "Estimated" tag in the lyrics view runs the same check for that song and shows why it has no word timing. The Apple Music service is asked for song and artist only (an album tag it does not know makes it refuse), and a length mismatch is retried without the length. Unsynced lyrics are shown as plain text.

NetEase and the Apple Music service have no public API and send no CORS headers. The Android app queries them through the native HTTP client (`src/lib/http.ts`). The web app goes through a small stateless pass-through, `api/lyrics-proxy.ts`, which only fetches those two hosts and stores nothing: `npm run dev` and `npm run preview` serve it on `/lyrics-proxy`, and on Vercel it is the function behind the `/lyrics-proxy` rewrite in `vercel.json`. On a host with no proxy those two sources are skipped, or set `VITE_LYRICS_PROXY` at build time to the address of one you host. NetEase matching requires the same title, an overlapping artist and a length within 12 seconds of the file. Its word list sometimes runs words together, so spaces are restored from its plain lyric, and its bracketed ad-libs become backing vocals. Songs saved before this lookup existed are refreshed once if they have no word timing (`LYRICS_VERSION`).

A line that ends less than a second before the next one starts stays lit until the next begins instead of greying out. Syllables timed apart but written without a space between them (`thin` `king`) wrap as one word.

The web and Android apps share all of this code. What only exists on Android: the notification controls, the home-screen widget, the Glyph Matrix, vibration on beats and saving to a file the system can see.

## How it is put together

```
React app (Vite)
  ├─ src/lib/local-store.ts   folders, albums, tracks, playlists and the audio/cover files, in IndexedDB "blank-local"
  ├─ src/lib/lyrics-store.ts  saved lyrics, in IndexedDB "blank-lyrics"
  └─ src/auth.ts              the profile: a name kept in localStorage
```

Nothing is sent anywhere except the lyric lookups described above. The profile is only a name used as the default artist for new albums. Clearing the site's data (or the app's storage on Android) deletes the library, so back up files you care about. The app asks the browser to keep its storage persistent so it is not evicted under pressure.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm test` | Lyrics, cover, beat, parser and lyrics-proxy tests |
| `npm run build` | Typechecks and builds the web app into `dist/` (host it on any static server) |
| `npm run android:apk` | Builds the web app and a debug APK |

## Android app

The Android app is the web app wrapped with [Capacitor](https://capacitorjs.com) (`android/`), app id `app.blank.local`. Songs you add are copied into the app, so everything works without a connection except lyric lookups for songs that are not saved yet.

Build a debug APK (needs JDK 21 and the Android SDK with platform 36; set `ANDROID_HOME` or `android/local.properties`):

```bash
npm run android:apk
# android/app/build/outputs/apk/debug/app-debug.apk
```

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

### Home-screen widget

Long-press the home screen, open Widgets and add **[blank]**. It mirrors the bottom playback bar: cover, title and artist, a waveform that fills as the song plays, previous, play/pause and next, and shuffle (gold when on). The elapsed time and waveform refresh about every two seconds while a song plays and the screen is on. The buttons go through the playback service to the same controls as the in-app bar. If the app has been closed they open it instead. The code is in `NowPlayingWidget.java` and `WidgetBars.java`.

Nothing's licence does not allow redistributing the Glyph Matrix SDK, so it is not in the repo: `fetchGlyphSdk` in `android/app/build.gradle` downloads it from their developer kit the first time you build.
