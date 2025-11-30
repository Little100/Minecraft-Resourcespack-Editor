# 此文件由ai生成
#!/usr/bin/env python3
"""
从 Minecraft Wiki 抓取 pack_format 版本映射表
生成 version_map.json 文件供应用使用
"""

import json
import re
from typing import Dict, List, Tuple
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
import time

def fetch_pack_format_table() -> List[Tuple[int, str]]:
    """
    从 Minecraft Wiki 抓取 pack_format 表格（使用无头浏览器）
    返回: [(pack_format, version_range), ...]
    """
    url = "https://minecraft.wiki/w/Pack_format"
    
    print(f"正在使用无头浏览器访问: {url}")
    
    driver = None
    try:
        # 配置Chrome选项
        chrome_options = Options()
        chrome_options.add_argument('--headless')  # 无头模式
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        
        # 创建WebDriver
        print("正在启动Chrome浏览器...")
        driver = webdriver.Chrome(options=chrome_options)
        
        # 访问页面
        driver.get(url)
        
        # 等待页面加载
        print("等待页面加载...")
        time.sleep(3)
        
        # 获取页面源代码
        page_source = driver.page_source
        soup = BeautifulSoup(page_source, 'html.parser')
        
    except Exception as e:
        print(f"浏览器访问失败: {e}")
        print("使用备用数据...")
        if driver:
            driver.quit()
        return get_fallback_data()
    finally:
        if driver:
            driver.quit()
    
    # 查找包含 Resource pack format 的表格
    pack_format_mappings = {}  # 使用字典来合并相同pack_format的版本
    
    # 查找特定的表格：class="wikitable sortable jquery-tablesorter"
    tables = soup.find_all('table', class_='wikitable sortable jquery-tablesorter')
    
    print(f"找到 {len(tables)} 个sortable表格")
    
    for table_idx, table in enumerate(tables):
        print(f"\n检查表格 {table_idx + 1}...")
        
        # 查找表头
        header_row = table.find('tr')
        if not header_row:
            continue
            
        headers = header_row.find_all('th')
        header_texts = [h.get_text().strip() for h in headers]
        
        print(f"表头: {header_texts}")
        
        # 确认这是正确的表格（包含Client version）
        if 'Client version' not in ' '.join(header_texts):
            print("不包含Client version，跳过")
            continue
        
        print(f"找到正确的表格！")
        
        # 由于rowspan的复杂性，我们采用简单策略：
        # 表格结构固定为：[Client version, Resource pack format, Data pack format]
        # 我们总是读取第二个<td>（索引1）作为Resource pack format
        # 因为Resource pack format永远在Data pack format之前
        
        version_col_idx = 0  # 版本总是第一列
        resource_pack_col_idx = 1  # Resource pack format总是第二列
        
        print(f"使用固定列索引 - 版本: {version_col_idx}, Resource pack format: {resource_pack_col_idx}")
        
        # 遍历表格行
        rows = table.find_all('tr')[1:]  # 跳过表头
        current_pack_format = None
        
        print(f"表格共有 {len(rows)} 行数据")
        print(f"开始解析...")
        
        for row_idx, row in enumerate(rows):
            cells = row.find_all(['td', 'th'])
            
            # 至少需要有版本列
            if len(cells) < 1:
                continue
            
            try:
                # 获取版本信息（第一列，索引0）
                version_cell = cells[0]
                version_text = version_cell.get_text().strip()
                
                # 清理版本文本
                version_text = re.sub(r'\s+', ' ', version_text)
                version_text = version_text.replace('Java Edition ', '')
                
                # 跳过空行
                if not version_text:
                    continue
                
                # 获取Resource pack format
                # 策略：总是尝试读取第二个<td>（索引1）
                
                old_pack_format = current_pack_format
                
                if len(cells) > 1:
                    # 有第二个<td>，需要判断它是Resource pack format还是Data pack format
                    pack_format_cell = cells[1]
                    pack_format_str = pack_format_cell.get_text().strip()
                    
                    if pack_format_str:
                        try:
                            # 转换为整数（去掉小数部分）
                            pack_format_float = float(pack_format_str)
                            new_pack_format = int(pack_format_float)
                            
                            # 判断逻辑：
                            # 1. 如果有3个单元格，cells[1]是Resource pack format
                            # 2. 如果只有2个单元格：
                            #    - 如果值<=3，这是早期版本（Data pack format不存在），cells[1]是Resource pack format
                            #    - 如果值>3，可能是Data pack format（Resource pack被rowspan覆盖），忽略
                            
                            if len(cells) >= 3:
                                # 有3个或更多单元格，cells[1]是Resource pack format
                                current_pack_format = new_pack_format
                                
                                print(f"\n[行{row_idx + 1}] {version_text}")
                                print(f"  单元格数: {len(cells)}, cells[1]='{pack_format_str}' (Resource pack)")
                                print(f"  ✓ pack_format: {old_pack_format} -> {current_pack_format}")
                            elif len(cells) == 2 and new_pack_format <= 3:
                                # 只有2个单元格，但值<=3，这是早期版本（没有Data pack format）
                                current_pack_format = new_pack_format
                                
                                print(f"\n[行{row_idx + 1}] {version_text}")
                                print(f"  单元格数: {len(cells)}, cells[1]='{pack_format_str}' (早期版本，Resource pack)")
                                print(f"  ✓ pack_format: {old_pack_format} -> {current_pack_format}")
                            else:
                                # 只有2个单元格且值>3，可能是Data pack format，忽略它
                                print(f"\n[行{row_idx + 1}] {version_text}")
                                print(f"  单元格数: {len(cells)}, cells[1]='{pack_format_str}' (可能是Data pack，忽略)")
                                print(f"  → 保持pack_format: {current_pack_format}")
                        except ValueError:
                            # 无法解析为数字，可能是其他内容
                            print(f"\n[行{row_idx + 1}] {version_text}")
                            print(f"  单元格数: {len(cells)}")
                            for i, cell in enumerate(cells):
                                print(f"    cells[{i}]: {cell.get_text().strip()}")
                            print(f"  ✗ 无法解析cells[1]='{pack_format_str}'，保持pack_format={current_pack_format}")
                
                # 如果有有效的pack_format，记录映射
                if current_pack_format is not None:
                    if current_pack_format not in pack_format_mappings:
                        pack_format_mappings[current_pack_format] = []
                    pack_format_mappings[current_pack_format].append(version_text)
                    
                    # 只在pack_format变化时输出记录信息
                    if current_pack_format != old_pack_format:
                        print(f"  → 开始新的pack_format组: {current_pack_format}")
            
            except (ValueError, TypeError, IndexError) as e:
                print(f"\n[行{row_idx + 1}] 错误: {e}")
                continue
    
    # 不再合并版本，每个版本都单独保存
    # 但我们仍然需要返回合适的格式供save_version_map使用
    result = []
    for pack_format in sorted(pack_format_mappings.keys()):
        versions = pack_format_mappings[pack_format]
        # 返回所有版本，不合并
        for version in versions:
            result.append((pack_format, version))
    
    pack_format_mappings = result
    
    # 如果没有找到数据，使用备用数据
    if not pack_format_mappings:
        print("未找到数据，使用备用数据...")
        return get_fallback_data()
    
    # 检查pack_format范围
    pack_formats = set(pf for pf, _ in pack_format_mappings)
    min_pf = min(pack_formats)
    max_pf = max(pack_formats)
    
    print(f"\n✓ 成功获取 pack_format 范围: {min_pf} - {max_pf}")
    
    # 检查是否获取到了早期版本（pack_format 1和2）
    has_early_versions = any(pf <= 2 for pf in pack_formats)
    if not has_early_versions:
        print("⚠️ 警告：未找到pack_format 1和2的数据")
    else:
        print("✓ 包含早期版本（pack_format 1-3）")
    
    return pack_format_mappings

