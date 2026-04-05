import CreatePackModal from "./components/CreatePackModal";
import VersionConverterModal from "./components/VersionConverterModal";
import PackMergePickModal from "./components/PackMergePickModal";
import PackMergePage from "./components/PackMergePage";
import TitleBar from "./components/TitleBar";
import PackEditor from "./components/PackEditor";
import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import {
  importPackZip,
  importPackFolder,
  checkPackMcmeta,
  getCurrentPackInfo,
  selectZipFile,
  selectFolder,
  exportPack,
  cleanupTemp,
  startWebServer,
  stopWebServer,
  getServerStatus,
  getSystemFonts,
  openFolder,
} from "./utils/tauri-api";
import type { MergeSource, PackInfo, ResourceType } from "./types/pack";
import { VERSION_DESCRIPTIONS, RESOURCE_TYPE_NAMES } from "./types/pack";
import grassBlockImg from "./assets/grass-block.png";
import avatarImg from "./assets/ava.jpg";
import { open } from '@tauri-apps/plugin-shell';
import { checkForUpdates } from "./components/UpdateDialog";
import { UpdateDialogProvider } from "./components/UpdateDialog";
import { Icon, Button, ConfirmDialog, useToast } from "@mpe/ui";

import { DEFAULT_PORT, DEFAULT_MAX_HISTORY_COUNT } from './core/constants';
import { logger } from './utils/logger';

type Theme = "light" | "dark" | "system";
type WebService = "off" | "lan" | "all";

const loadSettings = () => {
  const savedTheme = localStorage.getItem('theme') as Theme | null;
  const savedFont = localStorage.getItem('fontFamily');
  const savedPort = localStorage.getItem('port');
  const savedAcrylic = localStorage.getItem('acrylicEffect');
  const savedHistoryEnabled = localStorage.getItem('historyEnabled');
  const savedMaxHistoryCount = localStorage.getItem('maxHistoryCount');
  const savedTemplateCacheEnabled = localStorage.getItem('templateCacheEnabled');
  const savedDebugMode = localStorage.getItem('debugMode');
  return {
    theme: savedTheme || 'system',
    fontFamily: savedFont || 'system',
    port: savedPort || DEFAULT_PORT,
    acrylicEffect: savedAcrylic === null ? true : savedAcrylic === 'true',
    historyEnabled: savedHistoryEnabled === null ? true : savedHistoryEnabled === 'true',
    maxHistoryCount: savedMaxHistoryCount ? parseInt(savedMaxHistoryCount) : DEFAULT_MAX_HISTORY_COUNT,
    templateCacheEnabled: savedTemplateCacheEnabled === 'true',
    debugMode: savedDebugMode === 'true',
  };
};

