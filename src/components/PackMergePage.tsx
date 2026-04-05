import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Icon, useToast, Dialog, Button } from '@mpe/ui';
import {
  selectOutputFolder,
  previewPackMerge,
  executePackMerge,
  readMergeSourceFileBase64,
  openFolder,
  parentDirPath,
} from '../utils/tauri-api';
import { getAllPackFormatsWithReleases } from '../utils/version-map';
import { mergePathMatchesQuery } from '../utils/merge-helpers';
import type {
  MergeSource,
  MergePreview,
  MergeProgress,
  MergeResult,
  ConflictResolution,
  MergeConfig,
  FileConflict,
} from '../types/pack';
import { useVirtualListRange } from '../hooks/useVirtualListRange';
import { useVirtualGridRows } from '../hooks/useVirtualGridRows';
import { getMergeThumbCached, setMergeThumbCached, mergeThumbCacheKey } from '../utils/merge-thumb-cache';
import './PackMergePage.css';
import './MergeSourceList.css';

interface PackMergePageProps {
  onClose: () => void;
  initialSources: MergeSource[];
  onRepick: (sources: MergeSource[]) => void;
  onMergeAgain: () => void;
}

type JobPhase = 'idle' | 'merging' | 'review' | 'done';

const SOURCE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

interface PackFormatOption {
  format: number;
  label: string;
  searchText: string;
}
const PACK_FORMAT_OPTIONS: PackFormatOption[] = [
  { format: 4, label: '1.6–1.12 (Legacy)', searchText: '1.6 1.12 legacy' },
  { format: 34, label: '1.20.2–1.21.x', searchText: '1.20 1.21' },
];

