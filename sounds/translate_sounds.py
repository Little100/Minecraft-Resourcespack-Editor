# 此文件由ai生成
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动翻译 sounds.json 文件的脚本
使用 Ollama 的 gpt-oss:20b 模型
为每个sound条目新增chinese字段，翻译路径名称
每500个键为一批进行翻译
"""

import json
import subprocess
import sys
from typing import Dict, Any, List
import time
import copy
import re

def call_ollama(prompt: str, model: str = "gpt-oss:20b") -> str:
    """
    调用 Ollama API 进行翻译
    
    Args:
        prompt: 翻译提示
        model: 使用的模型名称
    
    Returns:
        翻译结果
    """
    try:
        # 使用 subprocess 调用 ollama
        result = subprocess.run(
            ["ollama", "run", model],
            input=prompt.encode('utf-8'),
            capture_output=True,
            timeout=300  # 5分钟超时
        )
        
        if result.returncode == 0:
            response = result.stdout.decode('utf-8').strip()
            return response
        else:
            error_msg = result.stderr.decode('utf-8')
            print(f"错误: {error_msg}", file=sys.stderr)
            return ""
    except subprocess.TimeoutExpired:
        print("错误: 翻译超时", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        return ""

def extract_json_from_response(response: str) -> str:
    """
    从响应中提取JSON内容，优先解析markdown代码块
    
    Args:
        response: 模型返回的完整响应
    
    Returns:
        提取的JSON字符串
    """
    # 优先尝试找到markdown代码块中的JSON（```json...```）
    json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()
    
    # 尝试找到普通代码块（```...```）
    code_match = re.search(r'```\s*(.*?)\s*```', response, re.DOTALL)
    if code_match:
        content = code_match.group(1).strip()
        # 检查是否是JSON
        if content.startswith('{'):
            return content
    
    # 如果没有代码块，尝试找到以 { 开始的JSON
    brace_match = re.search(r'\{.*\}', response, re.DOTALL)
    if brace_match:
        return brace_match.group(0).strip()
    
    return response.strip()

def extract_sound_paths(data: Dict) -> List[str]:
    """
    从sounds.json中提取所有需要翻译的声音路径
    
    Args:
        data: sounds.json的数据
    
    Returns:
        所有唯一的声音路径列表
    """
    paths = set()
    
    for key, value in data.items():
        if "sounds" in value and isinstance(value["sounds"], list):
            for sound in value["sounds"]:
                if isinstance(sound, str):
                    paths.add(sound)
                elif isinstance(sound, dict) and "name" in sound:
                    paths.add(sound["name"])
    
    return sorted(list(paths))

def translate_paths_batch(paths: List[str], batch_num: int = 0) -> Dict[str, str]:
    """
    批量翻译声音路径
    
    Args:
        paths: 要翻译的路径列表
        batch_num: 批次编号（用于日志）
    
    Returns:
        路径到中文翻译的映射字典
    """
    # 构建提示词 - 更明确的指令
    paths_text = "\n".join([f'"{path}"' for path in paths])
    
    prompt = f"""将以下Minecraft声音路径翻译成中文。只翻译英文单词，保留斜杠和数字。

路径列表：
{paths_text}

要求：
1. 用markdown代码块输出JSON格式
2. 格式必须是: {{"原路径": "中文路径"}}
3. 例如: {{"mob/cow/step1": "生物/牛/脚步1"}}
4. 注意用Minecraft(我的世界)的游戏内容进行翻译,不认识的专有名词请保留路径

