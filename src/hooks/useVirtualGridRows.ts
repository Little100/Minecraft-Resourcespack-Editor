import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';

export function useVirtualGridRows({
  itemCount,
  scrollRef,
  rowHeight,
  minTileWidth,
  gapPx,
  horizontalPadding = 0,
  overscan = 2,
}: {
  itemCount: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  rowHeight: number;
  minTileWidth: number;
  gapPx: number;
  horizontalPadding?: number;
  overscan?: number;
}) {
  const [itemsPerRow, setItemsPerRow] = useState(3);
  const [range, setRange] = useState({ start: 0, end: 4 });

  const rowCount = itemCount > 0 ? Math.ceil(itemCount / itemsPerRow) : 0;

  const recalcCols = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const w = Math.max(0, el.clientWidth - horizontalPadding);
    const cell = minTileWidth + gapPx;
    const cols = Math.max(1, Math.floor((w + gapPx) / cell));
    setItemsPerRow((c) => (c === cols ? c : cols));
  }, [scrollRef, minTileWidth, gapPx, horizontalPadding]);

  const recalcRows = useCallback(() => {
    const el = scrollRef.current;
    if (!el || rowCount <= 0) {
      setRange((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }));
      return;
    }
    const st = el.scrollTop;
    const h = el.clientHeight;
    const start = Math.max(0, Math.floor(st / rowHeight) - overscan);
    let end = Math.min(rowCount, Math.ceil((st + h) / rowHeight) + overscan);
    if (end <= start && rowCount > 0) {
      end = Math.min(rowCount, start + Math.max(overscan * 2, 4));
    }
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [rowCount, rowHeight, overscan, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recalcCols();
    recalcRows();
    const ro = new ResizeObserver(() => {
      recalcCols();
      requestAnimationFrame(() => recalcRows());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [recalcCols, recalcRows, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recalcRows();
    el.addEventListener('scroll', recalcRows, { passive: true });
    return () => el.removeEventListener('scroll', recalcRows);
  }, [recalcRows, scrollRef]);

  useEffect(() => {
    recalcRows();
  }, [itemCount, itemsPerRow, recalcRows]);

  useLayoutEffect(() => {
    if (itemCount <= 0) return;
    const id = requestAnimationFrame(() => recalcRows());
    return () => cancelAnimationFrame(id);
  }, [itemCount, itemsPerRow, recalcRows]);

  const totalHeight = rowCount * rowHeight;

  return { itemsPerRow, rowStart: range.start, rowEnd: range.end, rowCount, totalHeight };
}
