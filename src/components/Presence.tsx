import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Keeps `children` mounted for `ms` after `show` turns false so CSS can play an exit animation
 * (`.presence[data-state="closed"] ...`).
 */
export function Presence({ show, children, ms = 180 }: { show: boolean; children: ReactNode; ms?: number }) {
  const last = useRef<ReactNode>(children);
  const [mounted, setMounted] = useState(show);
  if (show) last.current = children;

  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(id);
  }, [show, ms]);

  if (!show && !mounted) return null;
  return (
    <div className="presence" data-state={show ? 'open' : 'closed'}>
      {show ? children : last.current}
    </div>
  );
}
