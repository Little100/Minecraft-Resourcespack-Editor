interface VersionMap {
  resource_pack: {
    [packFormat: string]: string[];
  };
  last_updated: string;
}

let versionMapCache: VersionMap | null = null;

async function loadVersionMap(): Promise<VersionMap> {
  if (versionMapCache) {
    return versionMapCache;
  }

  try {
    const response = await fetch('/version_map/version_map.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    versionMapCache = await response.json();
    return versionMapCache!;
  } catch (error) {
    console.error('[VersionMap] 加载version_map.json失败:', error);
    throw error;
  }
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
  
  return `${oldestVersion} – ${newestVersion}`;
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
      result.push([packFormat, `${oldestVersion} – ${newestVersion}`]);
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
        result.push([packFormat, `${oldestVersion} – ${newestVersion}`]);
      }
    } else if (releases.length === 1) {
      result.push([packFormat, releases[0]]);
    } else {
      const newestRelease = releases[0];
      const oldestRelease = releases[releases.length - 1];
      result.push([packFormat, `${oldestRelease} – ${newestRelease}`]);
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