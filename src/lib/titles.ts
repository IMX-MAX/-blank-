export function clean(value: string): string {
  return value
    .replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(remaster|version|edit|mix|live|deluxe)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|single version|radio edit).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const VIDEO_TAG = /\s*[([【][^)\]】]*\b(official|m\/?v|video|lyrics?|audio|visualizer|performance|teaser|hd|4k)\b[^)\]】]*[)\]】]/gi;
const VIDEO_TAIL = /\s*[-–|:]?\s*(official\s+)?(music\s+)?(m\/?v|video|lyric video|lyrics|audio|visualizer)\s*$/i;
// A quote opens at the start of a word and closes at the end of one, so the apostrophe in `It's` is not a quote.
const QUOTED = /(?:^|[\s(\[【:–-])['‘“"«](.{2,}?)(?<=\S)['’”"»](?![\p{L}\p{N}])/u;

function tidyArtist(value: string): string {
  return value
    .replace(/\s*[([][^)\]]*[)\]]/g, (part) => (/[^\x00-\x7f]/.test(part) ? '' : part))
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Titles and artists to try, best guess first. Handles video-style names like `ARTIST 'Song' Official MV`. */
export function lookupCandidates(rawTitle: string, rawArtist: string): Array<{ title: string; artist: string }> {
  const out: Array<{ title: string; artist: string }> = [];
  const add = (title: string, artist: string) => {
    const t = title.replace(/\s+/g, ' ').trim();
    const a = artist.replace(/\s+/g, ' ').trim();
    if (t && !out.some((item) => item.title.toLowerCase() === t.toLowerCase() && item.artist.toLowerCase() === a.toLowerCase())) {
      out.push({ title: t, artist: a });
    }
  };
  const title = clean(rawTitle).replace(VIDEO_TAG, '').replace(VIDEO_TAIL, '').trim();
  const artist = tidyArtist(clean(rawArtist));

  const quoted = QUOTED.exec(title);
  if (quoted) {
    const before = tidyArtist(title.slice(0, quoted.index));
    add(quoted[1]!, before || artist);
    add(quoted[1]!, '');
  }
  const dash = /^(.{1,80}?)\s+[-–]\s+(.+)$/.exec(title);
  if (dash) {
    add(dash[2]!, tidyArtist(dash[1]!));
    add(dash[2]!, artist);
  }
  add(title, artist);
  add(title, '');
  return out;
}
