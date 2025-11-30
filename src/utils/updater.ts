import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

// Gitee API 配置
const GITEE_API_BASE = 'https://gitee.com/api/v5';
const REPO_OWNER = 'little_100';
const REPO_NAME = 'minecraft-resourcespack-editor';
const CHANGELOG_RAW_URL = 'https://gitee.com/little_100/minecraft-resourcespack-editor/raw/main/CHANGELOG.md';

// 当前版本
const CURRENT_VERSION = '0.1.4';

interface GiteeRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  created_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '');
  const clean2 = v2.replace(/^v/, '');
  
  const parts1 = clean1.split('.').map(Number);
  const parts2 = clean2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
}

async function fetchLatestRelease(): Promise<GiteeRelease | null> {
  try {
    const response = await fetch(
      `${GITEE_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data: GiteeRelease = await response.json();
    return data;
  } catch (error) {
    console.error('获取最新版本失败:', error);
    return null;
  }
}

async function fetchChangelog(): Promise<string | null> {
  try {
    const changelog = await invoke<string>('fetch_url', { url: CHANGELOG_RAW_URL });
    return changelog;
  } catch (error) {
    console.error('获取 CHANGELOG 失败:', error);
    try {
      const response = await fetch(CHANGELOG_RAW_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text;
    } catch (fetchError) {
      console.error('浏览器 fetch 也失败:', fetchError);
      return null;
    }
  }
}

function showChangelogModal(changelog: string, latestVersion?: string) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0);
    backdrop-filter: blur(0px);
    -webkit-backdrop-filter: blur(0px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.3s ease, backdrop-filter 0.3s ease;
  `;
  
  requestAnimationFrame(() => {
    overlay.style.background = 'rgba(0, 0, 0, 0.5)';
    overlay.style.backdropFilter = 'blur(10px)';
    (overlay.style as any).webkitBackdropFilter = 'blur(10px)';
  });

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: var(--bg-primary, #ffffff);
    color: var(--text-primary, #000000);
    border-radius: 12px;
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    opacity: 0;
    transform: scale(0.9) translateY(-20px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;
  
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.style.opacity = '1';
      modal.style.transform = 'scale(1) translateY(0)';
    });
  });

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  
  const titleContainer = document.createElement('div');
  titleContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;
  
  const title = document.createElement('h2');
  title.textContent = '更新日志';
  title.style.cssText = `
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  `;
  
  const versionInfo = document.createElement('div');
  const currentVersion = `v${CURRENT_VERSION}`;
  versionInfo.style.cssText = `
    font-size: 13px;
    color: var(--text-secondary, #666666);
    font-family: 'Consolas', 'Monaco', monospace;
  `;
  
  if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
    versionInfo.innerHTML = `
      当前版本: <span style="color: var(--text-primary, #000000);">${currentVersion}</span>
      <span style="margin: 0 8px;">→</span>
      最新版本: <span style="color: #22c55e; font-weight: 600;">${latestVersion}</span>
    `;
  } else {
    versionInfo.innerHTML = `当前版本: <span style="color: var(--text-primary, #000000);">${currentVersion}</span>`;
  }
  
  titleContainer.appendChild(title);
  titleContainer.appendChild(versionInfo);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = 'x';
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: var(--text-secondary, #666666);
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  `;
  closeBtn.onmouseover = () => {
    closeBtn.style.background = 'var(--hover-bg, #f0f0f0)';
  };
  closeBtn.onmouseout = () => {
    closeBtn.style.background = 'none';
  };
  closeBtn.onclick = () => {
    modal.style.opacity = '0';
    modal.style.transform = 'scale(0.9) translateY(-20px)';
    overlay.style.background = 'rgba(0, 0, 0, 0)';
    overlay.style.backdropFilter = 'blur(0px)';
    (overlay.style as any).webkitBackdropFilter = 'blur(0px)';
    
    setTimeout(() => {
      document.body.removeChild(overlay);
    }, 300);
  };

  header.appendChild(titleContainer);
  header.appendChild(closeBtn);

  // 创建内容
  const content = document.createElement('div');
  content.style.cssText = `
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.3;
  `;

  // 简单的麻蛋渲染
  const renderMarkdown = (md: string) => {
    md = md.replace(/##\s*\[未发布\][\s\S]*?(?=##\s*\[[\d.]+\]|$)/i, '');
    
    // 分割成行处理
    const lines = md.split('\n');
    let html = '';
    let inList = false;
    let skipFirstH1 = true; // 跳过第一个 "# 更新日志" 标题
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // 标题
      if (trimmed.startsWith('### ')) {
        if (inList) { html += '</ul>'; inList = false; }
        let text = trimmed.substring(4);
        text = processInlineMarkdown(text);
        html += `<h3 style="margin-top: 12px; margin-bottom: 6px; font-size: 15px; font-weight: 600;">${text}</h3>`;
      } else if (trimmed.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        let text = trimmed.substring(3);
        text = processInlineMarkdown(text);
        html += `<h2 style="margin-top: 14px; margin-bottom: 7px; font-size: 16px; font-weight: 600;">${text}</h2>`;
      } else if (trimmed.startsWith('# ')) {
        if (inList) { html += '</ul>'; inList = false; }
        if (skipFirstH1) {
          skipFirstH1 = false;
          continue;
        }
        let text = trimmed.substring(2);
        text = processInlineMarkdown(text);
        html += `<h1 style="margin-top: 16px; margin-bottom: 8px; font-size: 17px; font-weight: 700;">${text}</h1>`;
      }
      // 列表项
      else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          html += '<ul style="margin: 2px 0; padding-left: 20px;">';
          inList = true;
        }
        let text = trimmed.substring(2);
        text = processInlineMarkdown(text);
        html += `<li style="margin: 1px 0;">${text}</li>`;
      }
      // 普通文本
      else if (trimmed.length > 0) {
        if (inList) { html += '</ul>'; inList = false; }
        let text = trimmed;
        text = processInlineMarkdown(text);
        html += `<p style="margin: 2px 0;">${text}</p>`;
      }
      // 空行
      else {
        if (inList) { html += '</ul>'; inList = false; }
      }
    }
    
    if (inList) { html += '</ul>'; }
    
    return html;
  };

  function processInlineMarkdown(text: string): string {
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: var(--link-color, #0066cc); text-decoration: underline;">$1</a>');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code style="background: var(--code-bg, #f5f5f5); padding: 1px 3px; border-radius: 2px; font-family: monospace; font-size: 0.9em;">$1</code>');
    return text;
  }

  content.innerHTML = renderMarkdown(changelog);

  modal.appendChild(header);
  modal.appendChild(content);
  overlay.appendChild(modal);

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      // 关闭动画
      modal.style.opacity = '0';
      modal.style.transform = 'scale(0.9) translateY(-20px)';
      overlay.style.background = 'rgba(0, 0, 0, 0)';
      overlay.style.backdropFilter = 'blur(0px)';
      (overlay.style as any).webkitBackdropFilter = 'blur(0px)';
      
      // 动画结束后移除元素
      setTimeout(() => {
        document.body.removeChild(overlay);
      }, 300);
    }
  };

  document.body.appendChild(overlay);
}

export async function checkForUpdates(): Promise<boolean> {
  try {
    console.log('正在检查更新...');
    const latestRelease = await fetchLatestRelease();
    
    if (!latestRelease) {
      console.log('无法获取最新版本信息');
      return false;
    }
    
    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;
    
    console.log(`当前版本: ${currentVersion}`);
    console.log(`最新版本: ${latestVersion}`);
    
    // 比较版本号
    if (compareVersions(latestVersion, currentVersion) > 0) {
      console.log(`发现新版本: ${latestVersion}`);
      
      const windowsAsset = latestRelease.assets.find(
        asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
      );
      
      const message = `发现新版本 ${latestVersion}\n\n更新内容:\n${latestRelease.body}\n\n点击"确定"前往下载页面`;
      
      const shouldUpdate = confirm(message);
      
      if (shouldUpdate) {
        // 打开下载页面
        if (windowsAsset) {
          await open(windowsAsset.browser_download_url);
        } else {
          await open(`https://gitee.com/${REPO_OWNER}/${REPO_NAME}/releases/${latestVersion}`);
        }
        return true;
      }
    } else {
      console.log('当前已是最新版本');
    }
    
    return false;
  } catch (error) {
    console.error('检查更新失败:', error);
    return false;
  }
}

