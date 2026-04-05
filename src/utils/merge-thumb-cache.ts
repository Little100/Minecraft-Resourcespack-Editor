const MAX_ENTRIES = 256;
const cache = new Map<string, string>();

export function mergeThumbCacheKey(sourcePath: string, sourceType: string, relPath: string): string {
  return `${sourceType}\0${sourcePath}\0${relPath}`;
}

export function getMergeThumbCached(key: string): string | null {
  return cache.get(key) ?? null;
}

export function setMergeThumbCached(key: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, dataUrl);
}
