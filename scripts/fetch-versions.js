/**
 * 别问我 我不知道 ai 写的
 * Minecraft Resource Pack Format 爬取脚本
 * 从 Wiki 获取最新的 pack_format 版本对照表
 * 
 * 用法: node scripts/fetch-versions.js [--test]
 *   --test  模式跳过提交，仅打印输出
 */

import https from 'https';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const WIKI_URL = 'https://minecraft.wiki/w/Pack_format';
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'version_map', 'version_map.json');

function fetchWikiPage(url) {
  return new Promise((resolve, reject) => {
    console.log(`正在获取 Wiki 页面: ${url}`);
    
    https.get(url, { 
      headers: {
        'User-Agent': 'MinecraftPackEditor/1.0 (Version Map Updater)'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// 从 HTML 提取版本号
function extractVersion(text) {
  // 清理 HTML 标签和多余空格
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
  
  // 移除 "Java Edition " 前缀
  const version = clean.replace(/^Java\s*Edition\s*/i, '').trim();
  
  // 跳过空值或非版本内容
  if (!version || version.length < 2 || /^[A-Z]/.test(version) && !/\d/.test(version)) {
    return null;
  }
  
  // 验证是否为有效的版本格式
  const versionPattern = /^[\d\.]+(\s*[-–]\s*[\d\.]+)?(\s+[A-Za-z]+(\s+[A-Za-z]+)*\s*\d*)?(\s+Unobfuscated)?$/i;
  if (!versionPattern.test(version) && !/^\d/.test(version)) {
    return null;
  }
  
  return version;
}

// 解析 pack_format 表格
function parsePackFormatTable(html) {
  const versionMap = {
    resource_pack: {},
    last_updated: new Date().toISOString()
  };

  // 查找包含 "Resource pack format" 的表格
  const tableRegex = /<table[^>]*class="wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  const tables = [...html.matchAll(tableRegex)];
  
  console.log(`找到 ${tables.length} 个 wikitable 表格`);
  
  let correctTable = null;
  
  for (let i = 0; i < tables.length; i++) {
    const tableContent = tables[i][1];
    // 检查表头是否包含 "Client version" 和 "Resource pack format"
    if (tableContent.includes('Client version') && tableContent.includes('Resource pack format')) {
      correctTable = tableContent;
      console.log(`找到正确的表格 (第 ${i + 1} 个)`);
      break;
    }
  }
  
  if (!correctTable) {
    console.error('未找到包含版本信息的表格');
    return versionMap;
  }
  
  // 解析表格行
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [...correctTable.matchAll(rowRegex)];
  
  console.log(`表格共有 ${rows.length} 行`);
  
  let currentPackFormat = null;
  
  for (const rowMatch of rows) {
    const row = rowMatch[1];
    
    // 跳过表头行
    if (row.includes('<th') && row.includes('Client version')) {
      continue;
    }
    
    // 提取所有单元格
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const cells = [...row.matchAll(cellRegex)].map(m => m[1]);
    
    if (cells.length === 0) continue;
    
    // 第一个单元格是版本
    const versionText = extractVersion(cells[0]);
    if (!versionText) continue;
    
    // 确定 pack_format
    // 结构：通常有 2-3 列 [版本, Resource pack format, Data pack format]
    // Resource pack format 在第 2 列（索引 1）
    // Data pack format 在第 3 列（索引 2）
    
    let packFormat = currentPackFormat;
    
    if (cells.length >= 2) {
      // 尝试从第二个单元格获取 pack_format
      const secondCellText = cells[1].replace(/<[^>]+>/g, '').trim();
      const pfMatch = secondCellText.match(/^(\d+(\.\d+)?)$/);
      
      if (pfMatch) {
        const pfValue = parseFloat(pfMatch[1]);
        // 判断是否为 Resource pack format (值较小) 或 Data pack format (值较大)
        // Resource pack format 通常 <= 100，Data pack format 通常更大
        // 通过单元格数量判断：如果有 3 列，cells[1] 是 Resource pack format
        if (cells.length >= 3 || pfValue <= 100) {
          currentPackFormat = pfValue;
          packFormat = currentPackFormat;
        }
      }
    }
    
    // 记录版本
    if (packFormat !== null) {
      const pfKey = String(packFormat);
      if (!versionMap.resource_pack[pfKey]) {
        versionMap.resource_pack[pfKey] = [];
      }
      versionMap.resource_pack[pfKey].push(versionText);
    }
  }
  
  return versionMap;
}

/** Wiki 表可能列出与当前 Java 正式版不一致的补丁位；与其它源对齐时移除。 */
function sanitizeWikiSpuriousVersions(versionMap) {
  const rp = versionMap.resource_pack;
  for (const key of Object.keys(rp)) {
    rp[key] = rp[key].filter((v) => !/^26\.1\.1(\s|$)/.test(v));
  }
  return versionMap;
}

// 备用版本映射（当无法获取时使用）
function getFallbackVersionMap() {
  return {
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
      "65": ["25w33a", "25w32a", "25w31a"],
      "66": ["25w34b", "25w34a"],
      "67": ["25w35a"],
      "68": ["25w36b", "25w36a"],
      "69": ["1.21.10", "1.21.9", "25w37a"],
      "70": ["25w42a", "25w41a"],
      "71": ["25w43a"],
      "72": ["25w44a"],
      "73": ["25w45a", "25w45a Unobfuscated"],
      "74": ["25w46a", "25w46a Unobfuscated"],
      "75": ["1.21.11"],
      "76": ["26.1-snap1"],
      "77": ["26.1-snap2"],
      "78": ["26.1-snap3"],
      "78.1": ["26.1-snap4"],
      "79": ["26.1-snap5"],
      "80": ["26.1-snap6"],
      "81": ["26.1-snap7"],
      "81.1": ["26.1-snap8", "26.1-snap9"],
      "82": ["26.1-snap10"],
      "83": ["26.1-snap11"],
      "84": ["26.1", "26.1 Pre-Release 1"]
    },
    last_updated: new Date().toISOString()
  };
}

async function main() {
  const isTest = process.argv.includes('--test');
  
  console.log('=== Minecraft 版本对照表爬取工具 ===');
  console.log(`模式: ${isTest ? '测试模式（不保存）' : '生产模式'}`);
  console.log('');
  
  try {
    const html = await fetchWikiPage(WIKI_URL);
    
    console.log('正在解析表格数据...');
    let versionMap = sanitizeWikiSpuriousVersions(parsePackFormatTable(html));
    
    const formatCount = Object.keys(versionMap.resource_pack).length;
    let totalVersions = 0;
    for (const versions of Object.values(versionMap.resource_pack)) {
      totalVersions += versions.length;
    }
    
    console.log(`\n解析完成: ${formatCount} 个 pack_format, ${totalVersions} 个版本`);
    
    // 如果解析结果太少，使用备用数据
    if (totalVersions < 100) {
      console.log('\n解析结果太少，使用备用数据...');
      versionMap = getFallbackVersionMap();
      
      const fallbackFormats = Object.keys(versionMap.resource_pack).length;
      let fallbackVersions = 0;
      for (const versions of Object.values(versionMap.resource_pack)) {
        fallbackVersions += versions.length;
      }
      console.log(`备用数据: ${fallbackFormats} 个 pack_format, ${fallbackVersions} 个版本`);
    }
    
    const formats = Object.keys(versionMap.resource_pack).sort((a, b) => parseFloat(b) - parseFloat(a));
    if (formats.length > 0) {
      console.log('\n最新 5 个 pack_format:');
      formats.slice(0, 5).forEach(f => {
        const versions = versionMap.resource_pack[f];
        console.log(`  ${f}: ${versions.length} 个版本, 最新: ${versions[0]}`);
      });
    }
    
    if (isTest) {
      console.log('\n[测试模式] 生成的 JSON (前 3000 字符):');
      const jsonStr = JSON.stringify(versionMap, null, 2);
      console.log(jsonStr.substring(0, 3000) + (jsonStr.length > 3000 ? '\n...' : ''));
    } else {
      // 保存文件
      await fsp.writeFile(OUTPUT_FILE, JSON.stringify(versionMap, null, 2), 'utf8');
      console.log(`\n已保存到: ${OUTPUT_FILE}`);
    }
    
    return versionMap;
  } catch (error) {
    console.error('错误:', error.message);
    
    // 出错时使用备用数据
    console.log('\n使用备用数据...');
    const fallbackMap = getFallbackVersionMap();
    
    if (!isTest) {
      await fsp.writeFile(OUTPUT_FILE, JSON.stringify(fallbackMap, null, 2), 'utf8');
      console.log(`已保存备用数据到: ${OUTPUT_FILE}`);
    }
    
    return fallbackMap;
  }
}

main();
