import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./PackEditor.css";
import type { PackInfo } from "../types/pack";
import TextEditor from "./TextEditor";
import ImageViewer from "./ImageViewer";
import PackMetaEditor from "./PackMetaEditor";
import PngCreatorDialog from "./PngCreatorDialog";
import SearchModal from "./SearchModal";
import TitleBar from "./TitleBar";
import { readFileContent, writeFileContent, searchFiles, type SearchResponse } from "../utils/tauri-api";
import {
  FolderIcon, FolderOpenIcon, FileIcon, NewFileIcon,
  NewFolderIcon, ImageIcon, RenameIcon, CopyIcon,
  PasteIcon, DeleteIcon, SearchIcon
} from "./Icons";

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

export default function PackEditor({ packInfo, onClose, debugMode = false }: PackEditorProps) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([""]));
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
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
  const [packSize, setPackSize] = useState<number>(0);
  const [historySize, setHistorySize] = useState<number>(0);
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);
  const [historyStats, setHistoryStats] = useState<{ totalSize: number; fileCount: number } | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [languageMap, setLanguageMap] = useState<Record<string, string>>({});
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const fileTreeRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolSizeMenuRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const loadingFolders = useRef<Set<string>>(new Set());

  const selectedFile = activeTabIndex >= 0 ? openTabs[activeTabIndex]?.path : null;
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
    
    // 匹配路径
    const blockMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/block\/(.+)/);
    if (blockMatch) {
      return `block.minecraft.${blockMatch[1].replace(/\//g, '.')}`;
    }
    
    const itemMatch = pathWithoutExt.match(/assets\/minecraft\/textures\/item\/(.+)/);
    if (itemMatch) {
      return `item.minecraft.${itemMatch[1].replace(/\//g, '.')}`;
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
        console.log('[翻译调试]', {
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
      // 获取当前材质包路径
      const packDir = await invoke<string>('get_current_pack_path');
      
      // 获取材质包大小 同时排除.history文件夹
      const pSize = await invoke<number>('get_pack_size', { packDir });
      setPackSize(pSize);
      
      // 获取历史记录统计
      const stats = await invoke<any>('get_history_stats', { packDir });
      setHistorySize(stats.total_size || 0);
    } catch (error) {
      console.error('获取大小统计失败:', error);
      setPackSize(0);
      setHistorySize(0);
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
          
          // 如果是 item 路径且没找到翻译，尝试用 block 路径
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
        console.log('[语言映射] 映射表加载完成，条目数:', Object.keys(map).length);
      } catch (error) {
        console.error('[语言映射] 加载映射表失败:', error);
        setLanguageMap({});
      }
    };
    
    loadMap();
  }, []);

  useEffect(() => {
    if (fileTree && Object.keys(languageMap).length > 0) {
      console.log('[语言映射] 开始预计算翻译缓存...');
      const startTime = performance.now();
      
      const cache = precomputeTranslations(fileTree, '', true);
      setTranslationCache(cache);
      
      const duration = (performance.now() - startTime).toFixed(2);
      console.log(`[语言映射] 翻译缓存完成！耗时: ${duration}ms, 缓存条目: ${Object.keys(cache).length}`);
      
      // 调试
      const sampleKeys = Object.keys(cache).slice(0, 5);
      console.log('[语言映射] 缓存示例键:', sampleKeys);
    }
  }, [fileTree, languageMap]);

  useEffect(() => {
    const loadFileTree = async () => {
      console.log('[性能] 开始加载文件树...');
      const startTime = performance.now();
      
      try {
        const tree = await invoke<FileTreeNode>('get_file_tree');
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        
        console.log(`[性能]  文件树加载完成! 耗时: ${duration}ms`);
        console.log(`[性能] 文件树根节点:`, tree);
        
        setFileTree(tree);
        
        // 启动积极预加载整个资源包
        setIsPreloading(true);
        invoke('preload_folder_aggressive', { folderPath: '' })
          .then((count: any) => {
            console.log(`[性能-积极预加载]  完成! 预加载了 ${count} 个文件`);
            setIsPreloading(false);
          })
          .catch((err: any) => {
            console.error('[性能-积极预加载]  失败:', err);
            setIsPreloading(false);
          });
      } catch (error) {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        console.error(`[性能]  加载文件树失败! 耗时: ${duration}ms`, error);
        alert(`加载文件树失败: ${error}`);
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
        .then(() => console.log('[性能] 预加载缓存已清理'))
        .catch((err: any) => console.error('[性能] 清理缓存失败:', err));
    };
  }, []);

  // 关闭右键菜单和工具大小菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
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
      if (['mcmeta', 'json', 'txt', 'md', 'yml', 'yaml'].includes(extension || '')) {
        content = await readFileContent(filePath);
      }
      
      return content;
    } catch (error) {
      console.error('加载文件失败:', error);
      alert(`加载文件失败: ${error}`);
      return '';
    } finally {
      setIsLoading(false);
    }
  }, []);
