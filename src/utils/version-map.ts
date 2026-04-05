import { logger } from './logger';

interface VersionMap {
  resource_pack: {
    [packFormat: string]: string[];
  };
  last_updated: string;
}

const GITHUB_PAGES_URL = 'https://raw.githubusercontent.com/Little100/Minecraft-Resourcespack-Editor/main/public/version_map/version_map.json';

const FALLBACK_VERSION_MAP: VersionMap = {
  resource_pack: {
    "1": ["1.8.9", "1.6.1"],
    "2": ["1.10.2", "1.9"],
    "3": ["1.12.2", "1.11"],
    "4": ["1.14.4", "1.13"],
    "5": ["1.16.1", "1.15"],
    "6": ["1.16.5", "1.16.2"],
    "7": ["1.17.1", "1.17"],
    "8": ["1.18.2", "1.18"],
    "9": ["1.19.2", "1.19"],
    "12": ["1.19.3"],
    "13": ["1.19.4"],
    "15": ["1.20.1", "1.20"],
    "18": ["1.20.2"],
    "22": ["1.20.4", "1.20.3"],
    "32": ["1.20.6", "1.20.5"],
    "34": ["1.21.1", "1.21"],
    "42": ["1.21.3", "1.21.2"],
    "46": ["1.21.4"],
    "55": ["1.21.5"],
    "63": ["1.21.6"],
    "64": ["1.21.8", "1.21.7"],
    "69": ["1.21.10", "1.21.9"],
    "75": ["1.21.11"],
    "76": ["26.1-snap1"],
    "77": ["26.1-snap2"],
    "78": ["26.1-snap3"],
    "78.1": ["26.1-snap4"],
    "79": ["26.1-snap5"],
    "80": ["26.1-snap6"],
    "81": ["26.1-snap7"],
    "81.1": ["26.1-snap8", "26.1"],
    "82": ["26.1-snap10"],
    "83": ["26.1-snap11"],
    "84": ["26.1", "26.1 Pre-release"]
  },
  last_updated: "2026-04-05"
};

let versionMapCache: VersionMap | null = null;
let useExternalApi: boolean = false;

interface FetchResult {
  success: boolean;
  data?: VersionMap;
  source: 'external' | 'builtin';
  error?: string;
}

async function checkExternalApiVersion(): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(GITHUB_PAGES_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, source: 'builtin', error: `HTTP ${response.status}` };
    }

    const data: VersionMap = await response.json();

    const formats = Object.keys(data.resource_pack || {}).map(Number).filter(n => !isNaN(n));
    const maxFormat = Math.max(...formats, 0);

    if (maxFormat >= 75 && data.last_updated) {
      logger.info(`[VersionMap] 从 GitHub Pages 获取到版本对照表 (最新: pack_format ${maxFormat}, 更新于 ${data.last_updated})`);
      return { success: true, data, source: 'external' };
    } else {
      logger.warn(`[VersionMap] GitHub Pages 版本对照表不完整 (max: ${maxFormat})，使用内置版本`);
      return { success: false, source: 'builtin', error: '版本不完整' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`[VersionMap] 无法从 GitHub Pages 获取版本对照表: ${errorMessage}，使用内置版本`);
    return { success: false, source: 'builtin', error: errorMessage };
  }
}

async function loadVersionMap(): Promise<VersionMap> {
  if (versionMapCache) {
    return versionMapCache;
  }

  const fetchResult = await checkExternalApiVersion();

  if (fetchResult.success && fetchResult.data) {
    versionMapCache = fetchResult.data;
    useExternalApi = true;
  } else {
    logger.info('[VersionMap] 使用内置版本对照表作为 fallback');
    versionMapCache = FALLBACK_VERSION_MAP;
    useExternalApi = false;
  }

  return versionMapCache;
}

export function getVersionMapSource(): 'external' | 'builtin' {
  return useExternalApi ? 'external' : 'builtin';
}

export function getVersionMapLastUpdated(): string | null {
  return versionMapCache?.last_updated || null;
}

export async function refreshVersionMap(): Promise<void> {
  versionMapCache = null;
  await loadVersionMap();
}

export async function getVersionsByPackFormat(packFormat: number): Promise<string[]> {
  const versionMap = await loadVersionMap();
  return versionMap.resource_pack[packFormat.toString()] || [];
}

export async function getVersionRange(packFormat: number): Promise<string> {
  const versions = await getVersionsByPackFormat(packFormat);
  
  if (versions.length === 0) {
    return '未知版本';
  }
  
  if (versions.length === 1) {
    return versions[0];
  }
  
  const newestVersion = versions[0];
  const oldestVersion = versions[versions.length - 1];
  
  return `${oldestVersion} - ${newestVersion}`;
}

export async function getAllPackFormats(): Promise<Array<[number, string]>> {
  const versionMap = await loadVersionMap();
  
  const result: Array<[number, string]> = [];
  
  for (const [packFormatStr, versions] of Object.entries(versionMap.resource_pack)) {
    const packFormat = parseInt(packFormatStr, 10);
    
    if (versions.length === 1) {
      result.push([packFormat, versions[0]]);
    } else if (versions.length > 1) {
      const newestVersion = versions[0];
      const oldestVersion = versions[versions.length - 1];
      result.push([packFormat, `${oldestVersion} - ${newestVersion}`]);
    }
  }
  
  result.sort((a, b) => a[0] - b[0]);
  
  return result;
}

export async function getAllPackFormatsWithReleases(): Promise<Array<[number, string]>> {
  const versionMap = await loadVersionMap();
  
  const result: Array<[number, string]> = [];
  
  for (const [packFormatStr, versions] of Object.entries(versionMap.resource_pack)) {
    const packFormat = parseInt(packFormatStr, 10);
    
    // 只获取正式版
    const releases = versions.filter(v => isReleaseVersion(v));
    
    if (releases.length === 0) {
      if (versions.length === 1) {
        result.push([packFormat, versions[0]]);
      } else if (versions.length > 1) {
        const newestVersion = versions[0];
        const oldestVersion = versions[versions.length - 1];
        result.push([packFormat, `${oldestVersion} - ${newestVersion}`]);
      }
    } else if (releases.length === 1) {
      result.push([packFormat, releases[0]]);
    } else {
      const newestRelease = releases[0];
      const oldestRelease = releases[releases.length - 1];
      result.push([packFormat, `${oldestRelease} - ${newestRelease}`]);
    }
  }
  
  result.sort((a, b) => a[0] - b[0]);
  
  return result;
}

export async function isVersionInPackFormat(version: string, packFormat: number): Promise<boolean> {
  const versions = await getVersionsByPackFormat(packFormat);
  return versions.includes(version);
}

export function isReleaseVersion(version: string): boolean {
  const releasePattern = /^\d+\.\d+(\.\d+)?$/;
  return releasePattern.test(version);
}

export async function getVersionsWithType(packFormat: number): Promise<{
  releases: string[];
  previews: string[];
  all: string[];
}> {
  const versions = await getVersionsByPackFormat(packFormat);
  
  const releases: string[] = [];
  const previews: string[] = [];
  
  for (const version of versions) {
    if (isReleaseVersion(version)) {
      releases.push(version);
    } else {
      previews.push(version);
    }
  }
  
  return {
    releases,
    previews,
    all: versions
  };
}

export function getFallbackVersionMap(): VersionMap {
  return FALLBACK_VERSION_MAP;
}