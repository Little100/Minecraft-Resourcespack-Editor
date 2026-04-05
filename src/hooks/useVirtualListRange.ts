import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';

export function useVirtualListRange({
  count,
  rowHeight,
  overscan = 8,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(24, Math.max(0, count)) });

  const recalc = useCallback(() => {
    const el = scrollRef.current;
    if (!el || count <= 0) {
      setRange((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }));
      return;
    }
    const st = el.scrollTop;
    const h = el.clientHeight;
    const start = Math.max(0, Math.floor(st / rowHeight) - overscan);
    let end = Math.min(count, Math.ceil((st + h) / rowHeight) + overscan);
    if (end <= start && count > 0) {
      end = Math.min(count, start + Math.max(overscan * 2, 20));
    }
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [count, rowHeight, overscan]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recalc();
    el.addEventListener('scroll', recalc, { passive: true });
    const ro = new ResizeObserver(() => recalc());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', recalc);
      ro.disconnect();
    };
  }, [recalc]);

  useEffect(() => {
    recalc();
  }, [count, recalc]);

  useLayoutEffect(() => {
    if (count <= 0) return;
    const id = requestAnimationFrame(() => recalc());
    return () => cancelAnimationFrame(id);
  }, [count, recalc]);

  const totalHeight = Math.max(0, count) * rowHeight;

  return { scrollRef, start: range.start, end: range.end, totalHeight };
}