const openFileInTab = useCallback(async (filePath: string, forceTextMode: boolean = false, lineNumber?: number) => {
  console.log(`[性能-打开文件]  开始: ${filePath}${lineNumber ? ` (行号: ${lineNumber})` : ''}`);
  const startTime = performance.now();
  
  const existingTabIndex = openTabs.findIndex(tab => tab.path === filePath);
  
  if (existingTabIndex >= 0) {
    const duration = (performance.now() - startTime).toFixed(2);
    console.log(`[性能-打开文件]  切换到已打开的标签! 耗时: ${duration}ms`);
    
    const newTabs = [...openTabs];
    let needsUpdate = false;
    
    if (forceTextMode && !openTabs[existingTabIndex].forceTextMode) {
      newTabs[existingTabIndex] = {
        ...newTabs[existingTabIndex],
        forceTextMode: true
      };
      needsUpdate = true;
      
      if (!newTabs[existingTabIndex].content) {
        try {
          const content = await readFileContent(filePath);
          newTabs[existingTabIndex].content = content;
        } catch (error) {
          console.error('加载文件内容失败:', error);
        }
      }
    }
    
    // 更新行号
    if (lineNumber !== undefined) {
      newTabs[existingTabIndex] = {
        ...newTabs[existingTabIndex],
        initialLine: lineNumber
      };
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      setOpenTabs(newTabs);
    }
    
    setActiveTabIndex(existingTabIndex);
    setCurrentFileHasChanges(false);
    
    return;
  }
  
  // 检查是否是图片
  const ext = filePath.split('.').pop()?.toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '');
    
    console.log(`[性能-打开文件] 文件类型: ${isImage ? '图片' : '文本'}, 强制文本模式: ${forceTextMode}`);
    
    let content = '';
    if (!isImage || forceTextMode) {
      const loadStart = performance.now();
      try {
        content = await readFileContent(filePath);
      } catch (error) {
        console.error('加载文件内容失败:', error);
        content = '';
      }
      const loadDuration = (performance.now() - loadStart).toFixed(2);
      console.log(`[性能-打开文件]   ├─ 文本内容加载耗时: ${loadDuration}ms`);
    }
    
    const duration = (performance.now() - startTime).toFixed(2);
    console.log(`[性能-打开文件]  完成! 总耗时: ${duration}ms`);
    
    const newTab: OpenTab = {
      path: filePath,
      content: content,
      isDirty: false,
      forceTextMode: forceTextMode,
      initialLine: lineNumber,
    };
    
    setOpenTabs([...openTabs, newTab]);
    setActiveTabIndex(openTabs.length);
    setCurrentFileHasChanges(false);
    
    if (!isImage || forceTextMode) {
      setImageInfo(null);
    }
  }, [openTabs, loadFileContent]);

  const closeTab = (index: number, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    
    const tab = openTabs[index];
    
    const isPng = tab.path.split('.').pop()?.toLowerCase() === 'png';
    const hasUnsavedChanges = (index === activeTabIndex && currentFileHasChanges) || tab.isDirty;
    
    if (hasUnsavedChanges) {
      if (!confirm(`${tab.path.split('/').pop()} 有未保存的更改，确定要关闭吗？`)) {
        return;
      }
    }
    
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
      console.error('保存文件失败:', error);
      alert(`保存文件失败: ${error}`);
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
      console.error('获取历史记录统计失败:', error);
      alert('获取历史记录信息失败');
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
      alert('历史记录已清理');
      
      await refreshFileTree();
    } catch (error) {
      console.error('清理历史记录失败:', error);
      alert(`清理失败: ${error}`);
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
    console.log(`[性能-防抖] ⏭️ 跳过重复加载: ${folderPath}`);
    return [];
  }
  
  console.log(`[性能-文件夹]  开始加载: ${folderPath}`);
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
    
    console.log(`[性能-文件夹]  加载完成: ${folderPath}`);
    console.log(`  ├─ Tauri调用耗时: ${invokeDuration}ms`);
    console.log(`  ├─ 总耗时: ${totalDuration}ms`);
    console.log(`  └─ 子项数量: ${children.length}`);
    
    return children;
  } catch (error) {
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    console.error(`[性能-文件夹]  加载失败: ${folderPath}, 耗时: ${duration}ms`, error);
    return [];
  } finally {
    loadingFolders.current.delete(folderPath);
  }
}, []);

  const toggleFolder = useCallback(async (path: string, node: FileTreeNode) => {
    const childCount = node.children?.length || 0;
    console.log(`[性能-文件夹展开]  点击文件夹: ${path}, 当前展开状态: ${expandedFolders.has(path)}, loaded: ${node.loaded}, children: ${childCount}`);
    
    const startTime = performance.now();
    const newExpanded = new Set(expandedFolders);
    
    if (newExpanded.has(path)) {
      console.log(`[性能-文件夹展开] 折叠文件夹: ${path}`);
      newExpanded.delete(path);
      setExpandedFolders(newExpanded);
    } else {
      console.log(`[性能-文件夹展开] 展开文件夹: ${path}`);
      newExpanded.add(path);
      
      if (node.is_dir && !node.loaded && (!node.children || node.children.length === 0)) {
        console.log(`[性能-文件夹展开] 需要懒加载子节点: ${path}`);
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
        console.log(`[性能-文件夹展开] 子节点已加载，直接展开: ${path}`);
      }
      
      if (childCount > 100) {
        console.log(`[性能-文件夹展开] ️ 大量子节点 (${childCount})，使用延迟渲染`);
        setTimeout(() => {
          setExpandedFolders(newExpanded);
          const duration = (performance.now() - startTime).toFixed(2);
          console.log(`[性能-文件夹展开]  渲染完成，总耗时: ${duration}ms`);
        }, 0);
      } else {
        setExpandedFolders(newExpanded);
        const duration = (performance.now() - startTime).toFixed(2);
        console.log(`[性能-文件夹展开]  渲染完成，耗时: ${duration}ms`);
      }
    }

  }, [expandedFolders, fileTree, loadFolderChildren]);

  const renderFileViewer = () => {
    if (!selectedFile) {
      return (
        <div className="empty-state">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
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
        />
      );
    }

    // pack.mcmeta
    if (extension === 'mcmeta') {
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

    if (['json', 'txt', 'md', 'yml', 'yaml'].includes(extension)) {
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
        />
      );
    }

    return (
      <div className="unsupported-file">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <p>不支持的文件类型</p>
        <span className="file-info">{fileName}</span>
        <button
          className="btn-primary"
          onClick={() => openFileInTab(selectedFile, true)}
          style={{ marginTop: '1rem' }}
        >
          用文本编辑器打开
        </button>
      </div>
    );
  };

  const handleContextMenu = (e: React.MouseEvent, path: string, type: 'file' | 'folder') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
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
          alert(`重命名失败: ${error}`);
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
      console.error('刷新文件树失败:', error);
    }
  }, []);

  const handleMenuAction = async (action: string) => {
    if (!contextMenu) return;
    
    switch (action) {
      case 'delete':
        if (confirm(`确定要删除 ${contextMenu.path} 吗？`)) {
          try {
            await invoke('delete_file', { filePath: contextMenu.path });
            await refreshFileTree();
          } catch (error) {
            alert(`删除失败: ${error}`);
          }
        }
        break;
      case 'rename':
        startRename(contextMenu.path);
        break;
      case 'newFile':
        const fileName = prompt('输入文件名:');
        if (fileName) {
          try {
            const filePath = contextMenu.path ? `${contextMenu.path}/${fileName}` : fileName;
            await invoke('create_new_file', {
              filePath: filePath,
              content: ''
            });
            await refreshFileTree();
          } catch (error) {
            alert(`创建文件失败: ${error}`);
          }
        }
        break;
      case 'newFolder':
        const folderName = prompt('输入文件夹名:');
        if (folderName) {
          try {
            const folderPath = contextMenu.path ? `${contextMenu.path}/${folderName}` : folderName;
            await invoke('create_new_folder', { folderPath: folderPath });
            await refreshFileTree();
          } catch (error) {
            alert(`创建文件夹失败: ${error}`);
          }
        }
        break;
      case 'newPng':
        setPngCreatorFolder(contextMenu.path);
        setShowPngCreator(true);
        break;
      case 'copy':
        console.log('复制:', contextMenu.path);
        break;
      case 'paste':
        console.log('粘贴到:', contextMenu.path);
        break;
    }
    
    setContextMenu(null);
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
      alert(`创建PNG失败: ${error}`);
    }
  };

  const FileTreeItem = memo(({
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

    const renderTreeLines = () => {
      const lines: React.ReactNode[] = [];
      
      for (let i = 0; i < level; i++) {
        if (parentLines[i]) {
          lines.push(
            <span
              key={`vline-${i}`}
              className="tree-vline"
              style={{
                left: `${i * 20 + 10}px`
              }}
            />
          );
        }
      }
      
      if (level > 0) {
        lines.push(
          <span
            key="connector"
            className={`tree-connector ${isLast ? 'last' : ''}`}
            style={{
              left: `${(level - 1) * 20 + 10}px`
            }}
          />
        );
      }
      
      return lines;
    };

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
            className={`tree-item folder ${isExpanded ? 'expanded' : ''}`}
            style={{ paddingLeft: `${level * 20 + 24}px` }}
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
            {renderTreeLines()}
            <span className="folder-icon">
              {isExpanded ? <FolderOpenIcon className="tree-icon" /> : <FolderIcon className="tree-icon" />}
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
          className={`tree-item file ${selectedFile === currentPath ? "selected" : ""}`}
          style={{ paddingLeft: `${level * 20 + 24}px` }}
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
          {renderTreeLines()}
          <span className="file-icon"><FileIcon className="tree-icon" /></span>
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
  });

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
      <TitleBar
        packSize={packSize}
        historySize={historySize}
        showStats={true}
        debugMode={debugMode}
      />
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
          <div className="sidebar-header-left">
            <button className="btn-back" onClick={onClose} title="返回主页">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <h3>文件</h3>
          </div>
          <div className="sidebar-header-right">
            <button
              className={`btn-icon ${language === 'zh' ? 'active' : ''}`}
              onClick={() => {
                const newLang = language === 'en' ? 'zh' : 'en';
                setLanguage(newLang);
                console.log(`[语言切换] 切换到${newLang === 'zh' ? '中文' : '英文'}模式`);
              }}
              title={language === 'en' ? '切换到中文' : '切换到英文'}
              style={{
                fontWeight: 600,
                fontSize: '0.85rem',
                minWidth: '32px'
              }}
            >
              {language === 'en' ? '英' : '中'}
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowSearchModal(true)}
              title="搜索 (Ctrl+F)"
            >
              <SearchIcon className="tree-icon" />
            </button>
            <button className="btn-icon" onClick={refreshFileTree} title="刷新">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>
            <button className="btn-icon" onClick={() => setIsSidebarOpen(false)} title="收起侧边栏">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 12L18 18"/>
              </svg>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6L18 12L6 18"/>
              </svg>
            </button>
          )}
          <div className="editor-tabs" ref={tabsContainerRef}>
            {openTabs.map((tab, index) => (
              <div
                key={tab.path}
                className={`editor-tab ${index === activeTabIndex ? 'active' : ''}`}
                onClick={() => setActiveTabIndex(index)}
                onMouseDown={(e) => {
                  // 鼠标中键(滚轮按钮)关闭标签
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(index);
                  }
                }}
              >
                <span>{tab.isDirty ? '● ' : ''}{tab.path.split('/').pop() || '未命名'}</span>
                <button className="tab-close" onClick={(e) => closeTab(index, e)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
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
              console.error('搜索失败:', error);
              alert(`搜索失败: ${error}`);
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
                <span className="menu-icon"><NewFileIcon /></span>
                <span>新建文件</span>
                <span className="menu-shortcut">Ctrl+N</span>
              </div>
              <div className="context-menu-item" onClick={() => handleMenuAction('newFolder')}>
                <span className="menu-icon"><NewFolderIcon /></span>
                <span>新建文件夹</span>
              </div>
              <div className="context-menu-item" onClick={() => handleMenuAction('newPng')}>
                <span className="menu-icon"><ImageIcon /></span>
                <span>新增PNG图片</span>
              </div>
              <div className="context-menu-divider"></div>
            </>
          )}
          <div className="context-menu-item" onClick={() => handleMenuAction('rename')}>
            <span className="menu-icon"><RenameIcon /></span>
            <span>重命名</span>
            <span className="menu-shortcut">F2</span>
          </div>
          <div className="context-menu-item" onClick={() => handleMenuAction('copy')}>
            <span className="menu-icon"><CopyIcon /></span>
            <span>复制</span>
            <span className="menu-shortcut">Ctrl+C</span>
          </div>
          {contextMenu.type === 'folder' && (
            <div className="context-menu-item" onClick={() => handleMenuAction('paste')}>
              <span className="menu-icon"><PasteIcon /></span>
              <span>粘贴</span>
              <span className="menu-shortcut">Ctrl+V</span>
            </div>
          )}
          <div className="context-menu-divider"></div>
          <div className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
            <span className="menu-icon"><DeleteIcon /></span>
            <span>删除</span>
            <span className="menu-shortcut">Delete</span>
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
                <img src="/src/assets/brush.svg" alt="毛刷笔" width="24" height="24" />
                <span>毛刷笔</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'pencil' ? 'active' : ''}`}
                onClick={() => toggleTool('pencil')}
                onContextMenu={(e) => handleToolContextMenu(e, 'pencil')}
                title="铅笔 (右键调整大小)"
              >
                <img src="/src/assets/pencil.svg" alt="铅笔" width="24" height="24" />
                <span>铅笔</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'eraser' ? 'active' : ''}`}
                onClick={() => toggleTool('eraser')}
                onContextMenu={(e) => handleToolContextMenu(e, 'eraser')}
                title="橡皮 (右键调整大小)"
              >
                <img src="/src/assets/eraser.svg" alt="橡皮" width="24" height="24" />
                <span>橡皮</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'move' ? 'active' : ''}`}
                onClick={() => toggleTool('move')}
                title="移动工具"
              >
                <img src="/src/assets/move.svg" alt="移动工具" width="24" height="24" />
                <span>移动工具</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'selection' ? 'active' : ''}`}
                onClick={() => toggleTool('selection')}
                title="选区工具 (左键选择，右键切换模式)"
              >
                <img src="/src/assets/pen-tool.svg" alt="选区工具" width="24" height="24" />
                <span>选区工具</span>
              </button>
              <button
                className={`tool-grid-btn ${selectedTool === 'eyedropper' ? 'active' : ''}`}
                onClick={() => toggleTool('eyedropper')}
                title="取色管工具"
              >
                <img src="/src/assets/coloize.svg" alt="取色管工具" width="24" height="24" />
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
    </>
  );
}