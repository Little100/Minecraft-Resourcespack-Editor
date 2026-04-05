import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-shell';
import { useState, useEffect } from 'react';
import './TitleBar.css';
import logoImg from '../assets/logo.png';
import creditsContent from '../../credits.md?raw';
import { manualCheckUpdate } from './UpdateDialog';
import Little100Avatar from '../assets/avatar/Little_100.png';
import Stone926Avatar from '../assets/avatar/stone926.png';
import { Icon, Dialog, useToast } from '@mpe/ui';
import { logger } from '../utils/logger';

interface TitleBarProps {
  packSize?: number;      // 材质包大小
  historySize?: number;   // 历史记录大小
  showStats?: boolean;    // 是否在标题栏中部显示材质包/历史占用
  debugMode?: boolean;    // 是否启用调试模式
}

const TitleBar = ({
  packSize = 0,
  historySize = 0,
  showStats = false,
  debugMode = false,
}: TitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<any>(null);
  const [showCredits, setShowCredits] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // 延迟获取window对象
    const initWindow = async () => {
      try {
        const win = getCurrentWindow();
        setAppWindow(win);
      } catch (error) {
        logger.error('Failed to get current window:', error);
      }
    };
    initWindow();
  }, []);

  // 本地头像映射表（仅用于本地路径，URL 头像直接使用）
  const avatarMap: Record<string, string> = {
    'src/assets/avatar/Little_100.png': Little100Avatar,
    'src/assets/avatar/stone926.png': Stone926Avatar,
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
          // URL 直接使用，本地路径走映射表
          if (avatarPath.startsWith('http://') || avatarPath.startsWith('https://')) {
            currentContributor.avatar = avatarPath;
          } else {
            currentContributor.avatar = avatarMap[avatarPath] || avatarPath;
          }
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
        logger.error('Failed to check maximized state:', error);
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
      logger.error('Failed to minimize:', error);
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
      logger.error('Failed to maximize:', error);
    }
  };

  const handleClose = async () => {
    if (!appWindow) return;
    try {
      await appWindow.close();
    } catch (error) {
      logger.error('Failed to close:', error);
    }
  };

  const statsBlock = (
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
  );

  const handleOpenDebugWindow = async () => {
    logger.debug('[Debug] 点击了debug按钮');
    try {
      try {
        const debugWindow = await WebviewWindow.getByLabel('debug');
        if (debugWindow) {
          logger.debug('[Debug] 找到已存在的窗口，聚焦');
          await debugWindow.setFocus();
          return;
        }
      } catch (e) {
        logger.debug('[Debug] 窗口不存在，准备创建新窗口');
      }

      logger.debug('[Debug] 开始创建debug窗口');
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

      logger.debug('[Debug] 窗口创建成功');
      
      debugWindow.once('tauri://created', () => {
        logger.debug('[Debug] 窗口已创建并显示');
      });

      debugWindow.once('tauri://error', (e) => {
        logger.error('[Debug] 窗口创建失败:', e);
      });
    } catch (error) {
      logger.error('[Debug] Failed to open debug window:', error);
      toast({ message: '无法打开调试窗口: ' + error, type: 'error' });
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
          {statsBlock}
        </div>
      )}
      
      <div className="titlebar-controls">
        <button
          className="titlebar-button update"
          onClick={manualCheckUpdate}
          title="检查更新"
        >
          <Icon name="update" size={24} />
        </button>
        <button
          className="titlebar-button report-issue"
          onClick={async () => {
            try {
              await open('https://github.com/Little100/Minecraft-Resourcespack-Editor/issues');
            } catch (error) {
              logger.error('Failed to open issues page:', error);
            }
          }}
          title="报告问题"
        >
          <Icon name="report-issue" size={20} />
        </button>
        <button
          className="titlebar-button credits"
          onClick={() => setShowCredits(true)}
          title="鸣谢"
        >
          <Icon name="credits" size={20} />
        </button>
        {debugMode && (
          <button
            className="titlebar-button debug"
            onClick={handleOpenDebugWindow}
            title="打开调试窗口"
          >
            <Icon name="debug" size={20} />
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

      {/* 使用 Dialog 组件渲染鸣谢弹窗 */}
      <Dialog
        open={showCredits}
        onClose={() => setShowCredits(false)}
        title="鸣谢"
        size="md"
        animation="scale"
      >
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
                    logger.error('Failed to open link:', error);
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
      </Dialog>
    </div>
  );
};

export default TitleBar;