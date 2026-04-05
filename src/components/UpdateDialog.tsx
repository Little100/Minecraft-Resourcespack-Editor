import { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../utils/logger';
import './UpdateDialog.css';

const GITEE_API_BASE = 'https://gitee.com/api/v5';
const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'little_100';
const REPO_NAME = 'minecraft-resourcespack-editor';
const GITHUB_OWNER = 'Little100';
const GITHUB_REPO_NAME = 'Minecraft-Resourcespack-Editor';
const CHANGELOG_RAW_URL = 'https://gitee.com/little_100/minecraft-resourcespack-editor/raw/main/CHANGELOG.md';
const CURRENT_VERSION = '0.1.6';

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

interface GithubRelease {
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

type Release = GiteeRelease | GithubRelease;

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

async function fetchLatestRelease(): Promise<Release | null> {
  try {
    const response = await fetch(
      `${GITEE_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
    );
    if (response.ok) {
      return await response.json();
    }
    if (response.status === 403 || response.status === 404) {
      logger.warn(`[Update] Gitee API 返回 ${response.status}，尝试从 GitHub 获取`);
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    logger.warn('[Update] Gitee 获取失败，尝试 GitHub fallback:', error);
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'MinecraftPackEditor'
        }
      }
    );
    if (!response.ok) throw new Error(`GitHub HTTP error! status: ${response.status}`);
    const data: GithubRelease = await response.json();
    return data;
  } catch (error) {
    logger.error('获取最新版本失败:', error);
    return null;
  }
}

async function fetchChangelog(): Promise<string | null> {
  try {
    const changelog = await invoke<string>('fetch_url', { url: CHANGELOG_RAW_URL });
    return typeof changelog === 'string' ? changelog : (changelog as any)?.body ?? null;
  } catch {
    try {
      const response = await fetch(CHANGELOG_RAW_URL);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.text();
    } catch {
      return null;
    }
  }
}

function processInlineMarkdown(text: string): string {
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

function renderMarkdown(md: string): string {
  md = md.replace(/##\s*\[未发布\][\s\S]*?(?=##\s*\[[\d.]+\]|$)/i, '');
  md = md.replace(/^#\s*更新日志\s*\n*/i, '');
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let skipFirstH1 = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3 class="changelog-h3">${processInlineMarkdown(trimmed.substring(4))}</h3>`;
    } else if (trimmed.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 class="changelog-h2">${processInlineMarkdown(trimmed.substring(3))}</h2>`;
    } else if (trimmed.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      if (skipFirstH1) { skipFirstH1 = false; continue; }
      html += `<h1 class="changelog-h1">${processInlineMarkdown(trimmed.substring(2))}</h1>`;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul class="changelog-list">'; inList = true; }
      html += `<li>${processInlineMarkdown(trimmed.substring(2))}</li>`;
    } else if (trimmed.length > 0) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p class="changelog-p">${processInlineMarkdown(trimmed)}</p>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function ModalOverlay({ visible, onClose, children, maxWidth = '500px' }: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setAnimating(true));
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    setAnimating(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      className={`update-overlay ${animating ? 'visible' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className={`update-modal ${animating ? 'visible' : ''}`} style={{ maxWidth }}>
        {typeof children === 'function' ? (children as any)(handleClose) : children}
      </div>
    </div>
  );
}

function UpdateDialogContent({ version, body, downloadUrl, showChangelogButton, onClose }: {
  version: string;
  body: string;
  downloadUrl?: string;
  showChangelogButton?: boolean;
  onClose: () => void;
}) {
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);

  const handleViewChangelog = async () => {
    onClose();
    const cl = await fetchChangelog();
    if (cl) {
      setChangelog(cl);
      setShowChangelog(true);
    }
  };

  const handleDownload = async () => {
    onClose();
    const url = downloadUrl || `https://gitee.com/${REPO_OWNER}/${REPO_NAME}/releases/${version}`;
    await open(url);
  };

  return (
    <>
      <div className="update-header">
        <h2 className="update-title">发现新版本</h2>
        <div className="update-version-info">
          当前版本: <span className="current-version">v{CURRENT_VERSION}</span>
          <span className="version-arrow">→</span>
          最新版本: <span className="latest-version">{version}</span>
        </div>
      </div>
      <div className="update-content">
        <h3 className="update-content-title">更新内容:</h3>
        <div className="update-body">{body || '暂无更新说明'}</div>
      </div>
      <div className="update-footer">
        {showChangelogButton && (
          <button className="btn-secondary" onClick={handleViewChangelog}>
            查看完整更新日志
          </button>
        )}
        <button className="btn-secondary" onClick={onClose}>稍后提醒</button>
        <button className="btn-primary" onClick={handleDownload}>前往下载</button>
      </div>
      {showChangelog && changelog && (
        <ChangelogDialog
          changelog={changelog}
          latestVersion={version}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}

function ErrorDialogContent({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <>
      <div className="update-header">
        <h2 className="update-title">提示</h2>
      </div>
      <div className="update-content">
        <p>{message}</p>
      </div>
      <div className="update-footer">
        <button className="btn-primary" onClick={onClose}>确定</button>
      </div>
    </>
  );
}

function ChangelogDialog({ changelog, latestVersion, onClose }: {
  changelog: string;
  latestVersion?: string;
  onClose: () => void;
}) {
  const currentVersion = `v${CURRENT_VERSION}`;
  const hasNewVersion = latestVersion && compareVersions(latestVersion, currentVersion) > 0;

  return (
    <ModalOverlay visible onClose={onClose} maxWidth="800px">
      <div className="update-header changelog-header">
        <div>
          <h2 className="update-title">更新日志</h2>
          <div className="update-version-info mono">
            {hasNewVersion ? (
              <>
                当前版本: <span className="current-version">{currentVersion}</span>
                <span className="version-arrow">→</span>
                最新版本: <span className="latest-version">{latestVersion}</span>
              </>
            ) : (
              <>当前版本: <span className="current-version">{currentVersion}</span></>
            )}
          </div>
        </div>
        <button className="btn-close" onClick={onClose}>×</button>
      </div>
      <div
        className="update-content changelog-content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(changelog) }}
      />
    </ModalOverlay>
  );
}

type DialogState =
  | { type: 'none' }
  | { type: 'update'; version: string; body: string; downloadUrl?: string; showChangelogButton?: boolean }
  | { type: 'error'; message: string }
  | { type: 'changelog'; changelog: string; latestVersion?: string };

let setGlobalDialog: ((state: DialogState) => void) | null = null;

export function UpdateDialogProvider() {
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });

  useEffect(() => {
    setGlobalDialog = setDialog;
    return () => { setGlobalDialog = null; };
  }, []);

  const close = useCallback(() => setDialog({ type: 'none' }), []);

  if (dialog.type === 'none') return null;

  const maxWidth = dialog.type === 'changelog' ? '800px' : dialog.type === 'error' ? '400px' : '500px';

  return (
    <ModalOverlay visible onClose={close} maxWidth={maxWidth}>
      {dialog.type === 'update' && (
        <UpdateDialogContent
          version={dialog.version}
          body={dialog.body}
          downloadUrl={dialog.downloadUrl}
          showChangelogButton={dialog.showChangelogButton}
          onClose={close}
        />
      )}
      {dialog.type === 'error' && (
        <ErrorDialogContent message={dialog.message} onClose={close} />
      )}
      {dialog.type === 'changelog' && (
        <ChangelogDialog
          changelog={dialog.changelog}
          latestVersion={dialog.latestVersion}
          onClose={close}
        />
      )}
    </ModalOverlay>
  );
}

function showUpdateDialog(version: string, body: string, downloadUrl?: string, showChangelogButton: boolean = false) {
  setGlobalDialog?.({ type: 'update', version, body, downloadUrl, showChangelogButton });
}

function showErrorDialog(message: string) {
  setGlobalDialog?.({ type: 'error', message });
}

function showChangelogModal(changelog: string, latestVersion?: string) {
  setGlobalDialog?.({ type: 'changelog', changelog, latestVersion });
}

export async function checkForUpdates(): Promise<boolean> {
  try {
    const latestRelease = await fetchLatestRelease();
    if (!latestRelease) return false;

    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      const windowsAsset = latestRelease.assets.find(
        asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
      );
      showUpdateDialog(latestVersion, latestRelease.body, windowsAsset?.browser_download_url);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('检查更新失败:', error);
    return false;
  }
}

export async function checkForUpdatesSilent() {
  try {
    const latestRelease = await fetchLatestRelease();
    if (!latestRelease) return { available: false, error: '无法获取最新版本信息' };

    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      return {
        available: true,
        version: latestVersion,
        currentVersion,
        body: latestRelease.body,
        date: latestRelease.created_at,
        downloadUrl: latestRelease.assets.find(
          asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
        )?.browser_download_url,
      };
    }
    return { available: false };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

export async function manualCheckUpdate() {
  try {
    const latestRelease = await fetchLatestRelease();
    if (!latestRelease) {
      showErrorDialog('无法获取最新版本信息，请检查网络连接');
      return;
    }

    const latestVersion = latestRelease.tag_name;
    const currentVersion = `v${CURRENT_VERSION}`;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      const windowsAsset = latestRelease.assets.find(
        asset => asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
      );
      showUpdateDialog(latestVersion, latestRelease.body, windowsAsset?.browser_download_url, true);
    } else {
      const changelog = await fetchChangelog();
      if (changelog) {
        showChangelogModal(changelog, currentVersion);
      } else {
        showErrorDialog('无法获取更新日志');
      }
    }
  } catch (error) {
    showErrorDialog(`检查更新失败: ${error}`);
  }
}
