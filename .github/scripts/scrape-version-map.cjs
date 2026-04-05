/**
 * 别问我 ai 写的 我不知道
 * Minecraft Resource Pack Format 爬取脚本
 *
 * 从 https://minecraft.wiki/w/Template:Resource_pack_format 爬取版本对照表
 * 生成两个文件：
 *   - version_map.json: 完整的版本对照表（向后兼容）
 *   - version_latest.json: 精简版，仅包含最新版本（轻量级 API）
 *
 * 用法:
 *   node scripts/scrape-version-map.js              # 完整模式
 *   node scripts/scrape-version-map.js --dry-run     # 测试模式（不写入文件）
 *   node scripts/scrape-version-map.js --check       # 仅检查并报告最新版本
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WIKI_URL = 'https://minecraft.wiki/w/Template:Resource_pack_format';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'version_map');
const OUTPUT_FULL = path.join(OUTPUT_DIR, 'version_map.json');
const OUTPUT_LATEST = path.join(OUTPUT_DIR, 'version_latest.json');

const DRY_RUN = process.argv.includes('--dry-run');
const CHECK_MODE = process.argv.includes('--check');

// ============================================================
// HTTP 客户端（同时支持 http/https，带超时）
// ============================================================

function fetch(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MinecraftPackEditor/1.0'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// ============================================================
// HTML 解析（纯手工正则，无外部依赖）
// ============================================================

/**
 * 从 Wiki 表格 HTML 中提取 pack_format -> versions[] 映射
 * 支持两种表格格式（第二张表有 "Versions" 列）
 */
function parseWikiTables(html) {
  const result = {};

  // 匹配所有表格（可能有多个）
  const tableRegex = /<table[^>]*class="wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    parseTable(tableHtml, result);
  }

  return result;
}

function parseTable(tableHtml, result) {
  // 解析表头：找出 "Value" 和 "Versions" 列的索引
  const headerMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (!headerMatch) return;

  const headerHtml = headerMatch[1];
  const headers = [];
  const headerCellRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let cellMatch;

  while ((cellMatch = headerCellRegex.exec(headerHtml)) !== null) {
    headers.push(cleanText(cellMatch[1]));
  }

  const valueIdx = headers.findIndex(h => /^value$/i.test(h.trim()));
  const versionsIdx = headers.findIndex(h =>
    /^versions$/i.test(h.trim()) || /^releases$/i.test(h.trim()) || /^version$/i.test(h.trim())
  );
  const changesIdx = headers.findIndex(h => /significant|changes/i.test(h));

  if (valueIdx === -1) {
    // 尝试简单格式：第一列是数字
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = extractCells(rowMatch[1]);
      if (cells.length >= 1 && /^\d+(\.\d+)?$/.test(cells[0].trim())) {
        const packFormat = cells[0].trim();
        if (!result[packFormat]) {
          result[packFormat] = [];
        }
      }
    }
    return;
  }

  // 解析每一行数据
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cells = extractCells(rowMatch[1]);
    if (cells.length === 0) continue;

    const packFormat = cells[valueIdx]?.trim();
    if (!packFormat || !/^\d+(\.\d+)?$/.test(packFormat)) continue;

    if (!result[packFormat]) {
      result[packFormat] = [];
    }

    // 从 Versions 列提取版本号
    if (versionsIdx !== -1 && cells[versionsIdx]) {
      const versions = extractVersions(cells[versionsIdx]);
      for (const v of versions) {
        if (!result[packFormat].includes(v)) {
          result[packFormat].push(v);
        }
      }
    }
  }
}

function extractCells(rowHtml) {
  const cells = [];
  const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
  let m;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    cells.push(m[1]);
  }
  return cells;
}

function extractVersions(cellHtml) {
  const versions = [];

  // 提取链接中的版本号: [1.20.1](/w/...)
  const linkRegex = /\[([\d.]+(?:\s+[-–]\s+[\d.]+)?)\]\/w\//g;
  let m;
  while ((m = linkRegex.exec(cellHtml)) !== null) {
    const text = m[1].trim();
    if (text.includes('–')) {
      versions.push(...text.split(/\s*–\s*/).map(v => v.trim()));
    } else {
      versions.push(text);
    }
  }

  // 提取纯文本版本号: "1.20.1", "26.1-pre1", "25w45a"
  const plainRegex = /(?:^|\s|>)(1\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)?|2\d+w\d+[a-z]?|Combat\s*Test\s*\d+[a-z]?)(?:\s|$|<|\))/g;
  while ((m = plainRegex.exec(cellHtml)) !== null) {
    const v = m[1].trim();
    if (v && !versions.includes(v)) {
      versions.push(v);
    }
  }

  return versions;
}

