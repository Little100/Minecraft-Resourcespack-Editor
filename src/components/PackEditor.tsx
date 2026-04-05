import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./PackEditor.css";
import type { PackInfo } from "../types/pack";
import TextEditor from "./TextEditor";
import ImageViewer from "./ImageViewer";
import PackMetaEditor from "./PackMetaEditor";
import PngCreatorDialog from "./PngCreatorDialog";
import SearchModal from "./SearchModal";
import DownloadIndicator from "./DownloadIndicator";
import DownloadDetails from "./DownloadDetails";
import DownloadSettingsDialog from "./DownloadSettingsDialog";
import { readFileContent, writeFileContent, searchFiles, type SearchResponse } from "../utils/tauri-api";
import { Icon, Button, ConfirmDialog, Dialog, DialogBody, DialogFooter, useToast } from "@mpe/ui";
import { logger } from "../utils/logger";

import brushIcon from "../assets/brush.svg";
import pencilIcon from "../assets/pencil.svg";
import eraserIcon from "../assets/eraser.svg";
import moveIcon from "../assets/move.svg";
import penToolIcon from "../assets/pen-tool.svg";
import coloizeIcon from "../assets/coloize.svg";

// 音频播放器组件
interface AudioPlayerProps {
  filePath: string;
  fileName: string;
  extension: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ filePath, fileName, extension }) => {
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioError, setAudioError] = useState<string | null>(null);
  
  useEffect(() => {
    let blobUrl: string | null = null;
    
    const loadAudio = async () => {
      try {
        const packDir = await invoke<string>('get_current_pack_path');
        const fullPath = `${packDir}/${filePath}`;
        
        // 检查文件是否存在
        const exists = await invoke<boolean>('check_file_exists', { filePath: fullPath });
        if (!exists) {
          setAudioError('音频文件不存在');
          return;
        }
        
        const base64Content = await invoke<string>('read_file_as_base64', { filePath: fullPath });
        
        const byteCharacters = atob(base64Content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: `audio/${extension}` });
        
        blobUrl = URL.createObjectURL(blob);
        setAudioUrl(blobUrl);
        setAudioError(null);
      } catch (error) {
        logger.error('加载音频失败:', error);
        setAudioError('加载音频失败');
      }
    };
    
    loadAudio();
    
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [filePath, extension]);
  
  return (
    <div className="audio-file-viewer">
      <div className="audio-header">
        <Icon name="volume" size={24} style={{ width: 64, height: 64 }} />
        <h3>{fileName}</h3>
        <p className="file-path">{filePath}</p>
      </div>
      <div className="audio-player-container">
        {audioError ? (
          <div style={{ color: 'var(--error-color)', textAlign: 'center' }}>
            ⚠️ {audioError}
          </div>
        ) : audioUrl ? (
          <audio controls style={{ width: '100%', maxWidth: '600px' }} key={audioUrl}>
            <source src={audioUrl} type={`audio/${extension}`} />
            您的浏览器不支持音频播放
          </audio>
        ) : (
          <div style={{ textAlign: 'center' }}>加载中...</div>
        )}
      </div>
    </div>
  );
};

interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileTreeNode[];
  file_count?: number;
  loaded?: boolean;
}

interface PackEditorProps {
  packInfo: PackInfo;
  onClose: () => void;
  debugMode?: boolean;
  onPackStatsChange?: (packSize: number, historySize: number) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  path: string;
  type: 'file' | 'folder';
}

interface OpenTab {
  path: string;
  content: string;
  isDirty: boolean;
  canvasData?: string;
  forceTextMode?: boolean;
  initialLine?: number;
}

interface ImageInfo {
  width: number;
  height: number;
}