请用以下格式输出：
```json
{{
  "路径1": "翻译1",
  "路径2": "翻译2"
}}
```"""
    
    max_retries = 5  # 增加重试次数
    for retry in range(max_retries):
        if retry > 0:
            print(f"  → 第 {retry + 1} 次重试...")
        
        response = call_ollama(prompt)
        
        if not response:
            print(f"  ✗ 无响应，等待3秒后重试...")
            time.sleep(3)
            continue
        
        # 提取JSON
        json_str = extract_json_from_response(response)
        
        try:
            # 验证JSON格式
            translations = json.loads(json_str)
            
            # 验证返回的翻译是否有效
            if not translations or not isinstance(translations, dict):
                print(f"  ✗ 返回的不是有效字典，重试...")
                time.sleep(2)
                continue
            
            # 检查是否至少翻译了一些路径
            valid_count = sum(1 for k, v in translations.items() if k in paths and v)
            if valid_count == 0:
                print(f"  ✗ 没有有效的翻译结果，重试...")
                time.sleep(2)
                continue
            
            print(f"  ✓ 成功翻译 {valid_count}/{len(paths)} 个路径")
            return translations
            
        except json.JSONDecodeError as e:
            print(f"  ✗ JSON解析失败: {str(e)[:100]}")
            if retry < max_retries - 1:
                print(f"  → 原始响应前200字符: {response[:200]}...")
                print(f"  → 清理后JSON前200字符: {json_str[:200]}...")
                time.sleep(3)
            continue
        except Exception as e:
            print(f"  ✗ 未知错误: {str(e)[:100]}")
            time.sleep(2)
            continue
    
    # 如果所有重试都失败，返回原路径作为翻译（保持原样）
    print(f"  ✗ 批次 {batch_num} 翻译失败，保留原始路径")
    return {path: path for path in paths}

def add_chinese_field(data: Dict, translations: Dict[str, str]) -> Dict:
    """
    为sounds.json中的每个条目添加chinese字段
    
    Args:
        data: 原始sounds.json数据
        translations: 路径翻译映射
    
    Returns:
        添加了chinese字段的新数据
    """
    result = copy.deepcopy(data)
    
    for key, value in result.items():
        if "sounds" in value and isinstance(value["sounds"], list):
            new_sounds = []
            for sound in value["sounds"]:
                if isinstance(sound, str):
                    # 简单字符串格式
                    new_sound = {
                        "name": sound,
                        "chinese": translations.get(sound, sound)
                    }
                    new_sounds.append(new_sound)
                elif isinstance(sound, dict):
                    # 字典格式，添加chinese字段
                    new_sound = copy.deepcopy(sound)
                    if "name" in sound:
                        new_sound["chinese"] = translations.get(sound["name"], sound["name"])
                    new_sounds.append(new_sound)
                else:
                    new_sounds.append(sound)
            
            value["sounds"] = new_sounds
    
    return result

def chunk_list(items: List, chunk_size: int = 500) -> List[List]:
    """
    将列表分成多个块
    
    Args:
        items: 原始列表
        chunk_size: 每块的大小
    
    Returns:
        分块后的列表
    """
    chunks = []
    for i in range(0, len(items), chunk_size):
        chunks.append(items[i:i + chunk_size])
    return chunks

def main():
    """主函数"""
    input_file = "sounds.json"
    output_file = "translate/sounds.json"
    translations_file = "translate/translations_cache.json"
    
    print("=" * 60)
    print("Minecraft sounds.json 自动翻译工具")
    print("为每个sound条目添加chinese字段")
    print("=" * 60)
    
    # 读取原始文件
    print(f"\n正在读取文件: {input_file}")
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"错误: 找不到文件 {input_file}")
        return
    except json.JSONDecodeError as e:
        print(f"错误: JSON格式错误: {e}")
        return
    
    total_keys = len(data)
    print(f"✓ 文件读取成功，共 {total_keys} 个键")
    
    # 确保translate目录存在
    import os
    os.makedirs("translate", exist_ok=True)
    print("✓ 输出目录已准备")
    
    # 提取所有声音路径
    print("\n正在提取声音路径...")
    paths = extract_sound_paths(data)
    total_paths = len(paths)
    print(f"✓ 找到 {total_paths} 个唯一的声音路径")
    
    # 尝试加载已有的翻译缓存
    all_translations = {}
    try:
        with open(translations_file, 'r', encoding='utf-8') as f:
            all_translations = json.load(f)
        print(f"✓ 加载已有翻译缓存: {len(all_translations)} 条")
    except FileNotFoundError:
        print("未找到翻译缓存，将创建新的")
    
    # 分批翻译路径
    chunk_size = 50
    chunks = chunk_list(paths, chunk_size)
    total_chunks = len(chunks)
    
    print(f"\n开始翻译路径，共分为 {total_chunks} 批，每批最多 {chunk_size} 个路径")
    
    for i, chunk in enumerate(chunks):
        # 过滤掉已翻译的路径
        to_translate = [p for p in chunk if p not in all_translations]
        
        if not to_translate:
            print(f"\n第 {i + 1}/{total_chunks} 批已全部翻译，跳过")
            continue
        
        print(f"\n正在翻译第 {i + 1}/{total_chunks} 批路径（{len(to_translate)} 个新路径）...")
        
        batch_translations = translate_paths_batch(to_translate, i + 1)
        all_translations.update(batch_translations)
        
        # 保存翻译缓存
        with open(translations_file, 'w', encoding='utf-8') as f:
            json.dump(all_translations, f, ensure_ascii=False, indent=2)
        
        print(f"✓ 第 {i + 1} 批翻译完成，缓存已保存")
        
        # 避免请求过快，稍作延迟
        if i < total_chunks - 1:
            print("等待2秒后继续...")
            time.sleep(2)
    
    # 为数据添加chinese字段
    print("\n正在为每个sound条目添加chinese字段...")
    result_data = add_chinese_field(data, all_translations)
    
    # 保存结果
    print(f"\n正在保存结果到: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 60)
    print("翻译完成！")
    print(f"原始文件: {input_file}")
    print(f"翻译文件: {output_file}")
    print(f"翻译缓存: {translations_file}")
    print(f"总键数: {total_keys}")
    print(f"翻译路径数: {len(all_translations)}")
    print("=" * 60)

if __name__ == "__main__":
    main()