function cleanText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}

// ============================================================
// 版本排序（按 Mojang 命名规则排序）
// ============================================================

/**
 * 判断版本类型
 */
function getVersionType(version) {
  const v = version.trim();

  // 快照: 25w45a, 24w03b
  if (/^\d+w\d+[a-z]?$/i.test(v)) return 'snapshot';

  // Combat Test
  if (/^Combat\s*Test\s*\d+[a-z]?$/i.test(v)) return 'combat';

  // Pre-release / Pre-Release
  if (/^1\.\d+\.\d+\s+Pre-?[Rr]elease\s*\d*$/i.test(v)) return 'prerelease';

  // Release Candidate
  if (/^1\.\d+\.\d+\s+Release\s*Candidate\s*\d*$/i.test(v)) return 'rc';

  // Experimental Snapshot
  if (/experimental\s*snapshot\s*\d+/i.test(v)) return 'experimental';

  // Unobfuscated
  if (/unobfuscated/i.test(v)) return 'unobfuscated';

  // 正式版: 1.20.1, 1.21.5, 26.1
  if (/^\d+\.\d+(\.\d+)?$/.test(v)) return 'release';

  return 'other';
}

/**
 * 提取快照版本号: "25w45a" -> { year: 25, week: 45, letter: "a" }
 */
function parseSnapshotId(v) {
  const m = v.match(/^(\d{2})w(\d+)([a-z]?)$/i);
  if (!m) return null;
  return {
    year: parseInt(m[1]),
    week: parseInt(m[2]),
    letter: m[3] ? m[3].toLowerCase() : ''
  };
}

/**
 * 排序函数：按 Mojang 版本发布顺序排列
 * 规则：
 *   1. 正式版从新到旧
 *   2. RC 从新到旧
 *   3. Pre-release 从新到旧
 *   4. 快照从新到旧
 *   5. Combat Test / Experimental / Unobfuscated 放最后
 */
function sortVersions(versions) {
  const typeOrder = { release: 0, rc: 1, prerelease: 2, snapshot: 3, experimental: 4, combat: 5, unobfuscated: 6, other: 7 };

  return versions.slice().sort((a, b) => {
    const ta = getVersionType(a);
    const tb = getVersionType(b);

    // 不同类型，按类型优先级
    if (typeOrder[ta] !== typeOrder[tb]) {
      return typeOrder[ta] - typeOrder[tb];
    }

    // 同类型，按版本号/快照ID 排序
    if (ta === 'release' || ta === 'rc' || ta === 'prerelease') {
      // 1.20.5 > 1.20.4 > ...
      return compareReleaseVersion(b, a);
    }

    if (ta === 'snapshot') {
      const sa = parseSnapshotId(a);
      const sb = parseSnapshotId(b);
      if (sa && sb) {
        if (sa.year !== sb.year) return sb.year - sa.year;
        if (sa.week !== sb.week) return sb.week - sa.week;
        return sa.letter.localeCompare(sb.letter);
      }
    }

    // 其他类型按字符串排序
    return a.localeCompare(b);
  });
}

function compareReleaseVersion(a, b) {
  const parse = (v) => v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/).slice(1, 4).map(n => parseInt(n || '0'));
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

// ============================================================
// 生成精简版对照表（仅含最新版本）
// ============================================================

function buildLatestMap(fullMap) {
  const latest = {};

  for (const [packFormat, versions] of Object.entries(fullMap)) {
    const sorted = sortVersions(versions);
    const releases = sorted.filter(v => getVersionType(v) === 'release');
    const allOthers = sorted.filter(v => getVersionType(v) !== 'release');

    latest[packFormat] = {
      // 最新正式版
      latest: releases[0] || sorted[0] || null,
      // 最新快照版
      latest_snapshot: sorted.find(v => getVersionType(v) === 'snapshot') || null,
      // 所有版本数量
      total_versions: sorted.length,
      // 所有版本列表（排序后）
      versions: sorted
    };
  }

  return latest;
}

