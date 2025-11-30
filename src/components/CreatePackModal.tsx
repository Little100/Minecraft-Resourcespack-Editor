import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createNewPack,
  selectFolder,
  getMinecraftVersions,
  downloadAndExtractTemplate,
  type VersionInfo,
} from "../utils/tauri-api";
import "./CreatePackModal.css";
import { FolderIcon, NewFolderIcon } from "./Icons";

interface DownloadProgress {
  task_id: string;
  status: string;
  current: number;
  total: number;
  current_file: string | null;
  speed: number;
  eta: number | null;
  error: string | null;
}

interface CreatePackModalProps {
  onClose: () => void;
  onSuccess: (packPath: string) => void;
  templateCacheEnabled: boolean;
}
const VERSION_OPTIONS = [
  { format: 4, label: "不包含 CustomModelData" },
  { format: 34, label: "包含 CustomModelData" },
];

export default function CreatePackModal({
  onClose,
  onSuccess,
  templateCacheEnabled,
}: CreatePackModalProps) {
  const [step, setStep] = useState(1);
  const [packName, setPackName] = useState("");
  const [packFormat, setPackFormat] = useState(34);
  const [description, setDescription] = useState("&7My Resource Pack");
  const [outputPath, setOutputPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 版本选择相关状态
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [versionFilter, setVersionFilter] = useState<"release" | "snapshot" | "all">("release");
  const [showLangFallbackDialog, setShowLangFallbackDialog] = useState(false);
  const [langFallbackInfo, setLangFallbackInfo] = useState<{ requestedVersion: string; usedVersion: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);

  // 颜色代码映射
  const COLOR_CODES = [
    { code: '0', name: '黑色', color: '#000000' },
    { code: '1', name: '深蓝', color: '#0000AA' },
    { code: '2', name: '深绿', color: '#00AA00' },
    { code: '3', name: '青色', color: '#00AAAA' },
    { code: '4', name: '深红', color: '#AA0000' },
    { code: '5', name: '紫色', color: '#AA00AA' },
    { code: '6', name: '金色', color: '#FFAA00' },
    { code: '7', name: '灰色', color: '#AAAAAA' },
    { code: '8', name: '深灰', color: '#555555' },
    { code: '9', name: '蓝色', color: '#5555FF' },
    { code: 'a', name: '绿色', color: '#55FF55' },
    { code: 'b', name: '天蓝', color: '#55FFFF' },
    { code: 'c', name: '红色', color: '#FF5555' },
    { code: 'd', name: '粉色', color: '#FF55FF' },
    { code: 'e', name: '黄色', color: '#FFFF55' },
    { code: 'f', name: '白色', color: '#FFFFFF' },
  ];

  const FORMAT_CODES = [
    { code: 'l', name: '粗体', style: 'bold' },
    { code: 'o', name: '斜体', style: 'italic' },
    { code: 'n', name: '下划线', style: 'underline' },
    { code: 'm', name: '删除线', style: 'strikethrough' },
    { code: 'r', name: '重置', style: 'reset' },
  ];

  // 监听下载进度
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<DownloadProgress>('download-progress', (event) => {
        const progress = event.payload;
        if (downloadTaskId && progress.task_id === downloadTaskId) {
          setDownloadProgress(progress);
          
          if (progress.status === 'completed') {
            setTimeout(() => {
              setDownloadProgress(null);
              setDownloadTaskId(null);
              setLoading(false);
              const fullPath = `${outputPath}/${packName}`;
              onSuccess(fullPath);
            }, 500);
          }
          
          // 下载失败显示错误
          if (progress.status === 'failed') {
            setTimeout(() => {
              setDownloadProgress(null);
              setDownloadTaskId(null);
              setLoading(false);
              const fullPath = `${outputPath}/${packName}`;
              setError(progress.error || '下载失败');
              setStep(2);
            }, 1000);
          }
        }
      });
    };

    if (step === 3 && downloadTaskId) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [step, downloadTaskId, onSuccess]);

  // 格式化文件大小
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}分${secs}秒`;
  };

  // 插入颜色代码
  const insertColorCode = (code: string) => {
    setDescription(description + `&${code}`);
  };

  // 替换字符
  const convertToMinecraftFormat = (text: string) => {
    return text.replace(/&/g, '§');
  };

  // 渲染预览文本
  const renderPreview = () => {
    const parts: React.ReactElement[] = [];
    let currentText = '';
    let currentColor = '#AAAAAA';
    let currentStyles: string[] = [];
    let key = 0;

    for (let i = 0; i < description.length; i++) {
      if (description[i] === '&' && i + 1 < description.length) {
        // 保存当前文本
        if (currentText) {
          parts.push(
            <span
              key={key++}
              style={{
                color: currentColor,
                fontWeight: currentStyles.includes('bold') ? 'bold' : 'normal',
                fontStyle: currentStyles.includes('italic') ? 'italic' : 'normal',
                textDecoration: [
                  currentStyles.includes('underline') ? 'underline' : '',
                  currentStyles.includes('strikethrough') ? 'line-through' : '',
                ].filter(Boolean).join(' ') || 'none',
              }}
            >
              {currentText}
            </span>
          );
          currentText = '';
        }

        const code = description[i + 1].toLowerCase();
        
        // 检查是否是颜色代码
        const colorCode = COLOR_CODES.find(c => c.code === code);
        if (colorCode) {
          currentColor = colorCode.color;
          i++;
          continue;
        }

        // 检查是否是格式代码
        const formatCode = FORMAT_CODES.find(f => f.code === code);
        if (formatCode) {
          if (formatCode.style === 'reset') {
            currentColor = '#AAAAAA';
            currentStyles = [];
          } else {
            if (!currentStyles.includes(formatCode.style)) {
              currentStyles.push(formatCode.style);
            }
          }
          i++;
          continue;
        }
      }
      
      currentText += description[i];
    }

    // 添加剩余文本
    if (currentText) {
      parts.push(
        <span
          key={key++}
          style={{
            color: currentColor,
            fontWeight: currentStyles.includes('bold') ? 'bold' : 'normal',
            fontStyle: currentStyles.includes('italic') ? 'italic' : 'normal',
            textDecoration: [
              currentStyles.includes('underline') ? 'underline' : '',
              currentStyles.includes('strikethrough') ? 'line-through' : '',
            ].filter(Boolean).join(' ') || 'none',
          }}
        >
          {currentText}
        </span>
      );
    }

    return parts.length > 0 ? parts : <span style={{ color: '#AAAAAA' }}>预览将在这里显示...</span>;
  };

  const handleSelectFolder = async () => {
    try {
      const folder = await selectFolder();
      if (folder) {
        setOutputPath(folder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreatePack = async () => {
    if (!packName || !outputPath) {
      setError("请填写所有必填字段");
      return;
    }
    
    const fullPath = `${outputPath}/${packName}`;

    try {
      setLoading(true);
      setError(null);

      const minecraftDescription = convertToMinecraftFormat(description);
      await createNewPack(fullPath, packName, packFormat, minecraftDescription);

      // 下载并提取模板
      if (selectedVersion) {
        setStep(3); // 显示进度
        const result = await downloadAndExtractTemplate(selectedVersion, fullPath, templateCacheEnabled);
        
        if (result && result.includes('|TASK_ID|')) {
          const parts = result.split('|TASK_ID|');
          const taskId = parts[1];
          
          setDownloadTaskId(taskId);
          return;
        }
      }

      onSuccess(fullPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 加载版本列表
  const loadVersions = async () => {
    try {
      setLoading(true);
      const manifest = await getMinecraftVersions();
      setVersions(manifest.versions);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 获取过滤后的版本列表
  const getFilteredVersions = () => {
    if (versionFilter === "all") return versions;
    return versions.filter((v) => v.type === versionFilter);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    // 防止按住移动导致的关闭
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={handleOverlayClick}>
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title">
            <NewFolderIcon className="modal-icon" />
            <h2>创建新材质包</h2>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="step-content">
              <div className="form-group">
                <label>材质包名称 *</label>
                <input
                  type="text"
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="my-resource-pack"
                />
              </div>

              <div className="form-group">
                <label>目标版本 *</label>
                <select
                  value={packFormat}
                  onChange={(e) => setPackFormat(Number(e.target.value))}
                >
                  {VERSION_OPTIONS.map((opt) => (
                    <option key={opt.format} value={opt.format}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>描述（支持颜色代码）</label>
                <div className="description-editor">
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="&7My awesome resource pack"
                    className="description-input"
                  />
                  <div className="color-picker">
                    <div className="color-picker-label">颜色:</div>
                    <div className="color-buttons">
                      {COLOR_CODES.map((color) => (
                        <button
                          key={color.code}
                          type="button"
                          className="color-btn"
                          style={{ backgroundColor: color.color }}
                          onClick={() => insertColorCode(color.code)}
                          title={`${color.name} (&${color.code})`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="color-picker">
                    <div className="color-picker-label">格式:</div>
                    <div className="format-buttons">
                      {FORMAT_CODES.map((format) => (
                        <button
                          key={format.code}
                          type="button"
                          className="format-btn"
                          onClick={() => insertColorCode(format.code)}
                          title={`${format.name} (&${format.code})`}
                        >
                          &{format.code}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="description-preview">
                    <div className="preview-label">预览:</div>
                    <div className="preview-text">{renderPreview()}</div>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>保存位置 *</label>
                <button onClick={handleSelectFolder} className="folder-select-btn">
                  <FolderIcon className="btn-icon-sm" />
                  {outputPath || "点击选择保存文件夹"}
                </button>
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="modal-actions">
                <button onClick={onClose} className="btn-sm">
                  取消
                </button>
                <button onClick={handleCreatePack} className="btn-sm btn-primary">
                  创建空材质包
                </button>
                <button
                  onClick={loadVersions}
                  className="btn-sm btn-primary"
                  disabled={!packName || !outputPath}
                >
                  使用原版模板并创建
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="step-content">
              <div className="version-header">
                <h3>选择Minecraft版本模板</h3>
                <div className="version-filter">
                  <button
                    className={`filter-btn ${versionFilter === "release" ? "active" : ""}`}
                    onClick={() => setVersionFilter("release")}
                  >
                    正式版
                  </button>
                  <button
                    className={`filter-btn ${versionFilter === "snapshot" ? "active" : ""}`}
                    onClick={() => setVersionFilter("snapshot")}
                  >
                    快照版
                  </button>
                  <button
                    className={`filter-btn ${versionFilter === "all" ? "active" : ""}`}
                    onClick={() => setVersionFilter("all")}
                  >
                    全部
                  </button>
                </div>
              </div>

              <div className="version-list">
                {getFilteredVersions().map((version) => (
                  <div
                    key={version.id}
                    className={`version-card ${
                      selectedVersion === version.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedVersion(version.id)}
                  >
                    <div className="version-checkbox">
                      {selectedVersion === version.id && "✓"}
                    </div>
                    <div className="version-info">
                      <div className="version-id">{version.id}</div>
                      <div className="version-type">{version.type}</div>
                      <div className="version-time">
                        {new Date(version.releaseTime).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="modal-actions">
                <button onClick={() => setStep(1)} className="btn-sm">
                  返回
                </button>
                <button
                  onClick={handleCreatePack}
                  className="btn-sm btn-primary"
                  disabled={loading || !selectedVersion}
                >
                  {loading ? "创建中..." : "创建并应用模板"}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="step-content">
              <div className="progress-info">
                <div className="spinner"></div>
                <h3>正在创建材质包...</h3>
                <p>正在下载并提取版本 {selectedVersion} 的资源文件</p>
                {templateCacheEnabled && (
                  <p className="cache-hint"> jar文件将被缓存以供下次使用</p>
                )}
                
                {/* 显示详细进度 */}
                {downloadProgress && (
                  <div className="download-progress-details">
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total * 100) : 0}%`
                        }}
                      />
                    </div>
                    <div className="progress-text">
                      <span className="progress-percentage">
                        {downloadProgress.total > 0
                          ? `${Math.round(downloadProgress.current / downloadProgress.total * 100)}%`
                          : '0%'}
                      </span>
                      <span className="progress-step">
                        步骤 {downloadProgress.current}/{downloadProgress.total}
                      </span>
                    </div>
                    {downloadProgress.current_file && (
                      <div className="current-file">
                         {downloadProgress.current_file}
                      </div>
                    )}
                    {downloadProgress.status === 'failed' && downloadProgress.error && (
                      <div className="error-message" style={{ marginTop: '1rem' }}>
                        {downloadProgress.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 语言文件回退提示对话框 */}
        {showLangFallbackDialog && langFallbackInfo && (
          <div className="lang-fallback-overlay">
            <div className="lang-fallback-dialog">
              <div className="lang-fallback-header">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3>语言文件提示</h3>
              </div>
              <div className="lang-fallback-content">
                <p>
                  <strong>未找到 {langFallbackInfo.requestedVersion} 的中文文件</strong>
                </p>
                <p>
                  已经切换到最新版 <strong>{langFallbackInfo.usedVersion}</strong> 进行映射
                </p>
              </div>
              <div className="lang-fallback-actions">
                <button
                  className="btn-sm btn-primary"
                  onClick={() => {
                      setShowLangFallbackDialog(false);
                      const fullPath = `${outputPath}/${packName}`;
                      onSuccess(fullPath);
                    }}
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}