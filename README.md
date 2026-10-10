# [blank]

A desktop music library for the records you already own. Upload a collection, keep it in the cloud, and play it back. The layout follows the quiet dark player in the reference shots: a library of covers, an album page, and a waveform bar along the bottom.

Audio and artwork sync to the Appwrite project **nafen internet**.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. Create an account, then use **Add → Audio** or drop files onto the window.

## Cloud resources

Project `69928cbb002d9fe2510a` in Toronto (`https://tor.cloud.appwrite.io/v1`).

| Resource | ID |
| --- | --- |
| Database | `blank` |
| Albums and playlists | `albums` |
| Tracks | `tracks` |
| Playlist membership | `playlist_tracks` |
| Folders | `folders` |
| Audio bucket | `blank-audio` |
| Cover bucket | `blank-covers` |

Each row and file is private to the account that created it.