export default function PackEditor({
  packInfo,
  onClose,
  debugMode = false,
  onPackStatsChange,
}: PackEditorProps) {
  const toast = useToast();
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([""]));
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [contextMenuPath, setContextMenuPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(280);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [toolbarWidth, setToolbarWidth] = useState<number>(240);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const [isResizingToolbar, setIsResizingToolbar] = useState<boolean>(false);
  const [resizeIndicator, setResizeIndicator] = useState<string>("");
  const [showPngCreator, setShowPngCreator] = useState<boolean>(false);
  const [pngCreatorFolder, setPngCreatorFolder] = useState<string>("");
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [selectedColor, setSelectedColor] = useState({ r: 0, g: 0, b: 0, a: 100 });
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [currentFileHasChanges, setCurrentFileHasChanges] = useState(false);
  const [toolSize, setToolSize] = useState(5);
  const [showToolSizeMenu, setShowToolSizeMenu] = useState(false);
  const [toolSizeMenuPos, setToolSizeMenuPos] = useState({ x: 0, y: 0 });
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);
  const [historyStats, setHistoryStats] = useState<{ totalSize: number; fileCount: number } | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [languageMap, setLanguageMap] = useState<Record<string, string>>({});
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [soundsJsonExists, setSoundsJsonExists] = useState<boolean>(false);
  const [showDownloadDetails, setShowDownloadDetails] = useState<boolean>(false);
  const [showDownloadSettings, setShowDownloadSettings] = useState<boolean>(false);
  const [confirmDialogState, setConfirmDialogState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant?: 'info' | 'warning' | 'danger';
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [inputDialogState, setInputDialogState] = useState<{
    open: boolean;
    title: string;
    placeholder: string;
    value: string;
    onSubmit: (value: string) => void;
  }>({ open: false, title: '', placeholder: '', value: '', onSubmit: () => {} });
  const fileTreeRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolSizeMenuRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const loadingFolders = useRef<Set<string>>(new Set());
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  const expandedFoldersRef = useRef(expandedFolders);
  expandedFoldersRef.current = expandedFolders;
  const selectedFileRef = useRef<string | null>(null);
  const renamingPathRef = useRef(renamingPath);
  renamingPathRef.current = renamingPath;
  const contextMenuPathRef = useRef(contextMenuPath);
  contextMenuPathRef.current = contextMenuPath;
  const renameValueRef = useRef(renameValue);
  renameValueRef.current = renameValue;

  const selectedFile = activeTabIndex >= 0 ? openTabs[activeTabIndex]?.path : null;
  selectedFileRef.current = selectedFile;
  const fileContent = activeTabIndex >= 0 ? openTabs[activeTabIndex]?.content : "";

  const getFileExtension = (filePath: string): string => {
    return filePath.split('.').pop()?.toLowerCase() || '';
  };

  // 后缀翻译映射表
  const suffixTranslations: Record<string, string> = {
    // 开关状态
    'on': '开',
    'off': '关',
    // 方向
    'top': '上',
    'bottom': '下',
    'side': '边',
    'front': '前',
    'back': '后',
    'left': '左',
    'right': '右',
    'north': '北',
    'south': '南',
    'east': '东',
    'west': '西',
    'up': '上',
    'down': '下',
    // 状态
    'lit': '点亮',
    'tip': '尖',
    'base': '底部',
    'stage': '阶段',
    'age': '生长',
    'powered': '充能',
    'unpowered': '未充能',
  };

  // 将文件路径转换为映射键并提取后缀信息
  const pathToMapKey = (filePath: string): string | null => {
    // 移除文件扩展名
    const pathWithoutExt = filePath.replace(/\.[^/.]+$/, '');

    // 匹配新版本路径（block/item）
    const blockMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/block\/(.+)/);
    if (blockMatch) {
      return `block.minecraft.${blockMatch[1].replace(/\//g, '.')}`;
    }

    const itemMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/item\/(.+)/);
    if (itemMatch) {
      return `item.minecraft.${itemMatch[1].replace(/\//g, '.')}`;
    }

    // 匹配旧版本路径
    const blocksMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/blocks\/(.+)/);
    if (blocksMatch) {
      return `block.minecraft.${blocksMatch[1].replace(/\//g, '.')}`;
    }

    const itemsMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/items\/(.+)/);
    if (itemsMatch) {
      return `item.minecraft.${itemsMatch[1].replace(/\//g, '.')}`;
    }

    return null;
  };

  const translateFileName = useCallback((fileName: string, filePath: string): string => {
    // 检查缓存
    if (translationCache[filePath]) {
      return translationCache[filePath];
    }

    const mapKey = pathToMapKey(filePath);
    if (!mapKey) return fileName;

    // 移除扩展名
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    const ext = fileName.substring(nameWithoutExt.length);

    // 尝试直接匹配完整的映射键
    if (languageMap[mapKey]) {
      return languageMap[mapKey];
    }

    // 尝试分离后缀并翻译
    const parts = nameWithoutExt.split('_');

    // 从后往前检查后缀
    const suffixes: string[] = [];
    let baseParts = [...parts];

    // 检查最后几个部分是否是已知后缀或数字
    for (let i = parts.length - 1; i > 0; i--) {
      const part = parts[i];

      if (/^\d+$/.test(part)) {
        suffixes.unshift(part);
        baseParts = parts.slice(0, i);
      }
      else if (suffixTranslations[part]) {
        suffixes.unshift(suffixTranslations[part]);
        baseParts = parts.slice(0, i);
      }
      else {
        break;
      }
    }

    // 构建基础映射键
    const baseName = baseParts.join('_');
    const baseKey = mapKey.replace(nameWithoutExt, baseName);

    // 查找基础翻译
    if (languageMap[baseKey]) {
      const baseTranslation = languageMap[baseKey];

      if (suffixes.length > 0) {
        return `${baseTranslation}_${suffixes.join('_')}`;
      }

      return baseTranslation;
    }

    return fileName;
  }, [languageMap, translationCache]);

  // 获取文件的显示名称
  const getDisplayName = useCallback((fileName: string, filePath: string): string => {
    if (language === 'zh') {
      // 直接从缓存获取翻译
      const translated = translationCache[filePath];

      if (debugMode && filePath.includes('bamboo')) {
        logger.debug('[翻译调试]', {
          fileName,
          filePath,
          translated,
          cacheSize: Object.keys(translationCache).length,
          hasCacheEntry: filePath in translationCache
        });
      }

      if (translated) {
        return `${translated} (${fileName})`;
      }
    }
    return fileName;
  }, [language, translationCache, debugMode]);

  const isPngFile = selectedFile ? getFileExtension(selectedFile) === 'png' : false;

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const updateSizeStats = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const pSize = await invoke<number>('get_pack_size', { packDir });
      const stats = await invoke<any>('get_history_stats', { packDir });
      onPackStatsChange?.(pSize, stats.total_size || 0);
    } catch (error) {
      logger.error('获取大小统计失败:', error);
      onPackStatsChange?.(0, 0);
    }
  };

  const precomputeTranslations = useCallback((node: FileTreeNode, path: string = '', isRoot: boolean = false): Record<string, string> => {
    const cache: Record<string, string> = {};

    const currentPath = isRoot ? '' : (path ? `${path}/${node.name}` : node.name);

    if (!node.is_dir) {
      const mapKey = pathToMapKey(currentPath);
      if (mapKey) {
        // 移除扩展名
        const nameWithoutExt = node.name.replace(/\.[^/.]+$/, '');

        // 尝试直接匹配完整的映射键
        let translation = languageMap[mapKey];

        // 如果是 item 路径且没找到翻译尝试用 block 路径
        if (!translation && mapKey.startsWith('item.minecraft.')) {
          const blockKey = mapKey.replace('item.minecraft.', 'block.minecraft.');
          translation = languageMap[blockKey];
        }

        if (translation) {
          cache[currentPath] = translation;
        } else {
          // 尝试分离后缀并翻译
          const parts = nameWithoutExt.split('_');

          // 从后往前检查后缀
          const suffixes: string[] = [];
          let baseParts = [...parts];

          // 检查最后几个部分是否是已知后缀或数字
          for (let i = parts.length - 1; i > 0; i--) {
            const part = parts[i];

            if (/^\d+$/.test(part)) {
              suffixes.unshift(part);
              baseParts = parts.slice(0, i);
            }
            else if (suffixTranslations[part]) {
              suffixes.unshift(suffixTranslations[part]);
              baseParts = parts.slice(0, i);
            }
            else {
              break;
            }
          }

          // 构建基础映射键
          const baseName = baseParts.join('_');
          const baseKey = mapKey.replace(nameWithoutExt, baseName);

          // 查找基础翻译
          let baseTranslation = languageMap[baseKey];

          // 如果是 item 路径且没找到翻译尝试用 block 路径
          if (!baseTranslation && baseKey.startsWith('item.minecraft.')) {
            const blockBaseKey = baseKey.replace('item.minecraft.', 'block.minecraft.');
            baseTranslation = languageMap[blockBaseKey];
          }

          if (baseTranslation) {
            if (suffixes.length > 0) {
              cache[currentPath] = `${baseTranslation}_${suffixes.join('_')}`;
            } else {
              cache[currentPath] = baseTranslation;
            }
          }
        }
      }
    }

    // 递归处理子节点
    if (node.children) {
      node.children.forEach(child => {
        const childCache = precomputeTranslations(child, currentPath, false);
        Object.assign(cache, childCache);
      });
    }

    return cache;
  }, [languageMap]);

  // 加载语言映射表
  useEffect(() => {
    const loadMap = async () => {
      try {
        const map = await invoke<Record<string, string>>('load_language_map');
        setLanguageMap(map);
        logger.debug('[语言映射] 映射表加载完成，条目数:', Object.keys(map).length);
      } catch (error) {
        logger.error('[语言映射] 加载映射表失败:', error);
        setLanguageMap({});
      }
    };

    loadMap();
  }, []);

  useEffect(() => {
    if (fileTree && Object.keys(languageMap).length > 0) {
      logger.debug('[语言映射] 开始预计算翻译缓存...');
      const startTime = performance.now();

      const cache = precomputeTranslations(fileTree, '', true);
      setTranslationCache(cache);

      const duration = (performance.now() - startTime).toFixed(2);
      logger.debug(`[语言映射] 翻译缓存完成！耗时: ${duration}ms, 缓存条目: ${Object.keys(cache).length}`);

      // 调试
      const sampleKeys = Object.keys(cache).slice(0, 5);
      logger.debug('[语言映射] 缓存示例键:', sampleKeys);
    }
  }, [fileTree, languageMap]);

  useEffect(() => {
    const loadFileTree = async () => {
      logger.debug('[性能] 开始加载文件树...');
      const startTime = performance.now();

      try {
        const tree = await invoke<FileTreeNode>('get_file_tree');
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        logger.debug(`[性能]  文件树加载完成! 耗时: ${duration}ms`);
        logger.debug(`[性能] 文件树根节点:`, tree);

        setFileTree(tree);

        // 启动积极预加载整个资源包
        setIsPreloading(true);
        invoke('preload_folder_aggressive', { folderPath: '' })
          .then((count: any) => {
            logger.debug(`[性能-积极预加载]  完成! 预加载了 ${count} 个文件`);
            setIsPreloading(false);
          })
          .catch((err: any) => {
            logger.error('[性能-积极预加载]  失败:', err);
            setIsPreloading(false);
          });
      } catch (error) {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        logger.error(`[性能]  加载文件树失败! 耗时: ${duration}ms`, error);
        toast({ message: `加载文件树失败: ${error}`, type: 'error' });
      }
    };

    loadFileTree();
    updateSizeStats();

    // 每30秒更新一次大小统计
    const interval = setInterval(updateSizeStats, 30000);

    // 清理缓存
    return () => {
      clearInterval(interval);
      invoke('clear_preloader_cache')
        .then(() => logger.debug('[性能] 预加载缓存已清理'))
        .catch((err: any) => logger.error('[性能] 清理缓存失败:', err));
    };
  }, [onPackStatsChange]);

  // 关闭右键菜单和工具大小菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
        setContextMenuPath(null);
      }
      if (toolSizeMenuRef.current && !toolSizeMenuRef.current.contains(event.target as Node)) {
        setShowToolSizeMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 标签栏滚轮横向滚动
  useEffect(() => {
    const tabsContainer = tabsContainerRef.current;
    if (!tabsContainer) return;

    const handleWheel = (e: WheelEvent) => {
      // 阻止默认的垂直滚动
      e.preventDefault();
      // 将垂直滚动转换为横向滚动
      tabsContainer.scrollLeft += e.deltaY;
    };

    tabsContainer.addEventListener('wheel', handleWheel, { passive: false });
    return () => tabsContainer.removeEventListener('wheel', handleWheel);
  }, []);

  // 处理侧边栏和工具栏拖动调整大小
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = e.clientX;
        if (newWidth >= 200 && newWidth <= 500) {
          setSidebarWidth(newWidth);
          setResizeIndicator(`${newWidth}px`);
        }
      } else if (isResizingToolbar) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 200 && newWidth <= 400) {
          setToolbarWidth(newWidth);
          setResizeIndicator(`${newWidth}px`);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingToolbar(false);
      setResizeIndicator("");
    };

    if (isResizingSidebar || isResizingToolbar) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar, isResizingToolbar]);

  // 使用useCallback优化文件加载函数
  const loadFileContent = useCallback(async (filePath: string) => {
    setIsLoading(true);
    try {
      const extension = filePath.split('.').pop()?.toLowerCase();
      let content = '';
      if (['mcmeta', 'json', 'txt', 'md', 'yml', 'yaml', 'lang'].includes(extension || '')) {
        content = await readFileContent(filePath);
      }

      return content;
    } catch (error) {
      logger.error('加载文件失败:', error);
      toast({ message: `加载文件失败: ${error}`, type: 'error' });
      return '';
    } finally {
      setIsLoading(false);
    }
  }, []);
  const openFileInTab = useCallback(async (filePath: string, forceTextMode: boolean = false, lineNumber?: number) => {
    logger.debug(`[性能-打开文件]  开始: ${filePath}${lineNumber ? ` (行号: ${lineNumber})` : ''}`);
    const startTime = performance.now();

    // F-BUG-10: 使用函数式更新，避免闭包捕获过期的 openTabs
    let existingTabIndex = -1;
    
    setOpenTabs(prevTabs => {
      existingTabIndex = prevTabs.findIndex(tab => tab.path === filePath);
      return prevTabs; // 先只查找，不修改
    });

    // 需要在 setState 回调外处理异步逻辑
    // 使用 ref 来获取最新的 openTabs
    const currentTabs = openTabsRef.current;
    existingTabIndex = currentTabs.findIndex(tab => tab.path === filePath);

    if (existingTabIndex >= 0) {
      const duration = (performance.now() - startTime).toFixed(2);
      logger.debug(`[性能-打开文件]  切换到已打开的标签! 耗时: ${duration}ms`);

      let contentToLoad: string | undefined;
      const existingTab = currentTabs[existingTabIndex];

      if (forceTextMode && !existingTab.forceTextMode && !existingTab.content) {
        try {
          contentToLoad = await readFileContent(filePath);
        } catch (error) {
          logger.error('加载文件内容失败:', error);
        }
      }

      setOpenTabs(prevTabs => {
        const newTabs = [...prevTabs];
        const idx = newTabs.findIndex(tab => tab.path === filePath);
        if (idx < 0) return prevTabs;
        
        let needsUpdate = false;
        if (forceTextMode && !newTabs[idx].forceTextMode) {
          newTabs[idx] = { ...newTabs[idx], forceTextMode: true };
          if (contentToLoad) newTabs[idx].content = contentToLoad;
          needsUpdate = true;
        }
        if (lineNumber !== undefined) {
          newTabs[idx] = { ...newTabs[idx], initialLine: lineNumber };
          needsUpdate = true;
        }
        return needsUpdate ? newTabs : prevTabs;
      });

      setActiveTabIndex(existingTabIndex);
      setCurrentFileHasChanges(false);
      return;
    }

    // 检查是否是图片
    const ext = filePath.split('.').pop()?.toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '');

    logger.debug(`[性能-打开文件] 文件类型: ${isImage ? '图片' : '文本'}, 强制文本模式: ${forceTextMode}`);

    let content = '';
    if (!isImage || forceTextMode) {
      const loadStart = performance.now();
      try {
        content = await readFileContent(filePath);
      } catch (error) {
        logger.error('加载文件内容失败:', error);
        content = '';
      }
      const loadDuration = (performance.now() - loadStart).toFixed(2);
      logger.debug(`[性能-打开文件]   ├─ 文本内容加载耗时: ${loadDuration}ms`);
    }

    const duration = (performance.now() - startTime).toFixed(2);
    logger.debug(`[性能-打开文件]  完成! 总耗时: ${duration}ms`);

    const newTab: OpenTab = {
      path: filePath,
      content: content,
      isDirty: false,
      forceTextMode: forceTextMode,
      initialLine: lineNumber,
    };

    setOpenTabs(prevTabs => {
      setActiveTabIndex(prevTabs.length);
      return [...prevTabs, newTab];
    });
    setCurrentFileHasChanges(false);

    if (!isImage || forceTextMode) {
      setImageInfo(null);
    }
  }, [loadFileContent]);

  const doCloseTab = (index: number) => {
    const newTabs = openTabs.filter((_, i) => i !== index);
    setOpenTabs(newTabs);

    if (index === activeTabIndex) {
      setCurrentFileHasChanges(false);
    }

    if (activeTabIndex === index) {
      setActiveTabIndex(index > 0 ? index - 1 : (newTabs.length > 0 ? 0 : -1));
    } else if (activeTabIndex > index) {
      setActiveTabIndex(activeTabIndex - 1);
    }
  };

  const closeTab = (index: number, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    const tab = openTabs[index];

    const isPng = tab.path.split('.').pop()?.toLowerCase() === 'png';
    const hasUnsavedChanges = (index === activeTabIndex && currentFileHasChanges) || tab.isDirty;

    if (hasUnsavedChanges) {
      setConfirmDialogState({
        open: true,
        title: '未保存的更改',
        message: `${tab.path.split('/').pop()} 有未保存的更改，确定要关闭吗？`,
        variant: 'warning',
        onConfirm: () => {
          setConfirmDialogState(prev => ({ ...prev, open: false }));
          doCloseTab(index);
        },
      });
      return;
    }

    doCloseTab(index);
  };

  const updateTabContent = (content: string) => {
    if (activeTabIndex >= 0) {
      const newTabs = [...openTabs];
      newTabs[activeTabIndex] = {
        ...newTabs[activeTabIndex],
        content: content,
        isDirty: true,
      };
      setOpenTabs(newTabs);
    }
  };

  const markTabAsSaved = () => {
    if (activeTabIndex >= 0) {
      const newTabs = [...openTabs];
      newTabs[activeTabIndex] = {
        ...newTabs[activeTabIndex],
        isDirty: false,
      };
      setOpenTabs(newTabs);
    }
  };

  const handleFileSave = async (content: string) => {
    if (!selectedFile || activeTabIndex < 0) return;

    try {
      await writeFileContent(selectedFile, content);

      const newTabs = [...openTabs];
      newTabs[activeTabIndex] = {
        ...newTabs[activeTabIndex],
        content: content,
        isDirty: false,
      };
      setOpenTabs(newTabs);
    } catch (error) {
      logger.error('保存文件失败:', error);
      toast({ message: `保存文件失败: ${error}`, type: 'error' });
    }
  };

  const rgbToHex = (r: number, g: number, b: number): string => {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
  };

  const hexToRgb = (hex: string): { r: number, g: number, b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const updateColor = (updates: Partial<typeof selectedColor>) => {
    setSelectedColor(prev => ({ ...prev, ...updates }));
  };

  const handleHexChange = (hex: string) => {
    if (hex === '' || hex === '#') {
      return;
    }

    const cleanHex = hex.replace(/[^0-9A-Fa-f#]/g, '');
    if (cleanHex.length <= 7) {
      const rgb = hexToRgb(cleanHex);
      if (rgb) {
        setSelectedColor(prev => ({ ...prev, ...rgb }));
      }
    }
  };

  const handleHexBlur = (hex: string) => {
    if (hex === '' || hex === '#') {
      return;
    }

    const rgb = hexToRgb(hex);
    if (rgb) {
      setSelectedColor(prev => ({ ...prev, ...rgb }));
    }
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b', value: string) => {
    const numValue = parseInt(value) || 0;
    const clampedValue = Math.min(255, Math.max(0, numValue));
    updateColor({ [channel]: clampedValue });
  };

  const handleAlphaChange = (value: string) => {
    const numValue = parseInt(value) || 0;
    const clampedValue = Math.min(100, Math.max(0, numValue));
    updateColor({ a: clampedValue });
  };

  const toggleTool = (tool: string) => {
    setSelectedTool(prev => prev === tool ? null : tool);
  };

  const handleClearHistory = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');

      const stats = await invoke<any>('get_history_stats', {
        packDir: packDir
      });

      setHistoryStats({
        totalSize: stats.total_size || 0,
        fileCount: Object.keys(stats.files || {}).length
      });
      setShowClearHistoryDialog(true);
    } catch (error) {
      logger.error('获取历史记录统计失败:', error);
      toast({ message: '获取历史记录信息失败', type: 'error' });
    }
  };

  const confirmClearHistory = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');

      await invoke('clear_all_history', {
        packDir: packDir
      });

      setShowClearHistoryDialog(false);
      setHistoryStats(null);
      toast({ message: '历史记录已清理', type: 'success' });

      await refreshFileTree();
    } catch (error) {
      logger.error('清理历史记录失败:', error);
      toast({ message: `清理失败: ${error}`, type: 'error' });
    }
  };

  const handleToolContextMenu = (e: React.MouseEvent, tool: string) => {
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();

      const menuWidth = 280;
      const menuHeight = 250;

      let x = e.clientX;
      let y = e.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }

      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      x = Math.max(10, x);
      y = Math.max(10, y);

      setToolSizeMenuPos({ x, y });
      setShowToolSizeMenu(true);
    }
  };
  const loadFolderChildren = useCallback(async (folderPath: string) => {
    if (loadingFolders.current.has(folderPath)) {
      logger.debug(`[性能-防抖] ⏭️ 跳过重复加载: ${folderPath}`);
      return [];
    }

    logger.debug(`[性能-文件夹]  开始加载: ${folderPath}`);
    const startTime = performance.now();

    // 标记为正在加载
    loadingFolders.current.add(folderPath);

    try {
      const invokeStart = performance.now();
      const children = await invoke<FileTreeNode[]>('load_folder_children', {
        folderPath: folderPath
      });
      const invokeEnd = performance.now();
      const invokeDuration = (invokeEnd - invokeStart).toFixed(2);

      const endTime = performance.now();
      const totalDuration = (endTime - startTime).toFixed(2);

      logger.debug(`[性能-文件夹]  加载完成: ${folderPath}`);
      logger.debug(`  ├─ Tauri调用耗时: ${invokeDuration}ms`);
      logger.debug(`  ├─ 总耗时: ${totalDuration}ms`);
      logger.debug(`  └─ 子项数量: ${children.length}`);

      return children;
    } catch (error) {
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);
      logger.error(`[性能-文件夹]  加载失败: ${folderPath}, 耗时: ${duration}ms`, error);
      return [];
    } finally {
      loadingFolders.current.delete(folderPath);
    }
  }, []);

  const toggleFolder = useCallback(async (path: string, node: FileTreeNode) => {
    const childCount = node.children?.length || 0;
    logger.debug(`[性能-文件夹展开]  点击文件夹: ${path}, 当前展开状态: ${expandedFolders.has(path)}, loaded: ${node.loaded}, children: ${childCount}`);

    const startTime = performance.now();
    const newExpanded = new Set(expandedFolders);

    if (newExpanded.has(path)) {
      logger.debug(`[性能-文件夹展开] 折叠文件夹: ${path}`);
      newExpanded.delete(path);
      setExpandedFolders(newExpanded);
    } else {
      logger.debug(`[性能-文件夹展开] 展开文件夹: ${path}`);
      newExpanded.add(path);

      if (node.is_dir && !node.loaded && (!node.children || node.children.length === 0)) {
        logger.debug(`[性能-文件夹展开] 需要懒加载子节点: ${path}`);
        const children = await loadFolderChildren(path);
        if (children.length > 0) {
          const updateNodeChildren = (n: FileTreeNode): FileTreeNode => {
            if (n.path === path) {
              return { ...n, children, loaded: true };
            }
            if (n.children) {
              return { ...n, children: n.children.map(updateNodeChildren) };
            }
            return n;
          };

          if (fileTree) {
            setFileTree(updateNodeChildren(fileTree));
          }
        }
      } else {
        logger.debug(`[性能-文件夹展开] 子节点已加载，直接展开: ${path}`);
      }

      if (childCount > 100) {
        logger.debug(`[性能-文件夹展开] ️ 大量子节点 (${childCount})，使用延迟渲染`);
        setTimeout(() => {
          setExpandedFolders(newExpanded);
          const duration = (performance.now() - startTime).toFixed(2);
          logger.debug(`[性能-文件夹展开]  渲染完成，总耗时: ${duration}ms`);
        }, 0);
      } else {
        setExpandedFolders(newExpanded);
        const duration = (performance.now() - startTime).toFixed(2);
        logger.debug(`[性能-文件夹展开]  渲染完成，耗时: ${duration}ms`);
      }
    }

  }, [expandedFolders, fileTree, loadFolderChildren]);

  const renderFileViewer = () => {
    if (!selectedFile) {
      return (
        <div className="empty-state">
          <Icon name="folder" size={24} style={{ width: 80, height: 80 }} />
          <h3>{packInfo.name}</h3>
          <p>从左侧选择文件开始编辑</p>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      );
    }

    const extension = getFileExtension(selectedFile);
    const fileName = selectedFile.split('/').pop() || '';

    // 音频文件播放器
    if (['ogg', 'wav', 'mp3'].includes(extension)) {
      return (
        <AudioPlayer
          filePath={selectedFile}
          fileName={fileName}
          extension={extension}
        />
      );
    }

    // 图片文件
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) {
      const currentTab = openTabs[activeTabIndex];
      return (
        <ImageViewer
          imagePath={selectedFile}
          fileName={fileName}
          selectedTool={selectedTool}
          selectedColor={selectedColor}
          toolSize={toolSize}
          onColorPick={(color) => setSelectedColor(color)}
          onHasChanges={(hasChanges) => setCurrentFileHasChanges(hasChanges)}
          savedCanvasData={currentTab?.canvasData}
          onSaveCanvasData={(data) => {
            if (activeTabIndex >= 0) {
              const newTabs = [...openTabs];
              newTabs[activeTabIndex] = {
                ...newTabs[activeTabIndex],
                canvasData: data
              };
              setOpenTabs(newTabs);
            }
          }}
          onImageLoad={(info) => setImageInfo(info)}
        />
      );
    }

    if (extension === 'mcmeta' && fileName === 'pack.mcmeta') {
      return (
        <PackMetaEditor
          content={fileContent}
          filePath={selectedFile}
          onChange={(content) => {
            updateTabContent(content);
          }}
          onSave={() => {
            markTabAsSaved();
          }}
        />
      );
    }

    if (['json', 'txt', 'md', 'yml', 'yaml', 'lang'].includes(extension)) {
      const currentTab = openTabs[activeTabIndex];
      return (
        <TextEditor
          content={fileContent}
          filePath={selectedFile}
          onChange={(content) => {
            updateTabContent(content);
          }}
          onSave={() => {
            markTabAsSaved();
          }}
          readOnly={false}
          initialLine={currentTab?.initialLine}
          onDownloadSounds={selectedFile === 'assets/minecraft/sounds/sounds.json' ? handleDownloadSounds : undefined}
          onRefreshFileTree={refreshFileTree}
        />
      );
  }

  // 检查是否强制文本模式
  const currentTab = openTabs[activeTabIndex];
  if (currentTab?.forceTextMode) {
    return (
      <TextEditor
        content={fileContent}
        filePath={selectedFile}
        onChange={(content) => {
          updateTabContent(content);
        }}
        onSave={() => {
          markTabAsSaved();
        }}
        readOnly={false}
        initialLine={currentTab?.initialLine}
        onRefreshFileTree={refreshFileTree}
      />
    );
  }

  return (
    <div className="unsupported-file">
      <Icon name="file" size={24} style={{ width: 64, height: 64 }} />
      <p>不支持的文件类型</p>
      <span className="file-info">{fileName}</span>
      <Button
        variant="primary"
        onClick={() => openFileInTab(selectedFile, true)}
        style={{ marginTop: '1rem' }}
      >
        用文本编辑器打开
      </Button>
    </div>
  );
};

