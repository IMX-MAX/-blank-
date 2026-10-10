import { useEffect, useState } from 'react';
import { coverObjectUrl } from '../appwrite';
import { artGradient } from '../lib/format';

export function Cover({
  fileId,
  hue,
  radius,
  className,
}: {
  fileId?: string | null;
  hue?: number | null;
  radius?: number | string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
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
  }, [fileId]);

  return (
    <div
      className={className ? `art ${className}` : 'art'}
      style={{ background: artGradient(hue), borderRadius: radius }}
    >
      {url ? <img src={url} alt="" draggable={false} style={{ borderRadius: radius }} /> : null}
    </div>
  );
}
