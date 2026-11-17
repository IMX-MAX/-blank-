import { useEffect, useState } from 'react';
import { coverObjectUrl } from '../api';
import { artGradient } from '../lib/format';

export function Cover({
  fileId,
  src,
  hue,
  radius,
  className,
}: {
  fileId?: string | null;
  /** A remote image, used for YouTube artwork that is not a file in the library. */
  src?: string | null;
  hue?: number | null;
  radius?: number | string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(src || null);

  useEffect(() => {
    if (src) {
      setUrl(src);
      return;
    }
    if (!fileId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    coverObjectUrl(fileId)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, src]);

  return (
    <div
      className={className ? `art ${className}` : 'art'}
      style={{ background: artGradient(hue), borderRadius: radius }}
    >
      {url ? <img src={url} alt="" draggable={false} style={{ borderRadius: radius }} /> : null}
    </div>
  );
}
