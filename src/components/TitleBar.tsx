import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useState, useEffect } from 'react';
import './TitleBar.css';
import logoImg from '../assets/logo.png';

interface TitleBarProps {
  packSize?: number;      // 材质包大小
  historySize?: number;   // 历史记录大小
  showStats?: boolean;    // 是否显示统计信息
  debugMode?: boolean;    // 是否启用调试模式
}

const TitleBar = ({ packSize = 0, historySize = 0, showStats = false, debugMode = false }: TitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<any>(null);

  useEffect(() => {
    // 延迟获取window对象 确保始化
    const initWindow = async () => {
      try {
        const win = getCurrentWindow();
        setAppWindow(win);
      } catch (error) {
        console.error('Failed to get current window:', error);
      }
    };
    initWindow();
  }, []);

  const DebugIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
      <path d="M10 11C10 10.4477 10.4477 10 11 10H13C13.5523 10 14 10.4477 14 11C14 11.5523 13.5523 12 13 12H11C10.4477 12 10 11.5523 10 11Z" fill="currentColor"/>
      <path d="M11 14C10.4477 14 10 14.4477 10 15C10 15.5523 10.4477 16 11 16H13C13.5523 16 14 15.5523 14 15C14 14.4477 13.5523 14 13 14H11Z" fill="currentColor"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M9.09447 4.74918C8.41606 4.03243 8 3.0648 8 2H10C10 3.10457 10.8954 4 12 4C13.1046 4 14 3.10457 14 2H16C16 3.0648 15.5839 4.03243 14.9055 4.74918C16.1782 5.45491 17.1673 6.6099 17.6586 8H19C19.5523 8 20 8.44772 20 9C20 9.55229 19.5523 10 19 10H18V12H19C19.5523 12 20 12.4477 20 13C20 13.5523 19.5523 14 19 14H18V16H19C19.5523 16 20 16.4477 20 17C20 17.5523 19.5523 18 19 18H17.6586C16.8349 20.3304 14.6124 22 12 22C9.38756 22 7.16508 20.3304 6.34141 18H5C4.44772 18 4 17.5523 4 17C4 16.4477 4.44772 16 5 16H6V14H5C4.44772 14 4 13.5523 4 13C4 12.4477 4.44772 12 5 12H6V10H5C4.44772 10 4 9.55229 4 9C4 8.44772 4.44772 8 5 8H6.34141C6.83274 6.6099 7.82181 5.45491 9.09447 4.74918ZM8 16V10C8 7.79086 9.79086 6 12 6C14.2091 6 16 7.79086 16 10V16C16 18.2091 14.2091 20 12 20C9.79086 20 8 18.2091 8 16Z" fill="currentColor"/>
    </svg>
  );

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  useEffect(() => {
    if (!appWindow) return;

    const checkMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);
      } catch (error) {
        console.error('Failed to check maximized state:', error);
      }
    };

    checkMaximized();

    // 监听窗口状态变化
    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then((fn: any) => fn());
    };
  }, [appWindow]);

  const handleMinimize = async () => {
    if (!appWindow) return;
    try {
      await appWindow.minimize();
    } catch (error) {
      console.error('Failed to minimize:', error);
    }
  };

  const handleMaximize = async () => {
    if (!appWindow) return;
    try {
      await appWindow.toggleMaximize();
      // 等待状态更新后再检查
      setTimeout(async () => {
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);
      }, 100);
    } catch (error) {
      console.error('Failed to maximize:', error);
    }
  };

  const handleClose = async () => {
    if (!appWindow) return;
    try {
      await appWindow.close();
    } catch (error) {
      console.error('Failed to close:', error);
    }
  };

  const handleOpenDebugWindow = async () => {
    console.log('[Debug] 点击了debug按钮');
    try {
      try {
        const debugWindow = await WebviewWindow.getByLabel('debug');
        if (debugWindow) {
          console.log('[Debug] 找到已存在的窗口，聚焦');
          await debugWindow.setFocus();
          return;
        }
      } catch (e) {
        console.log('[Debug] 窗口不存在，准备创建新窗口');
      }

      console.log('[Debug] 开始创建debug窗口');
      const debugWindow = new WebviewWindow('debug', {
        url: 'debug.html',
        title: 'Debug Console',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
        decorations: true,
        transparent: false,
      });

      console.log('[Debug] 窗口创建成功');
      
      debugWindow.once('tauri://created', () => {
        console.log('[Debug] 窗口已创建并显示');
      });

      debugWindow.once('tauri://error', (e) => {
        console.error('[Debug] 窗口创建失败:', e);
      });
    } catch (error) {
      console.error('[Debug] Failed to open debug window:', error);
      alert('无法打开调试窗口: ' + error);
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <img src={logoImg} alt="Logo" className="titlebar-icon" />
        <div className="titlebar-text">
          <span className="titlebar-title">
            Minecraft 材质包编辑器
            <span className="pre-release-badge">pre-release</span>
          </span>
          <span className="titlebar-subtitle">Powered By Little_100</span>
        </div>
      </div>
      
      {showStats && (
        <div className="titlebar-center" data-tauri-drag-region>
          <div className="size-stats">
            <span className="stat-item">
              <span className="stat-label">材质包:</span>
              <span className="stat-value">{formatSize(packSize)}</span>
            </span>
            <span className="stat-divider">|</span>
            <span className="stat-item">
              <span className="stat-label">历史记录:</span>
              <span className="stat-value">{formatSize(historySize)}</span>
            </span>
          </div>
        </div>
      )}
      
      <div className="titlebar-controls">
        {debugMode && (
          <button
            className="titlebar-button debug"
            onClick={handleOpenDebugWindow}
            title="打开调试窗口"
          >
            <DebugIcon />
          </button>
        )}
        <button
          className="titlebar-button minimize"
          onClick={handleMinimize}
          title="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="0" y="5" width="12" height="2" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-button maximize"
          onClick={handleMaximize}
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="0" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <rect x="0" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="0" y="0" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
        <button
          className="titlebar-button close"
          onClick={handleClose}
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M0 0 L12 12 M12 0 L0 12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default TitleBar;