/** Wiki 表可能列出与当前 Java 正式版不一致的补丁位；与其它源对齐时移除。 */
function sanitizeWikiSpuriousVersions(resourcePack) {
  for (const key of Object.keys(resourcePack)) {
    resourcePack[key] = resourcePack[key].filter((v) => !/^26\.1\.1(\s|$)/.test(v));
  }
}

// ============================================================
// 主程序
// ============================================================

async function main() {
  console.log('🔍 正在从 Wiki 爬取版本对照表...');
  console.log(`📡 URL: ${WIKI_URL}`);

  let html;
  try {
    html = await fetch(WIKI_URL);
  } catch (err) {
    console.error(`❌ 获取 Wiki 页面失败: ${err.message}`);
    process.exit(1);
  }

  console.log(`✅ 获取到 HTML (${(html.length / 1024).toFixed(1)} KB)`);

  const parsed = parseWikiTables(html);

  // 对每个 pack_format 的版本列表排序
  const sortedMap = {};
  for (const [pf, versions] of Object.entries(parsed)) {
    sortedMap[pf] = sortVersions(versions);
  }
  sanitizeWikiSpuriousVersions(sortedMap);

  // 检测是否有新增版本
  let existingMap = {};
  if (fs.existsSync(OUTPUT_FULL)) {
    try {
      existingMap = JSON.parse(fs.readFileSync(OUTPUT_FULL, 'utf8'));
    } catch { /* ignore */ }
  }

  const changes = [];
  for (const [pf, versions] of Object.entries(sortedMap)) {
    const existing = existingMap.resource_pack?.[pf] || [];
    if (versions.length > existing.length) {
      changes.push(`  Pack Format ${pf}: ${existing.length} -> ${versions.length} 版本`);
    }
  }

  if (CHECK_MODE) {
    console.log('\n📋 版本检查报告:\n');
    const sortedPfs = Object.keys(sortedMap).map(Number).sort((a, b) => a - b);
    const latestPf = sortedPfs[sortedPfs.length - 1];
    const latestVersions = sortedMap[latestPf] || [];

    console.log(`  最新 Pack Format: ${latestPf}`);
    console.log(`  最新正式版: ${latestVersions.find(v => getVersionType(v) === 'release') || 'N/A'}`);
    console.log(`  最新快照版: ${latestVersions.find(v => getVersionType(v) === 'snapshot') || 'N/A'}`);
    console.log(`  总版本数: ${Object.values(sortedMap).reduce((s, v) => s + v.length, 0)}`);
    console.log(`  Pack Format 总数: ${sortedPfs.length}`);

    if (changes.length > 0) {
      console.log('\n📈 新增版本:\n' + changes.join('\n'));
    } else {
      console.log('\n✅ 没有检测到新增版本');
    }
    return;
  }

  console.log('\n📊 解析结果:');
  console.log(`  Pack Format 总数: ${Object.keys(sortedMap).length}`);
  console.log(`  总版本条目数: ${Object.values(sortedMap).reduce((s, v) => s + v.length, 0)}`);

  if (changes.length > 0) {
    console.log('\n📈 检测到新增版本:\n' + changes.join('\n'));
  }

  // 构建完整版对照表
  const fullMap = {
    resource_pack: sortedMap,
    last_updated: new Date().toISOString(),
    source: WIKI_URL
  };

  // 构建精简版对照表
  const latestMap = buildLatestMap(sortedMap);

  if (DRY_RUN) {
    console.log('\n🔎 [DRY RUN] 不写入文件，以下是预览:');
    console.log('\n精简版对照表 (version_latest.json):');
    const preview = {};
    for (const [pf, data] of Object.entries(latestMap)) {
      preview[pf] = {
        latest: data.latest,
        latest_snapshot: data.latest_snapshot,
        total_versions: data.total_versions
      };
    }
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  // 写入文件
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FULL, JSON.stringify(fullMap, null, 2));
  console.log(`\n✅ 已写入完整版: ${OUTPUT_FULL}`);

  fs.writeFileSync(OUTPUT_LATEST, JSON.stringify(latestMap, null, 2));
  console.log(`✅ 已写入精简版: ${OUTPUT_LATEST}`);

  // 对比报告
  if (changes.length > 0) {
    console.log('\n📝 版本变化汇总:');
    changes.forEach(c => console.log(c));
  }

  console.log('\n🎉 完成！');
}

main().catch(err => {
  console.error('❌ 脚本执行失败:', err);
  process.exit(1);
});
