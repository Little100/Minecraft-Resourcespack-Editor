import CreatePackModal from "./components/CreatePackModal";
import TitleBar from "./components/TitleBar";
import PackEditor from "./components/PackEditor";
import { useState, useEffect } from "react";
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
} from "./utils/tauri-api";
import type { PackInfo, ResourceType } from "./types/pack";
import { VERSION_DESCRIPTIONS, RESOURCE_TYPE_NAMES } from "./types/pack";
import grassBlockImg from "./assets/grass-block.png";
import avatarImg from "./assets/ava.jpg";
import { open } from '@tauri-apps/plugin-shell';
import { checkForUpdates } from "./utils/updater";

type Theme = "light" | "dark" | "system";
type WebService = "off" | "lan" | "all";

// Icons
const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
);
const FeaturesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
);
const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 174.248 174.248" fill="currentColor">
    <path d="M173.145,73.91c-0.413-2.722-2.29-4.993-4.881-5.912l-13.727-4.881c-0.812-2.3-1.733-4.536-2.754-6.699l6.247-13.146 c1.179-2.479,0.899-5.411-0.729-7.628c-5.265-7.161-11.556-13.452-18.698-18.693c-2.219-1.629-5.141-1.906-7.625-0.724 l-13.138,6.242c-2.163-1.021-4.402-1.94-6.704-2.752l-4.883-13.729c-0.919-2.586-3.184-4.458-5.9-4.876 c-9.65-1.483-16.792-1.483-26.457,0c-2.713,0.418-4.981,2.29-5.9,4.876l-4.883,13.729c-2.302,0.812-4.541,1.731-6.702,2.752 l-13.143-6.242c-2.479-1.181-5.406-0.904-7.623,0.724c-7.142,5.241-13.433,11.532-18.698,18.693 c-1.629,2.217-1.908,5.148-0.729,7.628l6.247,13.146c-1.021,2.159-1.94,4.4-2.754,6.699L5.982,68.003 c-2.589,0.919-4.463,3.189-4.879,5.907c-0.749,4.92-1.099,9.115-1.099,13.219c0,4.098,0.35,8.299,1.099,13.219 c0.413,2.722,2.29,4.993,4.881,5.912l13.727,4.881c0.814,2.304,1.736,4.541,2.754,6.704l-6.247,13.141 c-1.179,2.479-0.899,5.411,0.727,7.623c5.258,7.156,11.549,13.447,18.7,18.698c2.217,1.629,5.144,1.911,7.625,0.724l13.138-6.242 c2.163,1.021,4.402,1.94,6.704,2.752l4.883,13.729c0.919,2.586,3.184,4.458,5.9,4.876c4.828,0.744,9.154,1.104,13.228,1.104 c4.074,0,8.401-0.36,13.228-1.104c2.715-0.418,4.981-2.29,5.9-4.876l4.883-13.729c2.302-0.812,4.541-1.731,6.704-2.752 l13.138,6.242c2.484,1.186,5.411,0.904,7.628-0.724c7.159-5.26,13.45-11.551,18.698-18.698c1.626-2.212,1.906-5.144,0.727-7.623 l-6.247-13.141c1.021-2.163,1.942-4.405,2.754-6.704l13.727-4.881c2.591-0.919,4.468-3.189,4.881-5.912 c0.749-4.92,1.099-9.12,1.099-13.219S173.894,78.829,173.145,73.91z M158.949,93.72l-12.878,4.58 c-2.251,0.797-3.982,2.625-4.66,4.92c-1.15,3.889-2.664,7.569-4.504,10.943c-1.142,2.1-1.213,4.619-0.187,6.777l5.841,12.285 c-2.822,3.389-5.943,6.515-9.337,9.334l-12.283-5.834c-2.161-1.036-4.672-0.953-6.775,0.185c-3.379,1.838-7.061,3.35-10.953,4.502 c-2.29,0.676-4.118,2.406-4.917,4.657l-4.582,12.883c-4.677,0.476-8.503,0.476-13.18,0l-4.582-12.883 c-0.8-2.246-2.628-3.982-4.917-4.657c-3.894-1.152-7.579-2.664-10.953-4.502c-2.103-1.147-4.619-1.22-6.775-0.185l-12.283,5.839 c-3.391-2.825-6.512-5.946-9.337-9.339l5.841-12.285c1.026-2.159,0.955-4.677-0.187-6.777c-1.835-3.364-3.35-7.049-4.504-10.948 c-0.678-2.29-2.411-4.118-4.66-4.915l-12.878-4.58c-0.243-2.343-0.36-4.502-0.36-6.592s0.117-4.244,0.36-6.587l12.881-4.584 c2.248-0.797,3.979-2.625,4.657-4.915c1.152-3.889,2.667-7.574,4.504-10.953c1.142-2.095,1.213-4.619,0.187-6.772l-5.841-12.285 c2.827-3.393,5.948-6.519,9.337-9.339l12.288,5.839c2.151,1.036,4.677,0.953,6.775-0.185c3.372-1.838,7.054-3.35,10.948-4.502 c2.29-0.676,4.118-2.411,4.917-4.657l4.582-12.883c4.633-0.481,8.466-0.481,13.18,0l4.582,12.883 c0.8,2.246,2.628,3.982,4.917,4.657c3.894,1.152,7.579,2.664,10.953,4.502c2.103,1.147,4.614,1.22,6.775,0.185l12.283-5.839 c3.389,2.82,6.51,5.946,9.337,9.339l-5.841,12.285c-1.026,2.154-0.955,4.677,0.187,6.772c1.843,3.389,3.357,7.069,4.504,10.948 c0.678,2.295,2.409,4.123,4.66,4.92l12.878,4.58c0.243,2.343,0.36,4.502,0.36,6.592S159.192,91.377,158.949,93.72z"/>
    <path d="M87.124,50.802c-19.062,0-34.571,15.508-34.571,34.571s15.508,34.571,34.571,34.571s34.571-15.508,34.571-34.571 S106.186,50.802,87.124,50.802z M87.124,105.009c-10.827,0-19.636-8.809-19.636-19.636s8.809-19.636,19.636-19.636 s19.636,8.809,19.636,19.636S97.951,105.009,87.124,105.009z"/>
  </svg>
);
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
);
const ZipIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
);
const MergeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg>
);
const CreateIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
);
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);
const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
);
const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
);
const BilibiliIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"></path></svg>
);
const GithubIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path></svg>
);