export async function checkForUpdatesSilent() {
  try {
    const latestRelease = await fetchLatestRelease();
    
    if (!latestRelease) {
      return {
        available: false,
        error: '无法获取最新版本信息',
      };
    }
    
    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;
    
    if (compareVersions(latestVersion, currentVersion) > 0) {
      return {
        available: true,
        version: latestVersion,
        currentVersion: currentVersion,
        body: latestRelease.body,
        date: latestRelease.created_at,
        downloadUrl: latestRelease.assets.find(
          asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
        )?.browser_download_url,
      };
    }
    
    return {
      available: false,
    };
  } catch (error) {
    console.error('检查更新失败:', error);
    return {
      available: false,
      error: String(error),
    };
  }
}

export async function manualCheckUpdate() {
  try {
    const latestRelease = await fetchLatestRelease();
    
    if (!latestRelease) {
      alert('无法获取最新版本信息，请检查网络连接');
      return;
    }
    
    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;
    
    if (compareVersions(latestVersion, currentVersion) > 0) {
      const windowsAsset = latestRelease.assets.find(
        asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
      );
      
      const message = `发现新版本 ${latestVersion}\n\n更新内容:\n${latestRelease.body}\n\n点击"确定"前往下载页面，点击"取消"查看完整更新日志`;
      
      const shouldDownload = confirm(message);
      
      if (shouldDownload) {
        if (windowsAsset) {
          await open(windowsAsset.browser_download_url);
        } else {
          await open(`https://gitee.com/${REPO_OWNER}/${REPO_NAME}/releases/${latestVersion}`);
        }
      } else {
        const changelog = await fetchChangelog();
        if (changelog) {
          showChangelogModal(changelog, latestVersion);
        } else {
          alert('无法获取更新日志');
        }
      }
    } else {
      const changelog = await fetchChangelog();
      if (changelog) {
        showChangelogModal(changelog, latestVersion);
      } else {
        alert('无法获取更新日志');
      }
    }
  } catch (error) {
    console.error('更新失败:', error);
    alert(`检查更新失败: ${error}`);
  }
}