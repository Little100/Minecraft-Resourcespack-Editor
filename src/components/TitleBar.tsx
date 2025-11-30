import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-shell';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './TitleBar.css';
import logoImg from '../assets/logo.png';
import creditsContent from '../../credits.md?raw';
import { manualCheckUpdate } from '../utils/updater';
import Little100Avatar from '../assets/avatar/Little_100.png';
import LivedInCornerAvatar from '../assets/avatar/LivedInCorner.png';

interface TitleBarProps {
  packSize?: number;      // 材质包大小
  historySize?: number;   // 历史记录大小
  showStats?: boolean;    // 是否显示统计信息
  debugMode?: boolean;    // 是否启用调试模式
}

const TitleBar = ({ packSize = 0, historySize = 0, showStats = false, debugMode = false }: TitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<any>(null);
  const [showCredits, setShowCredits] = useState(false);

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

  const CreditsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" width="20" height="20">
      <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1zm-7.978-1L7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002-.014.002zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0M6.936 9.28a6 6 0 0 0-1.23-.247A7 7 0 0 0 5 9c-4 0-5 3-5 4q0 1 1 1h4.216A2.24 2.24 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816M4.92 10A5.5 5.5 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.275ZM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/>
    </svg>
  );

  const UpdateIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path d="M12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0 2c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm-1-10v4h2v-4h3l-4-4-4 4h3z"/>
    </svg>
  );

  const ReportIssueIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M1.5 4.25c0-.966.784-1.75 1.75-1.75h17.5c.966 0 1.75.784 1.75 1.75v12.5a1.75 1.75 0 0 1-1.75 1.75h-9.586a.25.25 0 0 0-.177.073l-3.5 3.5A1.458 1.458 0 0 1 5 21.043V18.5H3.25a1.75 1.75 0 0 1-1.75-1.75ZM3.25 4a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h2.5a.75.75 0 0 1 .75.75v3.19l3.427-3.427A1.75 1.75 0 0 1 11.164 17h9.586a.25.25 0 0 0 .25-.25V4.25a.25.25 0 0 0-.25-.25ZM12 6a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 12 6Zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
    </svg>
  );

  // 头像映射表
  const avatarMap: Record<string, string> = {
    'src/assets/avatar/Little_100.png': Little100Avatar,
    'src/assets/avatar/LivedInCorner.png': LivedInCornerAvatar,
  };

  // 解析credits.md内容
  const parseCredits = () => {
    const lines = creditsContent.split('\n');
    const contributors: Array<{name: string, link?: string, qq?: string, avatar?: string, role?: string}> = [];
    let currentContributor: any = null;

    lines.forEach(line => {
      const trimmedLine = line.trim();
      
      if (line.startsWith('# ')) {
        if (currentContributor) {
          contributors.push(currentContributor);
        }
        const currentRole = line.substring(2).trim();
        currentContributor = { role: currentRole };
      } else if (trimmedLine.startsWith('- [') && trimmedLine.includes('](')) {
        const match = trimmedLine.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (match && currentContributor) {
          currentContributor.name = match[1];
          currentContributor.link = match[2];
        }
      } else if (trimmedLine.startsWith('- QQ:')) {
        const qq = trimmedLine.split('QQ:')[1]?.trim();
        if (qq && currentContributor) {
          currentContributor.qq = qq;
        }
      } else if (trimmedLine.startsWith('- avatar:')) {
        const avatarPath = trimmedLine.split('avatar:')[1]?.trim();
        if (avatarPath && currentContributor) {
          currentContributor.avatar = avatarMap[avatarPath] || avatarPath;
        }
      }
    });

    if (currentContributor) {
      contributors.push(currentContributor);
    }

    return contributors;
  };

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
        <button
          className="titlebar-button update"
          onClick={manualCheckUpdate}
          title="检查更新"
        >
          <UpdateIcon />
        </button>
        <button
          className="titlebar-button report-issue"
          onClick={async () => {
            try {
              await open('https://github.com/Little100/Minecraft-Resourcespack-Editor/issues');
            } catch (error) {
              console.error('Failed to open issues page:', error);
            }
          }}
          title="报告问题"
        >
          <ReportIssueIcon />
        </button>
        <button
          className="titlebar-button credits"
          onClick={() => setShowCredits(true)}
          title="鸣谢"
        >
          <CreditsIcon />
        </button>
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

      {/* 使用 Portal 将鸣谢弹窗渲染到 body */}
      {showCredits && createPortal(
        <div className="credits-overlay" onClick={() => setShowCredits(false)}>
          <div className="credits-modal" onClick={(e) => e.stopPropagation()}>
            <div className="credits-header">
              <h2>鸣谢</h2>
              <button className="credits-close" onClick={() => setShowCredits(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2 L14 14 M14 2 L2 14" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
            <div className="credits-content">
              {parseCredits().map((contributor, index) => (
                <div
                  key={index}
                  className={`contributor-card ${contributor.link ? 'clickable' : ''}`}
                  onClick={async () => {
                    if (contributor.link) {
                      try {
                        await open(contributor.link);
                      } catch (error) {
                        console.error('Failed to open link:', error);
                      }
                    }
                  }}
                >
                  <div className="contributor-header">
                    {contributor.avatar && (
                      <img src={contributor.avatar} alt={contributor.name} className="contributor-avatar" />
                    )}
                    <div className="contributor-info">
                      <h3 className="contributor-role">{contributor.role}</h3>
                      <span className="contributor-name">{contributor.name}</span>
                      {contributor.qq && (
                        <p className="contributor-qq">QQ: {contributor.qq}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default TitleBar;