import { useState, useEffect, useCallback } from 'react';
import { Icon, useToast } from '@mpe/ui';
import { selectZipFile, selectFolder } from '../utils/tauri-api';
import type { MergeSource } from '../types/pack';
import './VersionConverterModal.css';
import './MergeSourceList.css';
import './PackMergePickModal.css';

export interface PackMergePickModalProps {
  onClose: () => void;
  onContinue: (sources: MergeSource[]) => void;
  initialSources?: MergeSource[];
}

const SOURCE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function nativeFilePath(file: File): string | undefined {
  const withPath = file as File & { path?: string };
  return typeof withPath.path === 'string' && withPath.path.length > 0 ? withPath.path : undefined;
}

export default function PackMergePickModal({ onClose, onContinue, initialSources }: PackMergePickModalProps) {
  const toast = useToast();
  const [sources, setSources] = useState<MergeSource[]>(() =>
    initialSources?.length ? initialSources.map((s) => ({ ...s })) : []
  );
  const [isDraggingOnModal, setIsDraggingOnModal] = useState(false);

  const appendSourcesFromPaths = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setSources((prev) => {
      const existing = new Set(prev.map((s) => s.source_path.toLowerCase()));
      const next = [...prev];
      for (const path of paths) {
        if (existing.has(path.toLowerCase())) continue;
        existing.add(path.toLowerCase());
        const isZip = /\.zip$/i.test(path);
        next.push({
          index: next.length,
          name: path.split(/[/\\]/).pop()?.replace(/\.zip$/i, '') || 'Unknown',
          source_path: path,
          source_type: isZip ? 'Zip' : 'Folder',
          description: '',
          pack_format: 0,
          file_count: 0,
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      if (!alive) return;
      try {
        const fn = await getCurrentWebview().onDragDropEvent((ev) => {
          if (!alive) return;
          if (ev.payload.type === 'drop' && ev.payload.paths.length > 0) {
            appendSourcesFromPaths(ev.payload.paths);
          }
        });
        if (!alive) fn();
      } catch {}
    });
    return () => {
      alive = false;
    };
  }, [appendSourcesFromPaths]);

  const handleConverterDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOnModal(true);
  };

  const handleConverterDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleConverterDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    setIsDraggingOnModal(false);
  };

  const handleConverterDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOnModal(false);
      const paths = Array.from(e.dataTransfer.files).map(nativeFilePath).filter((p): p is string => Boolean(p));
      if (paths.length) {
        appendSourcesFromPaths(paths);
        return;
      }
      toast({ message: '未获取到本地路径，请使用下方按钮选择', type: 'warning' });
    },
    [appendSourcesFromPaths, toast]
  );

  const addZip = async () => {
    const path = await selectZipFile();
    if (path) appendSourcesFromPaths([path]);
  };

  const addFolder = async () => {
    const path = await selectFolder();
    if (path) appendSourcesFromPaths([path]);
  };

  const removeSource = (i: number) => setSources((p) => p.filter((_, idx) => idx !== i));

  const moveSource = (i: number, dir: 'up' | 'down') => {
    const ni = dir === 'up' ? i - 1 : i + 1;
    if (ni < 0 || ni >= sources.length) return;
    setSources((p) => {
      const n = [...p];
      [n[i], n[ni]] = [n[ni], n[i]];
      return n;
    });
  };

  const priorityLabel = (i: number) => (i === 0 ? '最高' : i === sources.length - 1 ? '最低' : `${sources.length - i}`);
  const getSourceColor = (i: number) => SOURCE_COLORS[i % SOURCE_COLORS.length];

  const handleContinue = () => {
    if (sources.length < 2) {
      toast({ message: '请至少添加 2 个资源包', type: 'warning' });
      return;
    }
    onContinue(sources);
  };

  return (
    <>
      <div className="overlay" onClick={onClose} role="presentation" />
      <div
        className="version-converter-modal merge-pick-modal"
        onDragEnter={handleConverterDragEnter}
        onDragOver={handleConverterDragOver}
        onDragLeave={handleConverterDragLeave}
        onDrop={handleConverterDrop}
      >
        {isDraggingOnModal && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <Icon name="folder" size={32} />
              <p>拖放 ZIP 或文件夹以添加（可多选）</p>
            </div>
          </div>
        )}

        <div className="modal-header">
          <h2>材质包融合</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={24} />
          </button>
        </div>

        <div className="modal-content">
          <div className="import-section">
            <p className="section-title">选择待融合的资源包</p>
            <p className="merge-pick-hint">至少添加 2 个 ZIP 或文件夹；列表越靠上优先级越高</p>
            <div className="import-buttons">
              <button type="button" className="import-btn" onClick={addZip}>
                <Icon name="zip" size={24} />
                <span>导入 ZIP 文件</span>
              </button>
              <button type="button" className="import-btn" onClick={addFolder}>
                <Icon name="folder" size={24} />
                <span>导入文件夹</span>
              </button>
            </div>
          </div>

          {sources.length > 0 && (
            <div className="merge-pick-list-block">
              <div className="merge-pick-list-label">已添加（{sources.length}）</div>
              <div className="sources-list">
                {sources.map((src, i) => (
                  <div key={`${src.source_path}-${i}`} className="source-card">
                    <div className="source-icon" style={{ background: `${getSourceColor(i)}22`, color: getSourceColor(i) }}>
                      {i + 1}
                    </div>
                    <div className="source-info">
                      <div className="source-name">{src.name}</div>
                      <div className="source-meta">
                        <span className={`tag ${src.source_type === 'Zip' ? 'zip' : 'folder'}`}>{src.source_type}</span>
                      </div>
                    </div>
                    <span className="priority-badge">{priorityLabel(i)}</span>
                    {i > 0 && (
                      <button type="button" className="remove-btn" onClick={() => moveSource(i, 'up')} title="上移" aria-label="上移">
                        <Icon name="chevron-up" size={14} />
                      </button>
                    )}
                    {i < sources.length - 1 && (
                      <button type="button" className="remove-btn" onClick={() => moveSource(i, 'down')} title="下移" aria-label="下移">
                        <Icon name="chevron-down" size={14} />
                      </button>
                    )}
                    <button type="button" className="remove-btn" onClick={() => removeSource(i)} title="移除" aria-label="移除">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="merge-pick-actions">
            <button type="button" className="merge-pick-secondary" onClick={onClose}>
              取消
            </button>
            <button type="button" className="merge-pick-primary" onClick={handleContinue} disabled={sources.length < 2}>
              下一步
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