function sanitizeZipStem(raw: string): string {
  let s = raw.replace(/\.zip$/i, '').trim();
  return s.replace(/[/\\:*?"<>|]/g, '') || '';
}

function zipOutputFileName(stem: string): string {
  return `${sanitizeZipStem(stem) || 'merged_pack'}.zip`;
}

function SearchablePackFormatDropdown({
  value,
  options,
  onChange,
}: {
  value: number;
  options: PackFormatOption[];
  onChange: (format: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        String(o.format).includes(q) ||
        o.searchText.toLowerCase().includes(q)
    );
  }, [options, search]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const current = options.find((o) => o.format === value) ?? options[0];

  return (
    <div className={`mpm-format-dd${open ? ' mpm-format-dd--open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="mpm-format-dd__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mpm-format-dd__text">
          {current ? `${current.label} (${current.format})` : '选择版本'}
        </span>
        <Icon name="chevron-down" size={14} className="mpm-format-dd__chev" />
      </button>
      {open && (
        <div className="mpm-format-dd__menu" role="listbox">
          <div className="mpm-format-dd__search-wrap">
            <Icon name="search" size={12} color="var(--text-tertiary)" />
            <input
              ref={inputRef}
              className="mpm-format-dd__search"
              placeholder="搜索版本…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setSearch(''))}
            />
          </div>
          <div className="mpm-format-dd__scroll">
            {filtered.length === 0 ? (
              <div className="mpm-format-dd__empty">无匹配版本</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.format}
                  type="button"
                  role="option"
                  className={`mpm-format-dd__opt${o.format === value ? ' mpm-format-dd__opt--active' : ''}`}
                  onClick={() => {
                    onChange(o.format);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <span className="mpm-format-dd__opt-label">{o.label}</span>
                  <span className="mpm-format-dd__opt-num">{o.format}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const MERGE_PREVIEW_IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

const LIST_ROW_H_COMPACT = 46;
const LIST_ROW_H_THUMB = 58;
const GRID_VIRTUAL_ROW_H = 204;
const GRID_MIN_TILE_PX = 188;
const GRID_GAP_PX = 12;

function clientToContentPoint(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return {
    x: clientX - r.left + el.scrollLeft,
    y: clientY - r.top + el.scrollTop,
  };
}

function langHintForPath(path: string, langMap: Record<string, string>): string {
  return (
    langMap[
      `block.minecraft.${path.replace(/.*textures\/block\//, '').replace(/\..*/, '').replace(/\//g, '.')}`
    ] ??
    langMap[
      `item.minecraft.${path.replace(/.*textures\/item\//, '').replace(/\..*/, '').replace(/\//g, '.')}`
    ] ??
    ''
  );
}

function mergePreviewMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function MergeConflictThumb({
  source,
  relPath,
  sizeClass = 'sm',
  eager = false,
  loadData = true,
}: {
  source: MergeSource;
  relPath: string;
  sizeClass?: 'sm' | 'md' | 'lg';
  eager?: boolean;
  loadData?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(eager);

  useEffect(() => {
    if (eager) return;
    const el = wrapRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: '80px', threshold: 0.01 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [eager]);

  const fileName = relPath.split('/').pop() ?? '';
  const canPreview = MERGE_PREVIEW_IMAGE_RE.test(fileName);
  const cacheKey = mergeThumbCacheKey(source.source_path, source.source_type, relPath);
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    loadData && canPreview ? getMergeThumbCached(cacheKey) : null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loadData) {
      setDataUrl(null);
      setFailed(false);
      return;
    }
    if (canPreview) {
      const hit = getMergeThumbCached(cacheKey);
      if (hit) {
        setDataUrl(hit);
        setFailed(false);
      }
    }
  }, [loadData, canPreview, cacheKey]);

  useEffect(() => {
    if (!inView) return;
    if (!loadData) return;
    if (!canPreview) {
      setFailed(true);
      return;
    }
    const hit = getMergeThumbCached(cacheKey);
    if (hit) {
      setDataUrl(hit);
      setFailed(false);
      return;
    }
    let gone = false;
    setDataUrl(null);
    setFailed(false);
    const mime = mergePreviewMime(relPath);
    readMergeSourceFileBase64(source.source_path, source.source_type, relPath)
      .then((b64) => {
        if (gone) return;
        const url = `data:${mime};base64,${b64}`;
        setMergeThumbCached(cacheKey, url);
        setDataUrl(url);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [inView, loadData, canPreview, source.source_path, source.source_type, relPath, cacheKey]);

  return (
    <div
      ref={wrapRef}
      className={`mpm-thumb mpm-thumb--${sizeClass}${!inView ? ' mpm-thumb--idle' : ''}`}
    >
      {!inView ? (
        <span className="mpm-thumb__shimmer" aria-hidden />
      ) : !canPreview ? (
        <Icon name="file" size={16} color="var(--text-tertiary)" />
      ) : !loadData ? (
        <Icon name="image" size={16} color="var(--text-tertiary)" />
      ) : failed ? (
        <span className="mpm-thumb__fail" title="无法加载预览">
          ×
        </span>
      ) : !dataUrl ? (
        <span className="mpm-thumb__spinner" aria-hidden />
      ) : (
        <img src={dataUrl} alt="" draggable={false} loading="lazy" decoding="async" />
      )}
    </div>
  );
}

function ConflictThumbSelector({
  conflict,
  sources,
  selectedIdx,
  excluded,
  onSelect,
  getSourceColor,
}: {
  conflict: FileConflict;
  sources: MergeSource[];
  selectedIdx: number;
  excluded: boolean;
  onSelect: (idx: number) => void;
  getSourceColor: (i: number) => string;
}) {
  const fileName = conflict.path.split('/').pop() ?? '';
  const canPreview = MERGE_PREVIEW_IMAGE_RE.test(fileName);

  return (
    <div className="mpm-thumb-selector" data-mpm-no-row-select onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {conflict.source_indices.map((srcIdx) => {
        const s = sources[srcIdx];
        if (!s) return null;
        const isSelected = !excluded && selectedIdx === srcIdx;
        const color = getSourceColor(srcIdx);
        return (
          <button
            key={srcIdx}
            type="button"
            className={`mpm-thumb-selector__btn${isSelected ? ' mpm-thumb-selector__btn--active' : ''}`}
            style={isSelected ? { borderColor: color, boxShadow: `0 0 0 1px ${color}40` } : {}}
            title={`${s.name} — 点击选用`}
            onClick={() => onSelect(srcIdx)}
          >
            {canPreview ? (
              <MergeConflictThumb source={s} relPath={conflict.path} sizeClass="sm" loadData={true} />
            ) : (
              <div className="mpm-thumb mpm-thumb--sm mpm-thumb--idle">
                <Icon name="file" size={14} color="var(--text-tertiary)" />
              </div>
            )}
            <span className="mpm-thumb-selector__idx" style={{ background: color }}>
              {srcIdx + 1}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className={`mpm-thumb-selector__excl${excluded ? ' mpm-thumb-selector__excl--active' : ''}`}
        title="排除（不融合）"
        onClick={() => onSelect(-1)}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function ConflictThumbSelectorGrid({
  conflict,
  sources,
  selectedIdx,
  excluded,
  onSelect,
  getSourceColor,
}: {
  conflict: FileConflict;
  sources: MergeSource[];
  selectedIdx: number;
  excluded: boolean;
  onSelect: (idx: number) => void;
  getSourceColor: (i: number) => string;
}) {
  const fileName = conflict.path.split('/').pop() ?? '';
  const canPreview = MERGE_PREVIEW_IMAGE_RE.test(fileName);

  return (
    <div
      className="mpm-thumb-selector mpm-thumb-selector--grid"
      data-mpm-no-row-select
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {conflict.source_indices.map((srcIdx) => {
        const s = sources[srcIdx];
        if (!s) return null;
        const isSelected = !excluded && selectedIdx === srcIdx;
        const color = getSourceColor(srcIdx);
        return (
          <button
            key={srcIdx}
            type="button"
            className={`mpm-thumb-selector__btn${isSelected ? ' mpm-thumb-selector__btn--active' : ''}`}
            style={isSelected ? { borderColor: color, boxShadow: `0 0 0 2px ${color}60` } : {}}
            title={`${s.name} — 点击选用`}
            onClick={() => onSelect(srcIdx)}
          >
            {canPreview ? (
              <MergeConflictThumb source={s} relPath={conflict.path} sizeClass="sm" loadData={true} />
            ) : (
              <div className="mpm-thumb mpm-thumb--sm mpm-thumb--idle">
                <Icon name="file" size={14} color="var(--text-tertiary)" />
              </div>
            )}
            <span className="mpm-thumb-selector__idx" style={{ background: color }}>
              {srcIdx + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BatchActionBar({
  selectedCount,
  sources,
  onApply,
  onClear,
}: {
  selectedCount: number;
  sources: MergeSource[];
  onApply: (srcIdx: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="mpm-batch-bar">
      <span className="mpm-batch-bar__count">
        <Icon name="check-square" size={14} />
        已选择 {selectedCount} 项
      </span>
      <div className="mpm-batch-bar__actions">
        {sources.map((s, i) => (
          <button key={i} type="button" className="mpm-batch-bar__apply" onClick={() => onApply(i)}>
            选用 {s.name}
          </button>
        ))}
      </div>
      <button type="button" className="mpm-batch-bar__clear" onClick={onClear}>
        <Icon name="close" size={12} />
        取消选择
      </button>
    </div>
  );
}

function MergeBatchContextMenu({
  x,
  y,
  sources,
  onPick,
  onExclude,
  onClose,
}: {
  x: number;
  y: number;
  sources: MergeSource[];
  onPick: (srcIdx: number) => void;
  onExclude: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    const pad = 6;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="mpm-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {sources.map((s, i) => (
        <button key={i} type="button" className="mpm-ctx-menu__item" role="menuitem" onClick={() => { onPick(i); onClose(); }}>
          <span className="mpm-ctx-menu__dot" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
          选用来源 {i + 1}：{s.name}
        </button>
      ))}
      <div className="mpm-ctx-menu__sep" />
      <button type="button" className="mpm-ctx-menu__item mpm-ctx-menu__item--danger" role="menuitem" onClick={() => { onExclude(); onClose(); }}>
        排除（不融合）
      </button>
    </div>
  );
}

export default function PackMergePage({ onClose, initialSources, onRepick, onMergeAgain }: PackMergePageProps) {
  const toast = useToast();
  const pickSourcesRef = useRef(initialSources);
  pickSourcesRef.current = initialSources;

  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [jobPhase, setJobPhase] = useState<JobPhase>('idle');
  const [sources, setSources] = useState<MergeSource[]>([]);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, number>>({});
  const [excludeSet, setExcludeSet] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [outputDir, setOutputDir] = useState('');
  const [outputFileStem, setOutputFileStem] = useState('merged_pack');
  const [finalDescription, setFinalDescription] = useState('');
  const [finalPackFormat, setFinalPackFormat] = useState(34);
  const [versionOptions, setVersionOptions] = useState<PackFormatOption[]>(PACK_FORMAT_OPTIONS);

  const [conflictSearch, setConflictSearch] = useState('');
  const [langMap, setLangMap] = useState<Record<string, string>>({});
  const [conflictFilter, setConflictFilter] = useState<'all' | 'image'>('all');
  const [conflictView, setConflictView] = useState<'list' | 'grid'>('list');
  const [showListThumbs, setShowListThumbs] = useState(false);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<null | { x: number; y: number }>(null);
  const ctxMenuOpenRef = useRef(false);
  const [marqueeBox, setMarqueeBox] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);

  const resetAfterSuccess = () => {
    setJobPhase('idle');
    setMergeResult(null);
    setProgress(null);
    setError(null);
    setOutputDir('');
    setOutputFileStem('merged_pack');
    setFinalDescription('');
    setFinalPackFormat(34);
    setConflictSearch('');
    setConflictFilter('all');
    setConflictView('list');
    setShowListThumbs(false);
    setReviewAcknowledged(false);
    setExcludeSet(new Set());
    setConflictResolutions({});
    setPreview(null);
    setSources([]);
    setPreviewError(null);
    setBatchMode(false);
    setBatchSelected(new Set());
    setCtxMenu(null);
    setMarqueeBox(null);
  };

  useEffect(() => {
    getAllPackFormatsWithReleases()
      .then((opts) => {
        if (opts.length > 0) {
          setVersionOptions(
            opts.map(([f, l]) => ({
              format: f,
              label: l,
              searchText: l.toLowerCase(),
            }))
          );
        }
      })
      .catch(() => {});
    invoke<Record<string, string>>('load_language_map').then(setLangMap).catch(() => {});
  }, []);

  useEffect(() => {
    if (jobPhase !== 'merging') return;
    const unlisten = listen<MergeProgress>('merge-progress', (ev) => setProgress(ev.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [jobPhase]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const picked = pickSourcesRef.current;
      if (picked.length < 2) {
        setPreviewError('至少需要 2 个资源包');
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const raw = picked.map((s) => ({ path: s.source_path, source_type: s.source_type as 'Zip' | 'Folder' }));
        const result = await previewPackMerge(raw);
        if (cancelled) return;
        const infos = result.sources.map((s, i) => ({
          ...s,
          source_path: picked[i]?.source_path ?? s.source_path,
          source_type: picked[i]?.source_type ?? s.source_type,
        }));
        setSources(infos);
        const first = result.sources.find((s) => s.pack_format > 0);
        if (first) {
          setFinalPackFormat(first.pack_format);
          setFinalDescription(first.description || '');
        }
        const res: Record<string, number> = {};
        for (const c of result.conflicts.conflicts) res[c.path] = c.winner_index;
        setConflictResolutions(res);
        setExcludeSet(new Set());
        setPreview(result);
      } catch (err) {
        if (!cancelled) setPreviewError(String(err));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickOutputFolderSafe = useCallback(async () => {
    try {
      const d = await selectOutputFolder();
      if (d) setOutputDir(d);
    } catch (err) {
      toast({ message: `无法打开文件夹对话框：${String(err)}`, type: 'error' });
    }
  }, [toast]);

  const handleMerge = async () => {
    if (!outputDir) {
      toast({ message: '请先在「输出目录」中点击输入框或「浏览」，选择要保存合并 ZIP 的文件夹', type: 'warning' });
      return;
    }
    if (!sanitizeZipStem(outputFileStem)) {
      toast({ message: '请输入输出文件名', type: 'warning' });
      return;
    }
    setLoading(true);
    setError(null);
    setJobPhase('merging');
    setProgress({ phase: '准备中', current: 0, total: 0, current_file: null });
    try {
      const raw = sources.map((s) => ({ path: s.source_path, source_type: s.source_type as 'Zip' | 'Folder' }));
      const resList: ConflictResolution[] = Object.entries(conflictResolutions).map(([path, si]) => ({
        path,
        chosen_source: sources[si]?.name ?? '',
        winner_index: si,
        exclude: excludeSet.has(path),
      }));
      const cfg: MergeConfig = {
        output_dir: outputDir,
        output_file_name: zipOutputFileName(outputFileStem),
        final_description: finalDescription,
        final_pack_format: finalPackFormat,
        conflict_resolutions: resList,
        blacklist_patterns: [],
        whitelist_patterns: [],
      };
      const result = await executePackMerge(raw, cfg);
      setMergeResult(result);
      setReviewAcknowledged(false);
      setJobPhase('review');
      toast({ message: '已写入磁盘，请完成导出核对', type: 'success' });
    } catch (err) {
      setError(String(err));
      toast({ message: '融合失败', type: 'error' });
      setJobPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const filteredConflicts = useMemo(() => {
    if (!preview) return [];
    let list = preview.conflicts.conflicts.filter((c) => mergePathMatchesQuery(c.path, conflictSearch, langMap));
    if (conflictFilter === 'image') {
      list = list.filter((c) => MERGE_PREVIEW_IMAGE_RE.test(c.path.split('/').pop() ?? ''));
    }
    return list;
  }, [preview, conflictSearch, langMap, conflictFilter]);

  const listRowHeight = showListThumbs ? LIST_ROW_H_THUMB : LIST_ROW_H_COMPACT;
  const listVirtual = useVirtualListRange({
    count: conflictView === 'list' ? filteredConflicts.length : 0,
    rowHeight: listRowHeight,
    overscan: 12,
  });
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const gridVirtual = useVirtualGridRows({
    itemCount: conflictView === 'grid' ? filteredConflicts.length : 0,
    scrollRef: gridScrollRef,
    rowHeight: GRID_VIRTUAL_ROW_H,
    minTileWidth: GRID_MIN_TILE_PX,
    gapPx: GRID_GAP_PX,
    horizontalPadding: 24,
    overscan: 2,
  });

  useEffect(() => {
    if (listVirtual.scrollRef.current) listVirtual.scrollRef.current.scrollTop = 0;
    if (gridScrollRef.current) gridScrollRef.current.scrollTop = 0;
  }, [conflictSearch, conflictFilter, conflictView, showListThumbs, filteredConflicts.length, listVirtual.scrollRef]);

  const getResolvedSrcIdx = (path: string) =>
    conflictResolutions[path] ?? preview?.conflicts.conflicts.find((c) => c.path === path)?.winner_index ?? 0;

  const getSourceColor = (i: number) => SOURCE_COLORS[i % SOURCE_COLORS.length];

  const showMergeWorkspace = !previewLoading && !previewError && preview !== null && jobPhase === 'idle';
  const layoutTallBody =
    showMergeWorkspace || jobPhase === 'merging' || jobPhase === 'review' || jobPhase === 'done';

  const handleConflictSelect = (path: string, srcIdx: number) => {
    setExcludeSet((s) => {
      const n = new Set(s);
      n.delete(path);
      return n;
    });
    setConflictResolutions((p) => ({ ...p, [path]: srcIdx }));
  };

  const handleConflictExclude = (path: string) => {
    setExcludeSet((s) => {
      const n = new Set(s);
      n.add(path);
      return n;
    });
  };

  const applyBatchToSelected = (srcIdx: number) => {
    if (batchSelected.size === 0) return;
    const next = { ...conflictResolutions };
    const nextExclude = new Set(excludeSet);
    const n = batchSelected.size;
    batchSelected.forEach((path) => {
      next[path] = srcIdx;
      nextExclude.delete(path);
    });
    setConflictResolutions(next);
    setExcludeSet(nextExclude);
    toast({ message: `已将 ${n} 项设为 "${sources[srcIdx]?.name}"`, type: 'success' });
    setBatchSelected(new Set());
    setCtxMenu(null);
  };

  const applyBatchExcludeToSelected = () => {
    if (batchSelected.size === 0) return;
    const n = batchSelected.size;
    setExcludeSet((s) => {
      const next = new Set(s);
      batchSelected.forEach((path) => next.add(path));
      return next;
    });
    toast({ message: `已排除 ${n} 项`, type: 'success' });
    setBatchSelected(new Set());
    setCtxMenu(null);
  };

  const filteredConflictsRef = useRef(filteredConflicts);
  filteredConflictsRef.current = filteredConflicts;
  const listRowHeightRef = useRef(listRowHeight);
  listRowHeightRef.current = listRowHeight;
  ctxMenuOpenRef.current = ctxMenu !== null;

  const marqueePointerRef = useRef<number | null>(null);
  const marqueeDraftRef = useRef<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const onListPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, textarea, select, label, [data-mpm-no-row-select]')) return;
    const el = e.currentTarget;
    lastPointerClientRef.current = { clientX: e.clientX, clientY: e.clientY };
    const pt = clientToContentPoint(el, e.clientX, e.clientY);
    marqueeDraftRef.current = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    setMarqueeBox({ ...marqueeDraftRef.current });
    marqueePointerRef.current = e.pointerId;
    el.setPointerCapture(e.pointerId);
  }, []);

  const onListPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (marqueePointerRef.current !== e.pointerId || !marqueeDraftRef.current) return;
    const el = e.currentTarget;
    lastPointerClientRef.current = { clientX: e.clientX, clientY: e.clientY };
    const pt = clientToContentPoint(el, e.clientX, e.clientY);
    marqueeDraftRef.current.x1 = pt.x;
    marqueeDraftRef.current.y1 = pt.y;
    setMarqueeBox({ ...marqueeDraftRef.current });
  }, []);

  const finishMarquee = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (marqueePointerRef.current !== e.pointerId) return;
    const el = e.currentTarget;
    if (marqueeDraftRef.current) {
      const pt = clientToContentPoint(el, e.clientX, e.clientY);
      marqueeDraftRef.current.x1 = pt.x;
      marqueeDraftRef.current.y1 = pt.y;
    }
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    marqueePointerRef.current = null;
    lastPointerClientRef.current = null;
    const m = marqueeDraftRef.current;
    marqueeDraftRef.current = null;
    setMarqueeBox(null);

    if (!m) return;
    const dx = Math.abs(m.x1 - m.x0);
    const dy = Math.abs(m.y1 - m.y0);
    if (dx < 4 && dy < 4) return;

    const scrollEl = listVirtual.scrollRef.current;
    if (!scrollEl) return;
    const H = listRowHeightRef.current;
    const yTop = Math.min(m.y0, m.y1);
    const yBot = Math.max(m.y0, m.y1);
    const list = filteredConflictsRef.current;
    const n = list.length;
    if (n === 0 || H <= 0) return;

    let i0 = Math.floor(yTop / H);
    let i1 = Math.floor((yBot - 0.01) / H);
    i0 = Math.max(0, Math.min(n - 1, i0));
    i1 = Math.max(0, Math.min(n - 1, i1));
    if (i0 > i1) [i0, i1] = [i1, i0];

    const paths = new Set<string>();
    for (let i = i0; i <= i1; i++) paths.add(list[i].path);

    setBatchSelected((prev) => {
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(prev);
        paths.forEach((p) => next.add(p));
        return next;
      }
      return paths;
    });
    if (paths.size > 0) setBatchMode(true);
  }, [listVirtual.scrollRef]);

  const onListLostCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (marqueePointerRef.current !== e.pointerId) return;
    marqueePointerRef.current = null;
    marqueeDraftRef.current = null;
    lastPointerClientRef.current = null;
    setMarqueeBox(null);
  }, []);

  /** 拖拽框选时若滚动列表，按当前指针位置用最新 scrollTop 刷新选框终点 */
  useEffect(() => {
    if (!marqueeBox) return;
    const el = listVirtual.scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (marqueePointerRef.current == null || !marqueeDraftRef.current || !lastPointerClientRef.current) return;
      const { clientX, clientY } = lastPointerClientRef.current;
      const pt = clientToContentPoint(el, clientX, clientY);
      marqueeDraftRef.current.x1 = pt.x;
      marqueeDraftRef.current.y1 = pt.y;
      setMarqueeBox({ ...marqueeDraftRef.current });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [marqueeBox !== null, listVirtual.scrollRef]);

  useEffect(() => {
    if (!marqueeBox) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [marqueeBox !== null]);

  useEffect(() => {
    if (!showMergeWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ctxMenuOpenRef.current) {
          setCtxMenu(null);
          return;
        }
        setBatchSelected(new Set());
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      const list = filteredConflictsRef.current;
      if (list.length === 0) return;
      setBatchSelected(new Set(list.map((c) => c.path)));
      setBatchMode(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMergeWorkspace]);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => setCtxMenu(null);
    const id = window.setTimeout(() => window.addEventListener('mousedown', onDown, true), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [ctxMenu]);

  const showBatchColumn = batchMode || batchSelected.size > 0;

  return (
    <div
      className={`mpm-layout${showMergeWorkspace ? ' mpm-layout--merge' : ''}${layoutTallBody ? ' mpm-layout--tall-body' : ''}`}
    >
      <div className="mpm-topbar">
        <div className="mpm-topbar__start">
          <button type="button" className="mpm-back-btn" onClick={onClose}>
            <Icon name="arrow-left" size={16} />
            返回首页
          </button>
        </div>
        <div className="mpm-topbar__title">
          <Icon name="merge" size={20} />
          <span>材质包融合</span>
        </div>
        <div className="mpm-topbar__end">
          {showMergeWorkspace ? (
            <button
              type="button"
              className="mpm-back-btn"
              onClick={() => onRepick(sources)}
              title="回到选择窗口调整列表"
            >
              <Icon name="folder" size={14} />
              重新选择
            </button>
          ) : (
            <div className="mpm-topbar__spacer" aria-hidden />
          )}
        </div>
      </div>

      <div className="mpm-body">
        {previewLoading && (
          <div className="mpm-preview-loading">
            <div className="mpm-preview-loading__spinner" />
            <p className="mpm-preview-loading__title">正在分析资源包…</p>
            <p className="mpm-preview-loading__hint">请稍候，包体较大时可能需要几秒钟</p>
          </div>
        )}

        {previewError && (
          <div className="mpm-preview-error">
            <Icon name="close" size={24} className="mpm-preview-error__icon" />
            <h3>无法开始融合</h3>
            <p className="mpm-preview-error__msg">{previewError}</p>
            <div className="mpm-preview-error__actions">
              <button type="button" className="mpm-cancel-btn" onClick={onClose}>
                返回首页
              </button>
              <button type="button" className="mpm-next-btn" onClick={() => onRepick(pickSourcesRef.current)}>
                重新选择资源包
              </button>
            </div>
          </div>
        )}

        {error && jobPhase === 'idle' && showMergeWorkspace && <div className="merge-error mpm-error">{error}</div>}

        {showMergeWorkspace && preview && (
          <div className="mpm-merge-view">
            <aside className="mpm-sidebar mpm-sidebar--modern">
              <div className="mpm-side-hero">
                <div className="mpm-side-hero__label">融合概览</div>
                <div className="mpm-stat-grid">
                  <div className="mpm-stat-pill">
                    <span className="mpm-stat-pill__val">{sources.length}</span>
                    <span className="mpm-stat-pill__lbl">资源包</span>
                  </div>
                  <div className="mpm-stat-pill">
                    <span className="mpm-stat-pill__val">{preview.total_merged_files}</span>
                    <span className="mpm-stat-pill__lbl">总文件</span>
                  </div>
                  <div className={`mpm-stat-pill${preview.conflicts.total_conflicts > 0 ? ' mpm-stat-pill--warn' : ' mpm-stat-pill--ok'}`}>
                    <span className="mpm-stat-pill__val">{preview.conflicts.total_conflicts}</span>
                    <span className="mpm-stat-pill__lbl">冲突</span>
                  </div>
                </div>
              </div>

              <div className="mpm-side-card">
                <div className="mpm-side-card__head">
                  <Icon name="settings" size={14} />
                  <span>输出包版本</span>
                </div>
                <p className="mpm-side-card__hint">写入合并包 pack.mcmeta 的 pack_format</p>
                <SearchablePackFormatDropdown value={finalPackFormat} options={versionOptions} onChange={setFinalPackFormat} />
              </div>

              <div className="mpm-side-card mpm-side-card--sources">
                <div className="mpm-side-card__head">
                  <Icon name="merge" size={14} />
                  <span>优先级（上优先）</span>
                </div>
                <div className="sources-list sources-list--merge-sidebar">
                  {sources.map((src, i) => (
                    <div key={`${src.source_path}-${i}`} className="source-card source-card--merge">
                      <div className="source-icon" style={{ background: `${getSourceColor(i)}22`, color: getSourceColor(i) }}>
                        {i + 1}
                      </div>
                      <div className="source-info">
                        <div className="source-name">{src.name}</div>
                        <div className="source-meta">
                          <span className={`tag ${src.source_type === 'Zip' ? 'zip' : 'folder'}`}>{src.source_type}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <div className="mpm-main">
              <div className={`mpm-output-section${!outputDir ? ' mpm-output-section--needs-dir' : ''}`}>
                <div className="mpm-output-row">
                  <label className="mpm-output-label">输出目录</label>
                  <div className="mpm-output-dir">
                    <input
                      readOnly
                      value={outputDir}
                      placeholder="点击此处或右侧「浏览」选择文件夹"
                      onClick={() => void pickOutputFolderSafe()}
                    />
                    <button type="button" className="mpm-browse-btn" onClick={() => void pickOutputFolderSafe()}>
                      <Icon name="folder" size={14} /> 浏览
                    </button>
                  </div>
                  {!outputDir && (
                    <p className="mpm-output-gate-hint">必选：指定合并包 ZIP 的保存位置后，即可点击「开始融合」。</p>
                  )}
                </div>
                <div className="mpm-output-row">
                  <label className="mpm-output-label">输出文件名</label>
                  <div className="mpm-filename-suffix">
                    <input value={outputFileStem} onChange={(e) => setOutputFileStem(sanitizeZipStem(e.target.value))} />
                    <span>.zip</span>
                  </div>
                </div>
                <div className="mpm-output-row">
                  <label className="mpm-output-label">描述</label>
                  <input
                    className="mpm-input"
                    value={finalDescription}
                    onChange={(e) => setFinalDescription(e.target.value)}
                    placeholder="资源包描述"
                  />
                </div>
              </div>

              <div className="mpm-conflict-section mpm-conflict-section--card">
                <div className="mpm-conflict-section__head">
                  <div className="mpm-conflict-section__title">
                    <Icon name="merge" size={20} />
                    <span>冲突解决</span>
                  </div>
                  <p className="mpm-conflict-lead">
                    点击缩略图选用来源（数字对应左侧包顺序）。列表上拖拽可框选；Ctrl/⌘+点击行多选；按住 Ctrl/⌘ 框选可追加；Ctrl+A
                    全选当前筛选结果；右键批量选用或排除。Esc 关闭菜单或清空选择。
                  </p>
                </div>
                <div className="mpm-conflict-toolbar">
                  <div className="mpm-conflict-toolbar__search">
                    <Icon name="search" size={16} color="var(--text-tertiary)" className="mpm-conflict-toolbar__search-icon" />
                    <input
                      className="mpm-search-input"
                      placeholder="搜索路径或中文名…"
                      value={conflictSearch}
                      onChange={(e) => setConflictSearch(e.target.value)}
                      aria-label="搜索冲突文件"
                    />
                  </div>
                  <div className="mpm-conflict-toolbar__filters">
                    <div className="mpm-seg" role="group" aria-label="类型筛选">
                      <button
                        type="button"
                        className={`mpm-seg__btn${conflictFilter === 'all' ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => setConflictFilter('all')}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className={`mpm-seg__btn${conflictFilter === 'image' ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => setConflictFilter('image')}
                      >
                        仅图片
                      </button>
                    </div>
                    <div className="mpm-seg" role="group" aria-label="列表缩略图" title="关闭可明显减少卡顿">
                      <button
                        type="button"
                        className={`mpm-seg__btn${showListThumbs ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => setShowListThumbs((v) => !v)}
                        disabled={conflictView !== 'list'}
                      >
                        列表预览
                      </button>
                    </div>
                    <div className="mpm-seg" role="group" aria-label="视图">
                      <button
                        type="button"
                        title="列表视图"
                        className={`mpm-seg__btn mpm-seg__btn--icon${conflictView === 'list' ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => setConflictView('list')}
                      >
                        <Icon name="layout" size={16} />
                      </button>
                      <button
                        type="button"
                        title="网格视图"
                        className={`mpm-seg__btn mpm-seg__btn--icon${conflictView === 'grid' ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => setConflictView('grid')}
                      >
                        <Icon name="grid" size={16} />
                      </button>
                    </div>
                    <div className="mpm-seg" role="group" aria-label="批量选择">
                      <button
                        type="button"
                        title="批量选择模式"
                        className={`mpm-seg__btn mpm-seg__btn--icon${batchMode ? ' mpm-seg__btn--active' : ''}`}
                        onClick={() => {
                          setBatchMode((v) => !v);
                          if (batchMode) setBatchSelected(new Set());
                        }}
                      >
                        <Icon name="check-square" size={16} />
                      </button>
                    </div>
                    <span className="mpm-conflict-meta">
                      {filteredConflicts.length} / {preview.conflicts.total_conflicts}
                    </span>
                  </div>
                </div>

                {batchSelected.size > 0 && (
                  <BatchActionBar
                    selectedCount={batchSelected.size}
                    sources={sources}
                    onApply={applyBatchToSelected}
                    onClear={() => setBatchSelected(new Set())}
                  />
                )}

                {conflictView === 'list' && (
                  <div
                    className={`mpm-conflict-head${showListThumbs ? '' : ' mpm-conflict-head--compact'}${showBatchColumn ? ' mpm-conflict-head--batch' : ''}`}
                    role="row"
                  >
                    {showBatchColumn && <span></span>}
                    {showListThumbs && <span>预览</span>}
                    <span>冲突项</span>
                    <span>选择来源</span>
                  </div>
                )}
                {conflictView === 'list' &&
                  (filteredConflicts.length === 0 && preview.conflicts.total_conflicts > 0 ? (
                    <div className="mpm-conflict-scroll mpm-conflict-scroll--virtual">
                      <div className="mpm-conflict-empty mpm-conflict-empty--in-scroll">
                        <p>没有符合条件的冲突项</p>
                        {(conflictSearch.trim() !== '' || conflictFilter === 'image') && (
                          <span className="mpm-conflict-empty__hint">试试清空搜索或切换到「全部」</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={listVirtual.scrollRef}
                      className="mpm-conflict-scroll mpm-conflict-scroll--virtual mpm-conflict-scroll--selectable"
                      onPointerDown={onListPointerDown}
                      onPointerMove={onListPointerMove}
                      onPointerUp={finishMarquee}
                      onPointerCancel={finishMarquee}
                      onLostPointerCapture={onListLostCapture}
                      onContextMenu={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button, input, textarea, [data-mpm-no-row-select], .mpm-conflict-row')) return;
                        if (batchSelected.size === 0) return;
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      {marqueeBox && (
                        <div
                          className="mpm-marquee"
                          style={{
                            left: Math.min(marqueeBox.x0, marqueeBox.x1),
                            top: Math.min(marqueeBox.y0, marqueeBox.y1),
                            width: Math.abs(marqueeBox.x1 - marqueeBox.x0),
                            height: Math.abs(marqueeBox.y1 - marqueeBox.y0),
                          }}
                          aria-hidden
                        />
                      )}
                      <div className="mpm-conflict-virtual-spacer" style={{ height: listVirtual.totalHeight, position: 'relative' }}>
                        <div
                          className="mpm-conflict-virtual-window"
                          style={{
                            position: 'absolute',
                            top: listVirtual.start * listRowHeight,
                            left: 0,
                            right: 0,
                          }}
                        >
                          {filteredConflicts.slice(listVirtual.start, listVirtual.end).map((c) => {
                            const resIdx = getResolvedSrcIdx(c.path);
                            const isExcl = excludeSet.has(c.path);
                            const resolvedName = sources[resIdx]?.name ?? '';
                            const srcForThumb = sources[resIdx];
                            const zhHints = langHintForPath(c.path, langMap);
                            const isBatchChecked = batchSelected.has(c.path);
                            return (
                              <div
                                key={c.path}
                                className={`mpm-conflict-row mpm-conflict-row--virtual${showListThumbs ? '' : ' mpm-conflict-row--compact'}${showBatchColumn ? ' mpm-conflict-row--batch' : ''}${isExcl ? ' mpm-conflict-row--excl' : ''}${isBatchChecked ? ' mpm-conflict-row--sel' : ''}`}
                                style={{ height: listRowHeight }}
                                onClick={(e) => {
                                  if (!(e.ctrlKey || e.metaKey)) return;
                                  const t = e.target as HTMLElement;
                                  if (t.closest('[data-mpm-no-row-select], input, button, a')) return;
                                  e.preventDefault();
                                  setBatchSelected((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(c.path)) n.delete(c.path);
                                    else n.add(c.path);
                                    return n;
                                  });
                                  setBatchMode(true);
                                }}
                                onContextMenu={(e) => {
                                  const t = e.target as HTMLElement;
                                  if (t.closest('[data-mpm-no-row-select], input, button, a')) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBatchSelected((prev) => {
                                    if (prev.has(c.path)) return prev;
                                    return new Set([c.path]);
                                  });
                                  setCtxMenu({ x: e.clientX, y: e.clientY });
                                }}
                              >
                                {showBatchColumn && (
                                  <div className="mpm-col-batch">
                                    <input
                                      type="checkbox"
                                      checked={isBatchChecked}
                                      onChange={(e) => {
                                        setBatchSelected((s) => {
                                          const n = new Set(s);
                                          if (e.target.checked) n.add(c.path);
                                          else n.delete(c.path);
                                          return n;
                                        });
                                      }}
                                    />
                                  </div>
                                )}
                                {showListThumbs && (
                                  <div className="mpm-col-thumb">
                                    {srcForThumb ? (
                                      <MergeConflictThumb
                                        source={srcForThumb}
                                        relPath={c.path}
                                        sizeClass="sm"
                                        loadData={showListThumbs}
                                      />
                                    ) : (
                                      <div className="mpm-thumb mpm-thumb--sm mpm-thumb--idle" />
                                    )}
                                  </div>
                                )}
                                <div className="mpm-col-main" title={c.path}>
                                  <div className="mpm-col-main__name">{c.path.split('/').pop()}</div>
                                  <div className="mpm-col-main__sub">
                                    {zhHints ? (
                                      <>
                                        <span className="mpm-col-main__zh">{zhHints}</span>
                                        <span className="mpm-col-main__dot" aria-hidden>
                                          ·
                                        </span>
                                        <span className="mpm-col-main__src">{resolvedName}</span>
                                      </>
                                    ) : (
                                      resolvedName || '\u00a0'
                                    )}
                                    {isExcl && <span className="excl-tag">已排除</span>}
                                  </div>
                                </div>
                                <div className="mpm-col-action">
                                  <ConflictThumbSelector
                                    conflict={c}
                                    sources={sources}
                                    selectedIdx={resIdx}
                                    excluded={isExcl}
                                    onSelect={(idx) => {
                                      if (idx === -1) {
                                        handleConflictExclude(c.path);
                                      } else {
                                        handleConflictSelect(c.path, idx);
                                      }
                                    }}
                                    getSourceColor={getSourceColor}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                {conflictView === 'grid' &&
                  (filteredConflicts.length === 0 && preview.conflicts.total_conflicts > 0 ? (
                    <div className="mpm-conflict-scroll mpm-conflict-scroll--grid mpm-conflict-scroll--virtual">
                      <div className="mpm-conflict-empty mpm-conflict-empty--in-scroll">
                        <p>没有符合条件的冲突项</p>
                        {(conflictSearch.trim() !== '' || conflictFilter === 'image') && (
                          <span className="mpm-conflict-empty__hint">试试清空搜索或切换到「全部」</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={gridScrollRef}
                      className="mpm-conflict-scroll mpm-conflict-scroll--grid mpm-conflict-scroll--virtual"
                      onContextMenu={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button, input, textarea, [data-mpm-no-row-select], .mpm-conflict-tile')) return;
                        if (batchSelected.size === 0) return;
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      <div className="mpm-conflict-virtual-spacer" style={{ height: gridVirtual.totalHeight, position: 'relative' }}>
                        <div
                          className="mpm-conflict-virtual-grid-window"
                          style={{
                            position: 'absolute',
                            top: gridVirtual.rowStart * GRID_VIRTUAL_ROW_H,
                            left: 0,
                            right: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                          }}
                        >
                          {Array.from({ length: gridVirtual.rowEnd - gridVirtual.rowStart }, (_, ri) => {
                            const row = gridVirtual.rowStart + ri;
                            const slice = filteredConflicts.slice(row * gridVirtual.itemsPerRow, (row + 1) * gridVirtual.itemsPerRow);
                            return (
                              <div
                                key={row}
                                className="mpm-virtual-grid-row"
                                style={{
                                  height: GRID_VIRTUAL_ROW_H,
                                  display: 'grid',
                                  gridTemplateColumns: `repeat(${gridVirtual.itemsPerRow}, minmax(0, 1fr))`,
                                  gap: '0.75rem',
                                  alignItems: 'stretch',
                                }}
                              >
                                {slice.map((c) => {
                                  const resIdx = getResolvedSrcIdx(c.path);
                                  const isExcl = excludeSet.has(c.path);
                                  const resolvedName = sources[resIdx]?.name ?? '';
                                  const zhHints = langHintForPath(c.path, langMap);
                                  const isBatchChecked = batchSelected.has(c.path);
                                  return (
                                    <article
                                      key={c.path}
                                      className={`mpm-conflict-tile mpm-conflict-tile--virtual${isExcl ? ' mpm-conflict-tile--excl' : ''}${isBatchChecked ? ' mpm-conflict-tile--sel' : ''}`}
                                      onClick={(e) => {
                                        if (!(e.ctrlKey || e.metaKey)) return;
                                        const t = e.target as HTMLElement;
                                        if (t.closest('[data-mpm-no-row-select], input, button, a')) return;
                                        e.preventDefault();
                                        setBatchSelected((prev) => {
                                          const n = new Set(prev);
                                          if (n.has(c.path)) n.delete(c.path);
                                          else n.add(c.path);
                                          return n;
                                        });
                                        setBatchMode(true);
                                      }}
                                      onContextMenu={(e) => {
                                        const t = e.target as HTMLElement;
                                        if (t.closest('[data-mpm-no-row-select], input, button, a')) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setBatchSelected((prev) => {
                                          if (prev.has(c.path)) return prev;
                                          return new Set([c.path]);
                                        });
                                        setCtxMenu({ x: e.clientX, y: e.clientY });
                                      }}
                                    >
                                      {showBatchColumn && (
                                        <div className="mpm-tile-batch">
                                          <input
                                            type="checkbox"
                                            checked={isBatchChecked}
                                            onChange={(e) => {
                                              setBatchSelected((s) => {
                                                const n = new Set(s);
                                                if (e.target.checked) n.add(c.path);
                                                else n.delete(c.path);
                                                return n;
                                              });
                                            }}
                                          />
                                        </div>
                                      )}
                                      <div className="mpm-conflict-tile__preview">
                                        <ConflictThumbSelectorGrid
                                          conflict={c}
                                          sources={sources}
                                          selectedIdx={resIdx}
                                          excluded={isExcl}
                                          onSelect={(idx) => {
                                            if (idx === -1) {
                                              handleConflictExclude(c.path);
                                            } else {
                                              handleConflictSelect(c.path, idx);
                                            }
                                          }}
                                          getSourceColor={getSourceColor}
                                        />
                                      </div>
                                      <div className="mpm-conflict-tile__body">
                                        <div className="mpm-conflict-tile__title" title={c.path}>
                                          {c.path.split('/').pop()}
                                        </div>
                                        <div className="mpm-conflict-tile__hint">
                                          {zhHints || resolvedName}
                                          {isExcl && <span className="excl-tag">已排除</span>}
                                        </div>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                {ctxMenu && (
                  <MergeBatchContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    sources={sources}
                    onPick={applyBatchToSelected}
                    onExclude={applyBatchExcludeToSelected}
                    onClose={() => setCtxMenu(null)}
                  />
                )}
              </div>

              <div className="mpm-merge-footer">
                <button type="button" className="mpm-cancel-btn" onClick={() => onRepick(sources)}>
                  <Icon name="chevron-left" size={14} /> 重新选择
                </button>
                <button
                  type="button"
                  className={`mpm-merge-btn${!outputDir || !sanitizeZipStem(outputFileStem) ? ' mpm-merge-btn--await-setup' : ''}`}
                  onClick={() => void handleMerge()}
                  disabled={loading}
                  title={
                    loading
                      ? '融合进行中…'
                      : !outputDir
                        ? '需先选择输出目录（见上方）'
                        : !sanitizeZipStem(outputFileStem)
                          ? '请填写有效的输出文件名'
                          : undefined
                  }
                >
                  <Icon name="merge" size={14} />
                  {loading ? '融合中…' : '开始融合'}
                </button>
              </div>
            </div>
          </div>
        )}

        {jobPhase === 'merging' && progress && (
          <div className="mpm-progress">
            <h3>融合进度</h3>
            <div className="mpm-progress__phase">
              <Icon name={progress.phase === '完成' ? 'check' : 'refresh'} size={16} />
              {progress.phase}
            </div>
            <div className="mpm-progress__bar">
              <div
                className="mpm-progress__fill"
                style={{ width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="mpm-progress__info">
              {progress.current} / {progress.total}
            </div>
            {progress.current_file && <div className="mpm-progress__file">{progress.current_file}</div>}
          </div>
        )}

        {jobPhase === 'review' && mergeResult && (
          <div className="mpm-review">
            <div className="mpm-review__badge">
              <Icon name="check" size={24} />
            </div>
            <h3 className="mpm-review__title">融合已写入，请核对导出</h3>
            <p className="mpm-review__lead">
              ZIP 已保存到本地。请确认路径与摘要无误后再结束流程；如需改动冲突策略，可返回继续调整（可再次融合覆盖同一文件）。
            </p>
            <div className="mpm-review__path-block">
              <span className="mpm-review__path-label">输出路径</span>
              <code className="mpm-review__path">{mergeResult.output_path}</code>
            </div>
            <ul className="mpm-review__stats">
              <li>文件总数：{mergeResult.total_files}</li>
              <li>冲突条目处理：{mergeResult.conflicts_resolved}</li>
              <li>pack_format：{mergeResult.output_pack_format}</li>
            </ul>
            <label className="mpm-review__confirm">
              <input
                type="checkbox"
                checked={reviewAcknowledged}
                onChange={(e) => setReviewAcknowledged(e.target.checked)}
              />
              <span>我已核对输出路径与包信息，确认可以结束本次导出</span>
            </label>
            <div className="mpm-review__actions">
              <Button variant="secondary" onClick={() => setJobPhase('idle')}>
                返回继续调整
              </Button>
              <Button
                variant="secondary"
                onClick={() => openFolder(parentDirPath(mergeResult.output_path)).catch(() => toast({ message: '无法打开文件夹', type: 'error' }))}
              >
                <Icon name="folder" size={14} /> 打开所在文件夹
              </Button>
              <Button variant="primary" disabled={!reviewAcknowledged} onClick={() => setJobPhase('done')}>
                确认完成
              </Button>
            </div>
          </div>
        )}

        {jobPhase === 'done' && mergeResult && (
          <div className="mpm-success">
            <div className="mpm-success__icon">
              <Icon name="check" size={32} />
            </div>
            <h3>导出流程已完成</h3>
            <p>
              资源包位于 <code>{mergeResult.output_path}</code>
            </p>
            <div className="mpm-success__details">
              <p>文件总数：{mergeResult.total_files}</p>
              <p>冲突解决：{mergeResult.conflicts_resolved}</p>
            </div>
            <div className="mpm-success__actions">
              <button type="button" className="mpm-cancel-btn" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="mpm-merge-btn"
                onClick={() => {
                  resetAfterSuccess();
                  onMergeAgain();
                }}
              >
                <Icon name="refresh" size={14} /> 再次融合
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