def get_fallback_data() -> List[Tuple[int, str]]:
    """
    备用数据（手动维护的版本映射）
    """
    return [
        (1, "1.6.1 – 1.8.9"),
        (2, "1.9 – 1.10.2"),
        (3, "1.11 – 1.12.2"),
        (4, "1.13 – 1.14.4"),
        (5, "1.15 – 1.16.1"),
        (6, "1.16.2 – 1.16.5"),
        (7, "1.17 – 1.17.1"),
        (8, "1.18 – 1.18.2"),
        (9, "1.19 – 1.19.2"),
        (12, "1.19.3"),
        (13, "1.19.4"),
        (15, "1.20 – 1.20.1"),
        (18, "1.20.2"),
        (22, "1.20.3 – 1.20.4"),
        (32, "1.20.5 – 1.20.6"),
        (34, "1.21 – 1.21.1"),
        (42, "1.21.2 – 1.21.3"),
        (46, "1.21.4"),
        (55, "1.21.5"),
        (63, "1.21.6"),
        (64, "1.21.7 – 1.21.8"),
    ]

def save_version_map(mappings: List[Tuple[int, str]], output_file: str = "version_map.json"):
    """
    保存版本映射到 JSON 文件
    格式: { "pack_format": ["version1", "version2", ...] }
    """
    # 构建pack_format到版本列表的映射
    pack_format_to_versions = {}
    for pack_format, version in mappings:
        if pack_format not in pack_format_to_versions:
            pack_format_to_versions[pack_format] = []
        pack_format_to_versions[pack_format].append(version)
    
    # 转换为字典格式
    version_map = {
        "resource_pack": {
            str(pack_format): versions
            for pack_format, versions in sorted(pack_format_to_versions.items())
        },
        "last_updated": None
    }
    
    # 添加时间戳
    from datetime import datetime
    version_map["last_updated"] = datetime.now().isoformat()
    
    # 保存到文件
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(version_map, f, indent=2, ensure_ascii=False)
    
    print(f"\n版本映射已保存到: {output_file}")
    
    # 统计信息
    total_versions = sum(len(versions) for versions in pack_format_to_versions.values())
    print(f"共 {len(pack_format_to_versions)} 个pack_format组")
    print(f"共 {total_versions} 个版本")

def main():
    print("=" * 60)
    print("Minecraft Pack Format 版本映射抓取工具")
    print("=" * 60)
    print()
    
    # 抓取数据
    mappings = fetch_pack_format_table()
    
    # 保存到文件
    save_version_map(mappings)
    
    print()
    print("完成！")

if __name__ == "__main__":
    main()