function App() {
  const [packInfo, setPackInfo] = useState<PackInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceType, setSelectedResourceType] = useState<ResourceType | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  // 从 localStorage 加载设置
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
      port: savedPort || '3000',
      acrylicEffect: savedAcrylic === null ? true : savedAcrylic === 'true',
      historyEnabled: savedHistoryEnabled === null ? true : savedHistoryEnabled === 'true',
      maxHistoryCount: savedMaxHistoryCount ? parseInt(savedMaxHistoryCount) : 30,
      templateCacheEnabled: savedTemplateCacheEnabled === 'true',
      debugMode: savedDebugMode === 'true',
    };
  };

  const settings = loadSettings();
  const [theme, setTheme] = useState<Theme>(settings.theme);
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
        console.error('Failed to load system fonts:', error);
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

  const handleImportZip = async () => {
    try {
      setLoading(true);
      setError(null);
      const zipPath = await selectZipFile();
      if (zipPath) {
        const info = await importPackZip(zipPath);
        setPackInfo(info);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleImportFolder = async () => {
    try {
      setLoading(true);
      setError(null);
      const folderPath = await selectFolder();
      if (folderPath) {
        console.log('Selected folder:', folderPath);
        
        // 检查是否有pack.mcmeta
        const hasMcmeta = await checkPackMcmeta(folderPath);
        
        if (!hasMcmeta) {
          // 没有 显示确认对话框
          setPendingFolderPath(folderPath);
          setShowConfirmDialog(true);
          setLoading(false);
        } else {
          // 有 导入
          const info = await importPackFolder(folderPath);
          console.log('Pack info:', info);
          setPackInfo(info);
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error('Import folder error:', err);
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
      console.log('Pack info:', info);
      setPackInfo(info);
      setPendingFolderPath(null);
    } catch (err) {
      console.error('Import folder error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelImport = () => {
    setShowConfirmDialog(false);
    setPendingFolderPath(null);
  };

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);
      const outputPath = await selectFolder();
      if (outputPath && packInfo) {
        await exportPack(`${outputPath}/${packInfo.name}.zip`);
        alert("材质包导出成功!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const openLink = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      console.error('Failed to open link:', error);
      window.open(url, '_blank');
    }
  };
  
  useEffect(() => {
    const handleWebService = async () => {
      if (webService === 'off') {
        if (serverRunning) {
          try {
            const msg = await stopWebServer();
            setServerMessage(msg);
            setServerRunning(false);
          } catch (err) {
            console.error('Failed to stop server:', err);
          }
        }
      } else {
        if (!serverRunning && packInfo) {
          try {
            const portNum = parseInt(port) || 3000;
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
  }, [webService, port, packInfo, serverRunning]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getServerStatus();
        setServerRunning(status);
      } catch (err) {
        console.error('Failed to check server status:', err);
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
        console.error('检查更新失败:', error);
      }
    };

    checkUpdate();
  }, []);

  if (packInfo) {
    return (
      <div className="app-container">
        <TitleBar showStats={false} debugMode={debugMode} />
        <PackEditor packInfo={packInfo} onClose={() => setPackInfo(null)} debugMode={debugMode} />
      </div>
    );
  }

  return (
    <div className="app-container">
      <TitleBar showStats={false} debugMode={debugMode} />
      <main className="app-main">
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
            <div className="card-icon"><InfoIcon /></div>
            <h3>介绍</h3>
            <p>一个功能强大的 Minecraft 资源包编辑器，支持最新版本的材质包格式，让您轻松创建和编辑资源包。</p>
          </div>
          <div className="info-card">
            <div className="card-icon"><FeaturesIcon /></div>
            <h3>功能</h3>
            <p>支持导入、编辑、合并和导出资源包，提供直观的可视化界面，让资源包制作变得简单高效。</p>
          </div>
          <div className="info-card clickable" onClick={() => setShowSettings(true)}>
            <div className="card-icon"><SettingsIcon /></div>
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
            <div className="action-icon"><FolderIcon /></div>
            <h3>导入文件夹</h3>
            <p>从本地文件夹导入现有的资源包</p>
          </div>
          <div className="action-card" onClick={handleImportZip}>
            <div className="action-icon"><ZipIcon /></div>
            <h3>导入 ZIP 文件</h3>
            <p>从 ZIP 压缩包导入资源包</p>
          </div>
          <div className="action-card">
            <div className="action-icon"><MergeIcon /></div>
            <h3>材质包融合</h3>
            <p>合并多个资源包为一个</p>
          </div>
          <div className="action-card" onClick={() => setShowCreateModal(true)}>
            <div className="action-icon"><CreateIcon /></div>
            <h3>从零开始创作</h3>
            <p>创建全新的资源包项目</p>
          </div>
        </div>

      </main>

      {/* Settings Sidebar */}
      <div className={`settings-sidebar ${showSettings ? 'open' : ''}`}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="close-btn" onClick={() => setShowSettings(false)}>
            <CloseIcon />
          </button>
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
                <SunIcon /> 亮色
              </button>
              <button 
                className={`setting-option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <MoonIcon /> 暗色
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
              <BilibiliIcon />
              <span>Bilibili 页面</span>
            </div>
            <div className="social-card" onClick={() => openLink('https://github.com/little100')}>
              <GithubIcon />
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
          onSuccess={() => {
            setShowCreateModal(false);
          }}
          templateCacheEnabled={templateCacheEnabled}
        />
      )}

      {/* 确认导入对话框 */}
      {showConfirmDialog && (
        <>
          <div className="overlay" onClick={handleCancelImport}></div>
          <div className="confirm-dialog">
            <div className="confirm-dialog-header">
              <h3>️ 缺少 pack.mcmeta 文件</h3>
            </div>
            <div className="confirm-dialog-content">
              <p>所选文件夹中未找到 <code>pack.mcmeta</code> 文件。</p>
              <p>这可能不是一个有效的Minecraft资源包文件夹。</p>
              <p>是否仍要导入此文件夹？</p>
            </div>
            <div className="confirm-dialog-actions">
              <button className="btn-secondary" onClick={handleCancelImport}>
                取消
              </button>
              <button className="btn-primary" onClick={handleConfirmImport}>
                确定导入
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
