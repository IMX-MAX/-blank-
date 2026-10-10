import { useLayoutEffect, useRef, useState } from 'react';

const GAP = 40;
const SPEED = 38;

/** One line of text that scrolls left in a loop when it is wider than its box. */
export function Marquee({ text, className }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const measure = () => setShift(inner.offsetWidth > box.clientWidth + 1 ? inner.offsetWidth + GAP : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div ref={boxRef} className={className ? `marquee ${className}` : 'marquee'} title={text}>
      <span
        className={shift ? 'marquee-track running' : 'marquee-track'}
        style={shift ? ({ '--shift': `${shift}px`, '--dur': `${shift / SPEED}s` } as React.CSSProperties) : undefined}
      >
        <span ref={textRef}>{text}</span>
        {shift ? (
          <span aria-hidden style={{ paddingLeft: GAP }}>
            {text}
          </span>
        ) : null}
      </span>
    </div>
  );
}
