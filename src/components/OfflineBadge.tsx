import { CircleArrowDown } from 'lucide-react';
import { LOCAL_ONLY } from '../config';
import { useOffline } from '../state/OfflineProvider';

/** Shows whether a song is downloaded, or how far along its download is. */
export function OfflineBadge({ trackId }: { trackId: string }) {
  const offline = useOffline();
  if (LOCAL_ONLY) return null;
  const fraction = offline.progress[trackId];
  if (fraction !== undefined) {
    const circumference = 2 * Math.PI * 7;
    return (
      <span className="offline-badge busy" role="progressbar" aria-label="Downloading" aria-valuenow={Math.round(fraction * 100)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="7" className="ring-bg" />
          <circle
            cx="9"
            cy="9"
            r="7"
            className={fraction > 0 ? 'ring-fg' : 'ring-fg spin'}
            strokeDasharray={circumference}
            strokeDashoffset={fraction > 0 ? circumference * (1 - fraction) : circumference * 0.75}
          />
        </svg>
      </span>
    );
  }
  if (!offline.isSaved(trackId)) return null;
  return (
    <span className="offline-badge" title="Available offline" aria-label="Available offline">
      <CircleArrowDown size={16} />
    </span>
  );
}
