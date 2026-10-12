/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the web app asks for lyrics from services without CORS. Defaults to this site's /lyrics-proxy. */
  readonly VITE_LYRICS_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
