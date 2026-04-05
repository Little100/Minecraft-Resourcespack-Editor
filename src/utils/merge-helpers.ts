export function matchesPathPattern(path: string, pattern: string): boolean {
  const pathNorm = path.replace(/\\/g, '/');
  const pat = pattern.trim();
  if (!pat) return false;
  const patNorm = pat.replace(/\\/g, '/');
  if (!patNorm.includes('*')) {
    return pathNorm.includes(patNorm);
  }
  const parts = patNorm.split('*').filter((s) => s.length > 0);
  if (parts.length === 0) return true;
  let idx = 0;
  for (const part of parts) {
    const rest = pathNorm.slice(idx);
    const pos = rest.indexOf(part);
    if (pos < 0) return false;
    idx += pos + part.length;
  }
  return true;
}

export function collectLangKeysForMergePath(relativePath: string): string[] {
  const keys: string[] = [];
  const norm = relativePath.replace(/\\/g, '/');
  const noExt = norm.replace(/\.[^/.]+$/, '');

  const blockM = noExt.match(/assets\/[^/]+\/textures\/block\/(.+)$/i);
  if (blockM) {
    keys.push(`block.minecraft.${blockM[1].replace(/\//g, '.')}`);
  }
  const itemTex = noExt.match(/assets\/[^/]+\/textures\/item\/(.+)$/i);
  if (itemTex) {
    keys.push(`item.minecraft.${itemTex[1].replace(/\//g, '.')}`);
  }
  const itemModel = noExt.match(/assets\/[^/]+\/models\/item\/(.+)$/i);
  if (itemModel) {
    keys.push(`item.minecraft.${itemModel[1].replace(/\//g, '.')}`);
  }
  const blockModel = noExt.match(/assets\/[^/]+\/models\/block\/(.+)$/i);
  if (blockModel) {
    keys.push(`block.minecraft.${blockModel[1].replace(/\//g, '.')}`);
  }

  return keys;
}

export function mergePathMatchesQuery(
  path: string,
  query: string,
  langMap: Record<string, string>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (path.toLowerCase().includes(q)) return true;
  for (const key of collectLangKeysForMergePath(path)) {
    if (key.toLowerCase().includes(q)) return true;
    const zh = langMap[key];
    if (zh && zh.toLowerCase().includes(q)) return true;
  }
  return false;
}
