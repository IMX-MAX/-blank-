# blank-win

A native Windows on ARM (ARM64) shell for the [blank] music player, built with
[wry](https://crates.io/crates/wry) + [tao](https://crates.io/crates/tao) — a plain
WebView2 window with no bundled browser engine (unlike Electron), so the whole
native app is a single ~440 KB executable.

The web app is the exact build from the `IMX-MAX/-blank-` repo (`npm run build`),
copied into `web/`. The repo itself is not modified; `dist/` output there is gitignored.

## How it works

- The web bundle is served from a custom `blank://` protocol that WebView2 maps
  to the secure origin `https://blank.localhost` (same trick Capacitor uses on
  Android with `https://localhost`), so IndexedDB, service worker storage, and
  the Neon Auth web flow all work.
- At runtime it loads `web/` next to `blank.exe` (or from `$BLANK_WEB_DIR`).
- Talking to the same Neon Auth + API as web/Android requires
  `https://blank.localhost` to be a trusted Neon Auth domain:
  `neon neon-auth domain add https://blank.localhost`.

## Run

Unzip `dist/blank-windows-arm64-portable.zip` on a Windows 10/11 ARM64 device
(any Snapdragon/Surface ARM PC — WebView2 Runtime is preinstalled on Windows 11)
and run `blank.exe`.

## Build (from any host, cross-compiled)

```bash
rustup target add aarch64-pc-windows-msvc
cargo install cargo-xwin
cargo xwin build --release --target aarch64-pc-windows-msvc
```

Refresh the web bundle from the mobile app repo with:

```bash
cd /path/to/-blank- && npm install && npm run build
rm -rf /path/to/blank-win/web && cp -r dist /path/to/blank-win/web
```