const handleContextMenu = async (e: React.MouseEvent, path: string, type: 'file' | 'folder') => {
  e.preventDefault();
  e.stopPropagation();

  setContextMenuPath(path);

  if (path === 'assets/minecraft/sounds') {
    try {
      const soundsJsonPath = `${path}/sounds.json`;
      await invoke('read_file_content', { filePath: soundsJsonPath });
      setSoundsJsonExists(true);
    } catch {
      setSoundsJsonExists(false);
    }
  }

  const menuWidth = 200;
  const estimatedItemHeight = 32;
  const estimatedItemCount = type === 'folder' ? 9 : 5;
  const menuHeight = estimatedItemCount * estimatedItemHeight + 10;

  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10;
  }

  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10;
  }

  if (y < 10) {
    y = 10;
  }

  if (x < 10) {
    x = 10;
  }

  setContextMenu({
    x,
    y,
    path,
    type,
  });
};

// 开始重命名
const startRename = (path: string) => {
  const fileName = path.split('/').pop() || '';
  setRenamingPath(path);
  setRenameValue(fileName);
  setContextMenu(null);
  // 聚焦输入框
  setTimeout(() => {
    if (renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, 0);
};

// 完成重命名
const finishRename = async () => {
  if (renamingPath && renameValue.trim()) {
    const pathParts = renamingPath.split('/');
    const oldName = pathParts[pathParts.length - 1];

    if (oldName !== renameValue.trim()) {
      pathParts[pathParts.length - 1] = renameValue.trim();
      const newPath = pathParts.join('/');

      try {
        await invoke('rename_file', {
          oldPath: renamingPath,
          newPath: newPath
        });
        await refreshFileTree();
      } catch (error) {
        toast({ message: `重命名失败: ${error}`, type: 'error' });
      }
    }
  }
  setRenamingPath(null);
  setRenameValue("");
};

// 取消重命名
const cancelRename = () => {
  setRenamingPath(null);
  setRenameValue("");
};

const refreshFileTree = useCallback(async () => {
  try {
    const tree = await invoke<FileTreeNode>('get_file_tree');
    setFileTree(tree);
  } catch (error) {
    logger.error('刷新文件树失败:', error);
  }
}, []);

const handleDownloadSounds = async () => {
  // 显示下载设置对话框
  setShowDownloadSettings(true);
};

const startDownload = async (threads: number) => {
  try {
    const taskId = await invoke<string>('download_minecraft_sounds', {
      concurrentDownloads: threads
    });
    logger.debug('下载任务已创建:', taskId, '线程数:', threads);

    setShowDownloadSettings(false);

    setShowDownloadDetails(true);
  } catch (error) {
    logger.error('创建下载任务失败:', error);
    toast({ message: `下载失败: ${error}`, type: 'error' });
  }
};

const handleMenuAction = async (action: string) => {
  if (!contextMenu) return;

  switch (action) {
    case 'openInExplorer':
      try {
        await invoke('open_in_explorer', { filePath: contextMenu.path });
      } catch (error) {
        toast({ message: `打开资源管理器失败: ${error}`, type: 'error' });
      }
      break;
    case 'downloadSounds':
      await handleDownloadSounds();
      break;
    case 'delete': {
      const deletePath = contextMenu.path;
      setConfirmDialogState({
        open: true,
        title: '确认删除',
        message: `确定要删除 ${deletePath} 吗？`,
        variant: 'danger',
        onConfirm: async () => {
          setConfirmDialogState(prev => ({ ...prev, open: false }));
          try {
            await invoke('delete_file', { filePath: deletePath });
            await refreshFileTree();
          } catch (error) {
            toast({ message: `删除失败: ${error}`, type: 'error' });
          }
        },
      });
      break;
    }
    case 'rename':
      startRename(contextMenu.path);
      break;
    case 'newFile': {
      const basePath = contextMenu.path;
      setInputDialogState({
        open: true,
        title: '新建文件',
        placeholder: '输入文件名',
        value: '',
        onSubmit: async (fileName: string) => {
          setInputDialogState(prev => ({ ...prev, open: false }));
          if (fileName) {
            try {
              const filePath = basePath ? `${basePath}/${fileName}` : fileName;
              await invoke('create_new_file', { filePath, content: '' });
              await refreshFileTree();
            } catch (error) {
              toast({ message: `创建文件失败: ${error}`, type: 'error' });
            }
          }
        },
      });
      break;
    }
    case 'newFolder': {
      const baseFolderPath = contextMenu.path;
      setInputDialogState({
        open: true,
        title: '新建文件夹',
        placeholder: '输入文件夹名',
        value: '',
        onSubmit: async (folderName: string) => {
          setInputDialogState(prev => ({ ...prev, open: false }));
          if (folderName) {
            try {
              const folderPath = baseFolderPath ? `${baseFolderPath}/${folderName}` : folderName;
              await invoke('create_new_folder', { folderPath });
              await refreshFileTree();
            } catch (error) {
              toast({ message: `创建文件夹失败: ${error}`, type: 'error' });
            }
          }
        },
      });
      break;
    }
    case 'newPng':
      setPngCreatorFolder(contextMenu.path);
      setShowPngCreator(true);
      break;
    case 'newSoundsJson':
      try {
        const filePath = contextMenu.path ? `${contextMenu.path}/sounds.json` : 'sounds.json';

        const packPath = await invoke<string>('get_current_pack_path');
        const fullPath = `${packPath}/${filePath}`;

        try {
          await invoke('read_file_content', { filePath: filePath });
          toast({ message: 'sounds.json 文件已存在！', type: 'warning' });
          openFileInTab(filePath);
          break;
        } catch {}

        const defaultContent = JSON.stringify({}, null, 2);
        await invoke('create_new_file', {
          filePath: filePath,
          content: defaultContent
        });
        await refreshFileTree();
        // 自动打开创建的文件
        openFileInTab(filePath);
      } catch (error) {
        toast({ message: `创建 sounds.json 失败: ${error}`, type: 'error' });
      }
      break;
    case 'copy':
      logger.debug('复制:', contextMenu.path);
      break;
    case 'paste':
      logger.debug('粘贴到:', contextMenu.path);
      break;
  }

  setContextMenu(null);
  setContextMenuPath(null);
};

const handleCreatePng = async (width: number, height: number, fileName: string) => {
  try {
    const filePath = pngCreatorFolder ? `${pngCreatorFolder}/${fileName}` : fileName;
    await invoke('create_transparent_png', {
      filePath: filePath,
      width: width,
      height: height
    });
    await refreshFileTree();
    setShowPngCreator(false);

    openFileInTab(filePath);
  } catch (error) {
    toast({ message: `创建PNG失败: ${error}`, type: 'error' });
  }
};

// F-BUG-01: 移除有问题的 memo 包装。此组件定义在父组件闭包内，
// 直接访问父组件状态(expandedFolders, selectedFile 等)，
// 而 memo 无法感知这些闭包变量的变化，导致显示过期状态。
// 正确的 memo 需要将组件提升到模块级并通过 props 传递所有依赖。
const FileTreeItem = ({
  node,
  path,
  level,
  isRoot,
  isLast,
  parentLines
}: {
  node: FileTreeNode;
  path: string;
  level: number;
  isRoot: boolean;
  isLast: boolean;
  parentLines: boolean[];
}) => {
  // 过滤掉 .history 文件夹
  if (node.name === '.history') {
    return null;
  }

  const currentPath = isRoot ? "" : (path ? `${path}/${node.name}` : node.name);
  const isExpanded = expandedFolders.has(currentPath) || isRoot;
  const isRenaming = renamingPath === currentPath;


  if (node.is_dir) {
    const children = node.children || [];
    // 过滤掉 .history 文件夹
    const filteredChildren = children.filter(child => child.name !== '.history');
    const folders = filteredChildren.filter(child => child.is_dir);
    const files = filteredChildren.filter(child => !child.is_dir);
    const sortedChildren = [...folders, ...files];

    return (
      <div className="tree-node">
        <div
          className={`tree-item folder ${isExpanded ? 'expanded' : ''} ${contextMenuPath === currentPath ? 'context-selected' : ''}`}
          style={{ paddingLeft: `${level * 10 + 10}px` }}
          onClick={(e) => {
            if (!isRenaming) toggleFolder(currentPath, node);
          }}
          onContextMenu={(e) => handleContextMenu(e, currentPath, 'folder')}
          onDoubleClick={(e) => {
            if (!isRenaming) {
              e.stopPropagation();
              startRename(currentPath);
            }
          }}
        >
          <span className="tree-arrow" style={{ marginRight: '4px', display: 'flex', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="folder-icon" style={{ marginRight: '6px' }}>
            {isExpanded ? <Icon name="folder-open" size={16} className="tree-icon" /> : <Icon name="folder" size={16} className="tree-icon" />}
          </span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              className="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename();
                if (e.key === 'Escape') cancelRename();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="item-name" title={node.name}>
              {getDisplayName(node.name, currentPath)}
            </span>
          )}
        </div>
        {isExpanded && sortedChildren.length > 0 && (
          <div className="tree-children">
            {sortedChildren.map((child, index) => {
              const newParentLines = [...parentLines];
              if (level > 0) {
                newParentLines[level - 1] = !isLast;
              }
              return (
                <FileTreeItem
                  key={child.path || `${currentPath}/${child.name}`}
                  node={child}
                  path={currentPath}
                  level={level + 1}
                  isRoot={false}
                  isLast={index === sortedChildren.length - 1}
                  parentLines={newParentLines}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div
        className={`tree-item file ${selectedFile === currentPath ? "selected" : ""} ${contextMenuPath === currentPath ? 'context-selected' : ''}`}
        style={{ paddingLeft: `${level * 10 + 28}px` }}
        onClick={(e) => {
          if (!isRenaming) openFileInTab(currentPath);
        }}
        onContextMenu={(e) => handleContextMenu(e, currentPath, 'file')}
        onDoubleClick={(e) => {
          if (!isRenaming) {
            e.stopPropagation();
            startRename(currentPath);
          }
        }}
      >
        <span className="file-icon"><Icon name="file" size={16} className="tree-icon" /></span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="item-name" title={currentPath}>
            {getDisplayName(node.name, currentPath)}
          </span>
        )}
      </div>
    );
  }
};

const renderFileTree = (
  node: FileTreeNode,
  path: string = "",
  level: number = 0,
  isRoot: boolean = false,
  isLast: boolean = false,
  parentLines: boolean[] = []
): React.ReactNode => {
  // 过滤掉 .history 文件夹
  if (node.name === '.history') {
    return null;
  }

  return (
    <FileTreeItem
      key={node.path || node.name}
      node={node}
      path={path}
      level={level}
      isRoot={isRoot}
      isLast={isLast}
      parentLines={parentLines}
    />
  );
};

return (
  <>
    <div className="pack-editor">
      {/* 调整大小指示器 */}
      {resizeIndicator && (
        <div className="resize-indicator">
          {resizeIndicator}
        </div>
      )}

      {/* 左侧文件树 */}
      <div
        ref={sidebarRef}
        className={`editor-sidebar ${!isSidebarOpen ? 'closed' : ''}`}
        style={{ width: isSidebarOpen ? `${sidebarWidth}px` : '0px' }}
      >
        <div className="sidebar-header">
          <div className="sidebar-header-left" style={{ paddingLeft: '8px' }}>
            <h3>资源管理器</h3>
          </div>
          <div className="sidebar-header-right" style={{ paddingRight: '8px' }}>
             <button className="btn-icon" onClick={onClose} title="返回主页" style={{ width: '24px', height: '24px' }}>
               <Icon name="arrow-left" size={16} />
             </button>
             <button
              className="btn-icon"
              onClick={() => setShowSearchModal(true)}
              title="搜索 (Ctrl+F)"
              style={{ width: '24px', height: '24px' }}
            >
              <Icon name="search" size={16} className="tree-icon" style={{ width: '14px', height: '14px' }} />
            </button>
            <button className="btn-icon" onClick={refreshFileTree} title="刷新" style={{ width: '24px', height: '24px' }}>
              <Icon name="refresh" size={16} />
            </button>
            <button className="btn-icon" onClick={() => setIsSidebarOpen(false)} title="收起" style={{ width: '24px', height: '24px' }}>
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
        <div className="file-tree" ref={fileTreeRef}>
          {fileTree ? renderFileTree(fileTree, "", 0, true, true, []) : (
            <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
              加载文件树中...
            </div>
          )}
        </div>
        {/* 拖动调整大小的手柄 */}
        <div
          className="sidebar-resizer"
          onMouseDown={() => setIsResizingSidebar(true)}
        />
      </div>

      {/* 中间预览区域 */}
      <div className="editor-main">
        <div className="editor-header">
          {!isSidebarOpen && (
            <button
              className="btn-icon sidebar-toggle"
              onClick={() => setIsSidebarOpen(true)}
              title="展开侧边栏"
              style={{ margin: '0 8px' }}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          )}
          <div
            className="editor-tabs"
            ref={tabsContainerRef}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
          >
            {openTabs.map((tab, index) => (
              <div
                key={tab.path}
                className={`editor-tab ${index === activeTabIndex ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-tab-index", index.toString());
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragIndexStr = e.dataTransfer.getData("application/x-tab-index");
                  if (dragIndexStr) {
                    const dragIndex = parseInt(dragIndexStr);
                    if (dragIndex !== index) {
                      const newTabs = [...openTabs];
                      const [removed] = newTabs.splice(dragIndex, 1);
                      newTabs.splice(index, 0, removed);
                      setOpenTabs(newTabs);
                      
                      // Adjust active tab index
                      if (activeTabIndex === dragIndex) {
                        setActiveTabIndex(index);
                      } else if (activeTabIndex > dragIndex && activeTabIndex <= index) {
                        setActiveTabIndex(activeTabIndex - 1);
                      } else if (activeTabIndex < dragIndex && activeTabIndex >= index) {
                        setActiveTabIndex(activeTabIndex + 1);
                      }
                    }
                  }
                }}
                onClick={() => setActiveTabIndex(index)}
                onMouseDown={(e) => {
                  // 鼠标中键(滚轮按钮)关闭标签
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(index);
                  }
                }}
              >
                <span>{tab.path.split('/').pop() || '未命名'}</span>
                <div className="tab-close-container">
                  <div className="tab-dirty" />
                  <button className="tab-close" onClick={(e) => closeTab(index, e)}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="editor-content">
          {renderFileViewer()}
        </div>
      </div>

      {/* PNG创建对话框 */}
      {showPngCreator && (
        <PngCreatorDialog
          folderPath={pngCreatorFolder}
          onClose={() => setShowPngCreator(false)}
          onConfirm={handleCreatePng}
        />
      )}

      {/* 搜索模态框 */}
      {showSearchModal && (
        <SearchModal
          onClose={() => {
            setShowSearchModal(false);
            setSearchResults(null);
            setIsSearching(false);
          }}
          onResultClick={(filePath, lineNumber) => {
            openFileInTab(filePath, false, lineNumber);
            setShowSearchModal(false);
            setSearchResults(null);
          }}
          onSearch={async (query, caseSensitive, useRegex) => {
            if (!query.trim()) {
              setSearchResults(null);
              return;
            }

            setIsSearching(true);
            try {
              const results = await searchFiles(query, caseSensitive, useRegex);
              setSearchResults(results);
            } catch (error) {
              logger.error('搜索失败:', error);
              toast({ message: `搜索失败: ${error}`, type: 'error' });
            } finally {
              setIsSearching(false);
            }
          }}
          searchResults={searchResults}
          isSearching={isSearching}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          {contextMenu.type === 'folder' && (
            <>
              <div className="context-menu-item" onClick={() => handleMenuAction('newFile')}>
                <span className="menu-icon"><Icon name="new-file" size={16} /></span>
                <span>新建文件</span>
              </div>
              <div className="context-menu-item" onClick={() => handleMenuAction('newFolder')}>
                <span className="menu-icon"><Icon name="new-folder" size={16} /></span>
                <span>新建文件夹</span>
              </div>
              <div className="context-menu-item" onClick={() => handleMenuAction('newPng')}>
                <span className="menu-icon"><Icon name="image" size={16} /></span>
                <span>新增PNG图片</span>
              </div>
              {/* sounds*/}
              {contextMenu.path === 'assets/minecraft/sounds' && (
                <>
                  {!soundsJsonExists && (
                    <div className="context-menu-item" onClick={() => handleMenuAction('newSoundsJson')}>
                      <span className="menu-icon">
                        <Icon name="volume" size={16} />
                      </span>
                      <span>创建 sounds.json</span>
                    </div>
                  )}
                  <div className="context-menu-item" onClick={() => handleMenuAction('downloadSounds')}>
                    <span className="menu-icon">
                      <Icon name="download" size={16} />
                    </span>
                    <span>下载声音资源</span>
                  </div>
                </>
              )}
              <div className="context-menu-divider"></div>
            </>
          )}
          <div className="context-menu-item" onClick={() => handleMenuAction('rename')}>
            <span className="menu-icon"><Icon name="rename" size={16} /></span>
            <span>重命名</span>
          </div>
          <div className="context-menu-item" onClick={() => handleMenuAction('copy')}>
            <span className="menu-icon"><Icon name="copy" size={16} /></span>
            <span>复制</span>
          </div>
          {contextMenu.type === 'folder' && (
            <div className="context-menu-item" onClick={() => handleMenuAction('paste')}>
              <span className="menu-icon"><Icon name="paste" size={16} /></span>
              <span>粘贴</span>
            </div>
          )}
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => handleMenuAction('openInExplorer')}>
            <span className="menu-icon">
              <Icon name="folder" size={16} />
            </span>
            <span>用资源管理器打开</span>
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
            <span className="menu-icon"><Icon name="delete" size={16} /></span>
            <span>删除</span>
          </div>
        </div>
      )}

      {/* 右侧工具栏 */}
      <div
        ref={toolbarRef}
        className={`editor-toolbar ${isPngFile ? 'visible' : ''}`}
        style={{ width: isPngFile ? `${toolbarWidth}px` : '0px' }}
      >
        <div className="toolbar-content-wrapper">
          {/* 拖动调整大小的手柄 */}
          <div
            className="toolbar-resizer"
            onMouseDown={() => setIsResizingToolbar(true)}
          />

          {/* 工具网格 */}
          <div className="toolbar-section">
            <div className="tools-grid">
              <button
                className={`tool-grid-btn ${selectedTool === 'brush' ? 'active' : ''}`}
                onClick={() => toggleTool('brush')}
                onContextMenu={(e) => handleToolContextMenu(e, 'brush')}
                title="毛刷笔 (右键调整大小)"
              >
                <img src={brushIcon} alt="毛刷笔" width="24" height="24" />
                <span>毛刷笔</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'pencil' ? 'active' : ''}`}
                onClick={() => toggleTool('pencil')}
                onContextMenu={(e) => handleToolContextMenu(e, 'pencil')}
                title="铅笔 (右键调整大小)"
              >
                <img src={pencilIcon} alt="铅笔" width="24" height="24" />
                <span>铅笔</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'eraser' ? 'active' : ''}`}
                onClick={() => toggleTool('eraser')}
                onContextMenu={(e) => handleToolContextMenu(e, 'eraser')}
                title="橡皮 (右键调整大小)"
              >
                <img src={eraserIcon} alt="橡皮" width="24" height="24" />
                <span>橡皮</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'move' ? 'active' : ''}`}
                onClick={() => toggleTool('move')}
                title="移动工具"
              >
                <img src={moveIcon} alt="移动工具" width="24" height="24" />
                <span>移动工具</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'selection' ? 'active' : ''}`}
                onClick={() => toggleTool('selection')}
                title="选区工具 (左键选择，右键切换模式)"
              >
                <img src={penToolIcon} alt="选区工具" width="24" height="24" />
                <span>选区工具</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'eyedropper' ? 'active' : ''}`}
                onClick={() => toggleTool('eyedropper')}
                title="取色管工具"
              >
                <img src={coloizeIcon} alt="取色管工具" width="24" height="24" />
                <span>取色管工具</span>
              </button>
            </div>
          </div>

          {/* 图片属性 */}
          <div className="toolbar-section">
            <div className="image-properties">
              {imageInfo ? (
                <>
                  <div className="property-item">
                    <span className="property-label">分辨率:</span>
                    <span className="property-value">{imageInfo.width} x {imageInfo.height}</span>
                  </div>
                  <div className="property-item">
                    <span className="property-label">亮度:</span>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      defaultValue="100"
                      className="property-slider"
                    />
                  </div>
                  <div className="property-item">
                    <span className="property-label">不透明度:</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={selectedColor.a}
                      onChange={(e) => updateColor({ a: parseInt(e.target.value) })}
                      className="property-slider"
                    />
                    <span className="property-value">{selectedColor.a}%</span>
                  </div>
                </>
              ) : (
                <div className="property-label">加载图片信息中...</div>
              )}
            </div>
          </div>

          {/* 取色板 */}
          <div className="toolbar-section">
            <h4>取色板</h4>
            <div className="color-picker-panel">
              <div
                className="color-preview-large"
                style={{
                  background: `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${selectedColor.a / 100})`
                }}
                title="点击选择颜色"
              >
                <input
                  type="color"
                  value={rgbToHex(selectedColor.r, selectedColor.g, selectedColor.b)}
                  onChange={(e) => handleHexChange(e.target.value)}
                  className="color-input-hidden"
                />
              </div>
              <div className="color-info-panel">
                <div className="color-input-group">
                  <label>R:</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={selectedColor.r}
                    onChange={(e) => handleRgbChange('r', e.target.value)}
                    className="color-input"
                  />
                </div>
                <div className="color-input-group">
                  <label>G:</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={selectedColor.g}
                    onChange={(e) => handleRgbChange('g', e.target.value)}
                    className="color-input"
                  />
                </div>
                <div className="color-input-group">
                  <label>B:</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={selectedColor.b}
                    onChange={(e) => handleRgbChange('b', e.target.value)}
                    className="color-input"
                  />
                </div>
                <div className="color-input-group">
                  <label>HEX:</label>
                  <input
                    type="text"
                    defaultValue={rgbToHex(selectedColor.r, selectedColor.g, selectedColor.b)}
                    onChange={(e) => handleHexChange(e.target.value)}
                    onBlur={(e) => {
                      handleHexBlur(e.target.value);
                      e.target.value = rgbToHex(selectedColor.r, selectedColor.g, selectedColor.b);
                    }}
                    className="color-input hex-input"
                    maxLength={7}
                    placeholder="#000000"
                  />
                </div>
                <div className="color-input-group">
                  <label>透明度:</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={selectedColor.a}
                    onChange={(e) => handleAlphaChange(e.target.value)}
                    className="color-input alpha-input"
                  />
                  <span className="unit">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 下载指示器 */}
      <DownloadIndicator onShowDetails={() => setShowDownloadDetails(true)} />

      {/* 下载设置对话框 */}
      {showDownloadSettings && (
        <DownloadSettingsDialog
          onConfirm={startDownload}
          onCancel={() => setShowDownloadSettings(false)}
        />
      )}

      {/* 下载详情弹窗 */}
      {showDownloadDetails && (
        <DownloadDetails onClose={() => setShowDownloadDetails(false)} />
      )}

      {/* 工具大小调整菜单 */}
      {showToolSizeMenu && (
        <>
          <div className="size-menu-overlay" onClick={() => setShowToolSizeMenu(false)} />
          <div
            ref={toolSizeMenuRef}
            className="tool-size-menu"
            style={{
              position: 'fixed',
              left: `${toolSizeMenuPos.x}px`,
              top: `${toolSizeMenuPos.y}px`,
              zIndex: 10000
            }}
          >
            <div className="size-menu-header">
              <span>工具大小</span>
              <button onClick={() => setShowToolSizeMenu(false)}>x</button>
            </div>
            <div className="size-menu-content">
              <input
                type="range"
                min="1"
                max="500"
                value={toolSize}
                onChange={(e) => setToolSize(parseInt(e.target.value))}
                className="size-slider"
              />
              <div className="size-input-group">
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={toolSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1;
                    setToolSize(Math.min(Math.max(val, 1), 500));
                  }}
                  className="size-input"
                />
                <span className="size-unit">px</span>
              </div>
              <div className="size-preview">
                <div
                  className="size-preview-circle"
                  style={{
                    width: `${Math.min(toolSize, 100)}px`,
                    height: `${Math.min(toolSize, 100)}px`,
                    background: `rgba(${selectedColor.r}, ${selectedColor.g}, ${selectedColor.b}, ${selectedColor.a / 100})`
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  
    {/* 确认对话框 - 替代 browser confirm() */}
    <ConfirmDialog
      open={confirmDialogState.open}
      title={confirmDialogState.title}
      message={confirmDialogState.message}
      variant={confirmDialogState.variant ?? 'warning'}
      confirmText="确定"
      cancelText="取消"
      onConfirm={confirmDialogState.onConfirm}
      onCancel={() => setConfirmDialogState(prev => ({ ...prev, open: false }))}
    />

    {/* 输入对话框 - 替代 browser prompt() */}
    <Dialog
      open={inputDialogState.open}
      onClose={() => setInputDialogState(prev => ({ ...prev, open: false }))}
      size="sm"
      animation="scale"
    >
      <DialogBody>
        <h3 style={{ margin: '0 0 12px 0' }}>{inputDialogState.title}</h3>
        <input
          type="text"
          placeholder={inputDialogState.placeholder}
          defaultValue={inputDialogState.value}
          autoFocus
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--border-color, #555)',
            borderRadius: '6px',
            background: 'var(--input-bg, #2a2a2a)',
            color: 'var(--text-color, #fff)',
            fontSize: '14px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              inputDialogState.onSubmit((e.target as HTMLInputElement).value);
            } else if (e.key === 'Escape') {
              setInputDialogState(prev => ({ ...prev, open: false }));
            }
          }}
          ref={(el) => {
            // 自动选中已有文本
            if (el && inputDialogState.value) {
              setTimeout(() => el.select(), 0);
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setInputDialogState(prev => ({ ...prev, open: false }))}
        >
          取消
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            const input = document.querySelector<HTMLInputElement>('.mpe-dialog input[type="text"]');
            if (input) inputDialogState.onSubmit(input.value);
          }}
        >
          确定
        </Button>
      </DialogFooter>
    </Dialog>
  </>
);
}