function App() {
  const toast = useToast();
  const [packInfo, setPackInfo] = useState<PackInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceType, setSelectedResourceType] = useState<ResourceType | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVersionConverter, setShowVersionConverter] = useState(false);
  const [mergePickOpen, setMergePickOpen] = useState(false);
  const [mergePickKey, setMergePickKey] = useState(0);
  const [mergePickSeed, setMergePickSeed] = useState<MergeSource[] | undefined>(undefined);
  const [mergeSessionSources, setMergeSessionSources] = useState<MergeSource[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const [isDraggingOnHomepage, setIsDraggingOnHomepage] = useState(false);
  const blockHomepagePackDropRef = useRef(false);
  blockHomepagePackDropRef.current =
    packInfo !== null ||
    showVersionConverter ||
    showCreateModal ||
    showConfirmDialog ||
    showSettings ||
    mergePickOpen ||
    mergeSessionSources !== null;

  const [settings] = useState(loadSettings);
  const [theme, setTheme] = useState<Theme>(settings.theme as Theme);
  const [fontFamily, setFontFamily] = useState<string>(settings.fontFamily);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [fontSearchQuery, setFontSearchQuery] = useState<string>("");
  const [acrylicEffect, setAcrylicEffect] = useState<boolean>(settings.acrylicEffect);
  const [webService, setWebService] = useState<WebService>("off");
  const [port, setPort] = useState<string>(settings.port);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverMessage, setServerMessage] = useState<string>("");
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(settings.historyEnabled);
  const [maxHistoryCount, setMaxHistoryCount] = useState<number>(settings.maxHistoryCount);
  const [templateCacheEnabled, setTemplateCacheEnabled] = useState<boolean>(settings.templateCacheEnabled);
  const [debugMode, setDebugMode] = useState<boolean>(settings.debugMode);
  const [editorPackStats, setEditorPackStats] = useState({ packSize: 0, historySize: 0 });

  const handlePackStatsChange = useCallback((packSize: number, historySize: number) => {
    setEditorPackStats({ packSize, historySize });
  }, []);

  useEffect(() => {
    if (!packInfo) {
      setEditorPackStats({ packSize: 0, historySize: 0 });
    }
  }, [packInfo]);

  useEffect(() => {
    const applyTheme = () => {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const newTheme = theme === "system" ? systemTheme : theme;
      document.documentElement.setAttribute("data-theme", newTheme);
    };

    applyTheme();
    localStorage.setItem('theme', theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  // 初始化时应用亚克力效果
  useEffect(() => {
    if (acrylicEffect) {
      document.body.classList.add('acrylic-enabled');
    } else {
      document.body.classList.remove('acrylic-enabled');
    }
  }, []);

  useEffect(() => {
    // 获取系统字体列表
    const loadSystemFonts = async () => {
      try {
        const fonts = await getSystemFonts();
        const fontList = ['系统默认', ...fonts];
        setAvailableFonts(fontList);
      } catch (error) {
        logger.error('Failed to load system fonts:', error);
        setAvailableFonts(['系统默认', 'Arial', 'Microsoft YaHei', 'SimSun']);
      }
    };
    
    loadSystemFonts();
  }, []);

  useEffect(() => {
    if (fontFamily === 'system' || fontFamily === '系统默认') {
      document.documentElement.style.fontFamily = '';
      document.body.style.fontFamily = '';
    } else {
      const fontString = `"${fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      document.documentElement.style.fontFamily = fontString;
      document.body.style.fontFamily = fontString;
    }
    localStorage.setItem('fontFamily', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('port', port);
  }, [port]);

  useEffect(() => {
    localStorage.setItem('acrylicEffect', String(acrylicEffect));
    if (acrylicEffect) {
      document.body.classList.add('acrylic-enabled');
    } else {
      document.body.classList.remove('acrylic-enabled');
    }
  }, [acrylicEffect]);

  useEffect(() => {
    localStorage.setItem('historyEnabled', String(historyEnabled));
  }, [historyEnabled]);

  useEffect(() => {
    localStorage.setItem('maxHistoryCount', String(maxHistoryCount));
  }, [maxHistoryCount]);

  useEffect(() => {
    localStorage.setItem('templateCacheEnabled', String(templateCacheEnabled));
  }, [templateCacheEnabled]);

  useEffect(() => {
    localStorage.setItem('debugMode', String(debugMode));
  }, [debugMode]);

  const notifyZipImportedAsFolder = useCallback(
    (info: PackInfo) => {
      if (!info.pack_path) return;
      const folderName = info.pack_path.split(/[/\\]/).pop() || info.name;
      toast({
        message: `已在 ZIP 同目录解压为文件夹「${folderName}」，编辑器正在使用该文件夹。`,
        type: 'info',
        duration: 6500,
        action: {
          label: '打开文件夹',
          onClick: () => openFolder(info.pack_path!),
        },
      });
    },
    [toast]
  );

  const handleImportZip = async () => {
    try {
      setError(null);
      const zipPath = await selectZipFile();
      if (!zipPath) return;

      setLoading(true);
      try {
        const info = await importPackZip(zipPath);
        setPackInfo(info);
        notifyZipImportedAsFolder(info);
      } finally {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleImportFolder = async () => {
    try {
      setError(null);
      const folderPath = await selectFolder();
      if (!folderPath) return;

      logger.debug('Selected folder:', folderPath);
      setLoading(true);
      try {
        const hasMcmeta = await checkPackMcmeta(folderPath);

        if (!hasMcmeta) {
          setPendingFolderPath(folderPath);
          setShowConfirmDialog(true);
        } else {
          const info = await importPackFolder(folderPath);
          logger.debug('Pack info:', info);
          setPackInfo(info);
        }
      } finally {
        setLoading(false);
      }
    } catch (err) {
      logger.error('Import folder error:', err);
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingFolderPath) return;
    
    try {
      setLoading(true);
      setShowConfirmDialog(false);
      const info = await importPackFolder(pendingFolderPath);
      logger.debug('Pack info:', info);
      setPackInfo(info);
      setPendingFolderPath(null);
    } catch (err) {
      logger.error('Import folder error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelImport = () => {
    setShowConfirmDialog(false);
    setPendingFolderPath(null);
  };

  const extractNativePath = (file: File): string | undefined => {
    const withPath = file as File & { path?: string };
    return typeof withPath.path === 'string' && withPath.path.length > 0
      ? withPath.path
      : undefined;
  };

  const handleHomepageDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    if (blockHomepagePackDropRef.current) return;
    e.preventDefault();
    setIsDraggingOnHomepage(true);
  };

  const handleHomepageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleHomepageDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    setIsDraggingOnHomepage(false);
  };

  const handleHomepageDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOnHomepage(false);
    if (blockHomepagePackDropRef.current) return;

    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = extractNativePath(file);
      if (p) paths.push(p);
    }

    if (paths.length === 0) {
      toast({ message: '未获取到本地路径，请使用「导入文件夹」或「导入 ZIP 文件」按钮选择', type: 'warning' });
      return;
    }

    const firstPath = paths[0];
    const isZip = /\.zip$/i.test(firstPath);

    try {
      setLoading(true);
      setError(null);

      if (isZip) {
        const info = await importPackZip(firstPath);
        setPackInfo(info);
        notifyZipImportedAsFolder(info);
      } else {
        const hasMcmeta = await checkPackMcmeta(firstPath);
        if (!hasMcmeta) {
          setPendingFolderPath(firstPath);
          setShowConfirmDialog(true);
          setLoading(false);
          return;
        }
        const info = await importPackFolder(firstPath);
        setPackInfo(info);
      }
    } catch (err) {
      logger.error('拖拽导入失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [notifyZipImportedAsFolder]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      if (!alive) return;
      try {
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          if (!alive) return;
          const p = event.payload;
          if (p.type === 'drop' && p.paths.length > 0) {
            if (blockHomepagePackDropRef.current) return;
            const firstPath = p.paths[0];
            const isZip = /\.zip$/i.test(firstPath);

            setLoading(true);
            setError(null);

            const doImport = async () => {
              try {
                if (isZip) {
                  const info = await importPackZip(firstPath);
                  setPackInfo(info);
                  notifyZipImportedAsFolder(info);
                } else {
                  const hasMcmeta = await checkPackMcmeta(firstPath);
                  if (!hasMcmeta) {
                    setPendingFolderPath(firstPath);
                    setShowConfirmDialog(true);
                    setLoading(false);
                    return;
                  }
                  const info = await importPackFolder(firstPath);
                  setPackInfo(info);
                }
              } catch (err) {
                logger.error('拖拽导入失败:', err);
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setLoading(false);
              }
            };

            doImport();
          }
        });
        if (alive) unlisten = fn;
        else fn();
      } catch {}
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [notifyZipImportedAsFolder]);

  const handleExport = async () => {
    try {
      setError(null);
      const outputPath = await selectFolder();
      if (!outputPath || !packInfo) return;

      setLoading(true);
      try {
        await exportPack(`${outputPath}/${packInfo.name}.zip`);
        toast({ message: '材质包导出成功!', type: 'success' });
      } finally {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const openLink = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      logger.error('Failed to open link:', error);
      window.open(url, '_blank');
    }
  };
  const serverRunningRef = useRef(serverRunning);
  serverRunningRef.current = serverRunning;

  useEffect(() => {
    const handleWebService = async () => {
      if (webService === 'off') {
        if (serverRunningRef.current) {
          try {
            const msg = await stopWebServer();
            setServerMessage(msg);
            setServerRunning(false);
          } catch (err) {
            logger.error('Failed to stop server:', err);
          }
        }
      } else {
        if (!serverRunningRef.current && packInfo) {
          try {
            const portNum = parseInt(port) || Number(DEFAULT_PORT);
            const msg = await startWebServer(portNum, webService);
            setServerMessage(msg);
            setServerRunning(true);
          } catch (err) {
            setServerMessage(err instanceof Error ? err.message : String(err));
            setWebService('off');
          }
        }
      }
    };

    handleWebService();
  }, [webService, port, packInfo]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getServerStatus();
        setServerRunning(status);
      } catch (err) {
        logger.error('Failed to check server status:', err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // 启动时检查更新
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await checkForUpdates();
      } catch (error) {
        logger.error('检查更新失败:', error);
      }
    };

    checkUpdate();
  }, []);

  if (mergeSessionSources !== null) {
    return (
      <div className="app-container">
        <TitleBar showStats={false} debugMode={debugMode} />
        <div className="app-editor-enter">
          <PackMergePage
            initialSources={mergeSessionSources}
            onClose={() => setMergeSessionSources(null)}
            onRepick={(sources) => {
              setMergeSessionSources(null);
              setMergePickSeed(sources.map((s) => ({ ...s })));
              setMergePickKey((k) => k + 1);
              setMergePickOpen(true);
            }}
            onMergeAgain={() => {
              setMergeSessionSources(null);
              setMergePickSeed(undefined);
              setMergePickKey((k) => k + 1);
              setMergePickOpen(true);
            }}
          />
        </div>
        <UpdateDialogProvider />
      </div>
    );
  }

  if (packInfo) {
    return (
      <div className="app-container">
        <TitleBar
          showStats
          packSize={editorPackStats.packSize}
          historySize={editorPackStats.historySize}
          debugMode={debugMode}
        />
        <div className="app-editor-enter">
          <PackEditor
            packInfo={packInfo}
            onClose={() => setPackInfo(null)}
            debugMode={debugMode}
            onPackStatsChange={handlePackStatsChange}
          />
        </div>
        <UpdateDialogProvider />
      </div>
    );
  }

  return (
    <div className="app-container">
      <TitleBar showStats={false} debugMode={debugMode} />
      {loading && (
        <div className="app-fullscreen-loading" aria-live="polite" aria-busy="true">
          <div className="app-fullscreen-loading__panel">
            <div className="app-fullscreen-loading__spinner" />
            <p className="app-fullscreen-loading__title">正在加载资源包</p>
            <p className="app-fullscreen-loading__hint">请稍候，大资源包可能需要几秒钟</p>
          </div>
        </div>
      )}
      <main
        className={`app-main${loading ? ' app-main--behind-loading' : ''}`}
        onDragEnter={handleHomepageDragEnter}
        onDragOver={handleHomepageDragOver}
        onDragLeave={handleHomepageDragLeave}
        onDrop={handleHomepageDrop}
      >
        {isDraggingOnHomepage && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <Icon name="folder" size={32} />
              <p>拖放文件夹或 ZIP 文件以导入资源包</p>
            </div>
          </div>
        )}

        <div className="hero-section">
          <div className="hero-logos">
            <div className="logo-item">
              <img src={grassBlockImg} alt="Minecraft" className="hero-logo" />
              <span className="logo-label">Minecraft</span>
            </div>
            <span className="logo-separator">x</span>
            <div className="logo-item">
              <img src={avatarImg} alt="Little_100" className="hero-logo" />
              <span className="logo-label">Little_100</span>
            </div>
          </div>
          <h1 className="hero-title">Resourcespack Editor</h1>
        </div>

        <div className="info-cards">
          <div className="info-card">
            <div className="card-icon"><Icon name="info" size={24} /></div>
            <h3>介绍</h3>
            <p>一个功能强大的 Minecraft 资源包编辑器，支持最新版本的材质包格式，让您轻松创建和编辑资源包。</p>
          </div>
          <div className="info-card">
            <div className="card-icon"><Icon name="layout" size={24} /></div>
            <h3>功能</h3>
            <p>支持导入、编辑、合并和导出资源包，提供直观的可视化界面，让资源包制作变得简单高效。</p>
          </div>
          <div className="info-card clickable" onClick={() => setShowSettings(true)}>
            <div className="card-icon"><Icon name="settings" size={24} /></div>
            <h3>设置</h3>
            <p>自定义主题、配置 Web 服务，以及访问社交媒体链接。点击此处打开设置面板。</p>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '1rem',
            margin: '1rem auto',
            maxWidth: '600px',
            background: 'var(--error-light)',
            color: 'var(--error)',
            borderRadius: '8px',
            border: '1px solid var(--error)'
          }}>
            <strong>错误:</strong> {error}
          </div>
        )}

        <div className="action-cards">
          <div className="action-card" onClick={handleImportFolder}>
            <div className="action-icon"><Icon name="folder" size={32} /></div>
            <h3>导入文件夹</h3>
            <p>从本地文件夹导入现有的资源包</p>
          </div>
          <div className="action-card" onClick={handleImportZip}>
            <div className="action-icon"><Icon name="zip" size={32} /></div>
            <h3>导入 ZIP 文件</h3>
            <p>从 ZIP 压缩包导入资源包</p>
          </div>
          <div className="action-card" onClick={() => setShowVersionConverter(true)}>
            <div className="action-icon"><Icon name="convert" size={32} /></div>
            <h3>转换版本</h3>
            <p>转换资源包到不同的游戏版本</p>
          </div>
          <div
            className="action-card"
            onClick={() => {
              setMergePickSeed(undefined);
              setMergePickKey((k) => k + 1);
              setMergePickOpen(true);
            }}
          >
            <div className="action-icon"><Icon name="merge" size={32} /></div>
            <h3>材质包融合</h3>
            <p>合并多个资源包，精细控制冲突文件</p>
          </div>
          <div className="action-card" onClick={() => setShowCreateModal(true)}>
            <div className="action-icon"><Icon name="create" size={32} /></div>
            <h3>从零开始创作</h3>
            <p>创建全新的资源包项目</p>
          </div>
        </div>

      </main>

      {/* Settings Sidebar */}
      <div className={`settings-sidebar ${showSettings ? 'open' : ''}`}>
        <div className="settings-header">
          <h2>设置</h2>
          <Button variant="icon" onClick={() => setShowSettings(false)}>
            <Icon name="close" size={24} />
          </Button>
        </div>
        
        <div className="settings-content">
          <div className="setting-group">
            <label>主题</label>
            <div className="setting-options">
              <button 
                className={`setting-option ${theme === 'system' ? 'active' : ''}`}
                onClick={() => setTheme('system')}
              >
                跟随系统
              </button>
              <button 
                className={`setting-option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <Icon name="sun" size={20} /> 亮色
              </button>
              <button 
                className={`setting-option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <Icon name="moon" size={20} /> 暗色
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label>窗口效果</label>
            <div className="setting-options">
              <button
                className={`setting-option ${acrylicEffect ? 'active' : ''}`}
                onClick={() => setAcrylicEffect(!acrylicEffect)}
              >
                {acrylicEffect ? '✓ ' : ''}亚克力效果
              </button>
            </div>
            <p className="setting-hint">
              {acrylicEffect ? '窗口将使用半透明亚克力效果' : '窗口将使用标准不透明背景'}
            </p>
          </div>

          <div className="setting-group">
            <label>编辑历史记录</label>
            <div className="setting-options">
              <button
                className={`setting-option ${historyEnabled ? 'active' : ''}`}
                onClick={() => setHistoryEnabled(!historyEnabled)}
              >
                {historyEnabled ? '✓ 已启用 ' : '已禁用'}
              </button>
            </div>
            <p className="setting-hint">
              {historyEnabled ? '编辑历史将被保存，支持冷重启后恢复' : '编辑历史将不会被保存'}
              {historyEnabled && ' ️ 可能会占用较多磁盘空间'}
            </p>
            
            {historyEnabled && (
              <div className="history-count-setting">
                <label>每个文件保留历史记录数量: {maxHistoryCount}</label>
                <input
                  type="range"
                  min="10"
                  max="50"
                  value={maxHistoryCount}
                  onChange={(e) => setMaxHistoryCount(parseInt(e.target.value))}
                  className="history-slider"
                />
                <div className="range-labels">
                  <span>10</span>
                  <span>30</span>
                  <span>50</span>
                </div>
              </div>
            )}
          </div>

          <div className="setting-group">
            <label>模板缓存</label>
            <div className="setting-options">
              <button
                className={`setting-option ${templateCacheEnabled ? 'active' : ''}`}
                onClick={() => setTemplateCacheEnabled(!templateCacheEnabled)}
              >
                {templateCacheEnabled ? '✓ 已启用 ' : '已禁用'}
              </button>
            </div>
            <p className="setting-hint">
              {templateCacheEnabled
                ? '下载的Minecraft版本jar文件将被保留在temp目录中，下次使用相同版本时无需重新下载'
                : '下载的jar文件将在使用后自动删除，每次都需要重新下载'}
            </p>
          </div>

          <div className="setting-group">
            <label>调试模式</label>
            <div className="setting-options">
              <button
                className={`setting-option ${debugMode ? 'active' : ''}`}
                onClick={() => setDebugMode(!debugMode)}
              >
                {debugMode ? '✓ 已启用 ' : '已禁用'}
              </button>
            </div>
            <p className="setting-hint">
              {debugMode ? '标题栏将显示调试按钮，可以查看后台日志和系统信息' : '调试功能已关闭'}
            </p>
          </div>

          <div className="setting-group">
            <label>字体</label>
            <input
              type="text"
              className="font-search"
              placeholder="搜索字体..."
              value={fontSearchQuery}
              onChange={(e) => setFontSearchQuery(e.target.value)}
            />
            <select
              className="font-select"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
            >
              {availableFonts
                .filter((font) =>
                  font.toLowerCase().includes(fontSearchQuery.toLowerCase())
                )
                .map((font) => (
                  <option
                    key={font}
                    value={font === '系统默认' ? 'system' : font}
                    style={{ fontFamily: font === '系统默认' ? 'inherit' : `"${font}", sans-serif` }}
                  >
                    {font}
                  </option>
                ))}
            </select>
            {fontFamily !== 'system' && fontFamily !== '系统默认' && (
              <div className="font-preview">
                <p style={{ fontFamily: `"${fontFamily}", sans-serif` }}>
                  预览文本 Preview Text 1234567890
                </p>
              </div>
            )}
          </div>

          <div className="setting-group">
            <label>开放 Web 服务</label>
            <div className="setting-options">
              <button
                className={`setting-option ${webService === 'off' ? 'active' : ''}`}
                onClick={() => setWebService('off')}
              >
                关闭
              </button>
              <button
                className={`setting-option ${webService === 'lan' ? 'active' : ''}`}
                onClick={() => setWebService('lan')}
              >
                仅局域网
              </button>
              <button
                className={`setting-option ${webService === 'all' ? 'active' : ''}`}
                onClick={() => setWebService('all')}
              >
                全部
              </button>
            </div>
            
            {webService !== 'off' && (
              <>
                <div className="port-setting">
                  <label>端口号</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="3000"
                    className="port-input"
                    min="1"
                    max="65535"
                  />
                </div>
                <div className="service-hint">
                  {serverRunning ? (
                    <>
                      <p> 服务器运行中</p>
                      <p className="hint-text">
                        访问地址：<strong>http://localhost:{port}</strong>
                      </p>
                      {webService === 'lan' && (
                        <p className="hint-text">局域网内其他设备可通过您的本机IP访问</p>
                      )}
                      {webService === 'all' && (
                        <p className="hint-text">所有网络可访问（请注意安全）</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>提示：服务将在端口 <strong>{port}</strong> 上运行</p>
                      <p className="hint-text">
                        {webService === 'lan' ? '局域网内其他设备可通过您的本机IP访问' : '所有网络可访问（请注意安全）'}
                      </p>
                      {!packInfo && (
                        <p className="hint-text" style={{color: 'var(--text-tertiary)'}}>
                          请先导入资源包才能启动服务器
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="social-cards">
            <div className="social-card" onClick={() => openLink('https://space.bilibili.com/1492647738')}>
              <Icon name="bilibili" size={24} filled />
              <span>Bilibili 页面</span>
            </div>
            <div className="social-card" onClick={() => openLink('https://github.com/little100')}>
              <Icon name="github-fill" size={24} filled />
              <span>Github 页面</span>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay */}
      {showSettings && <div className="overlay" onClick={() => setShowSettings(false)}></div>}

      {showCreateModal && (
        <CreatePackModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={async (packPath) => {
            setShowCreateModal(false);
            try {
              setLoading(true);
              const info = await importPackFolder(packPath);
              setPackInfo(info);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setLoading(false);
            }
          }}
          templateCacheEnabled={templateCacheEnabled}
        />
      )}

      {showVersionConverter && (
        <VersionConverterModal
          onClose={() => setShowVersionConverter(false)}
        />
      )}

      {mergePickOpen && (
        <PackMergePickModal
          key={mergePickKey}
          initialSources={mergePickSeed}
          onClose={() => {
            setMergePickOpen(false);
            setMergePickSeed(undefined);
          }}
          onContinue={(sources) => {
            setMergePickOpen(false);
            setMergePickSeed(undefined);
            setMergeSessionSources(sources.map((s) => ({ ...s })));
          }}
        />
      )}

      {/* 确认导入对话框 */}
      <ConfirmDialog
        open={showConfirmDialog}
        title="缺少 pack.mcmeta 文件"
        message="所选文件夹中未找到 pack.mcmeta 文件。这可能不是一个有效的Minecraft资源包文件夹。是否仍要导入此文件夹？"
        variant="warning"
        confirmText="确定导入"
        cancelText="取消"
        onConfirm={handleConfirmImport}
        onCancel={handleCancelImport}
      />
      <UpdateDialogProvider />
    </div>
  );
}

export default App;
