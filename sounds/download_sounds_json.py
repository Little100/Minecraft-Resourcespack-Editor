# 此文件由ai生成
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动下载最新版本的 Minecraft sounds.json 文件
参考 src-tauri/src/version_downloader.rs 的实现
默认下载最新的 snapshot 版本
"""

import json
import requests
import sys
from pathlib import Path
from typing import Dict, Optional

# Mojang 版本清单 URL
VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest.json"

class VersionManifest:
    """版本清单"""
    def __init__(self, data: Dict):
        self.latest = data.get("latest", {})
        self.versions = data.get("versions", [])

class VersionDetails:
    """版本详细信息"""
    def __init__(self, data: Dict):
        self.id = data.get("id", "")
        self.asset_index = data.get("assetIndex")

def fetch_version_manifest() -> VersionManifest:
    """
    获取版本清单
    
    Returns:
        VersionManifest: 版本清单对象
    
    Raises:
        Exception: 获取或解析失败时抛出异常
    """
    try:
        print("正在获取版本清单...")
        response = requests.get(VERSION_MANIFEST_URL, timeout=30)
        response.raise_for_status()
        data = response.json()
        print("✓ 版本清单获取成功")
        return VersionManifest(data)
    except requests.RequestException as e:
        raise Exception(f"获取版本清单失败: {e}")
    except json.JSONDecodeError as e:
        raise Exception(f"解析版本清单失败: {e}")

def fetch_version_details(version_url: str) -> VersionDetails:
    """
    获取版本详细信息
    
    Args:
        version_url: 版本详情 URL
    
    Returns:
        VersionDetails: 版本详细信息对象
    
    Raises:
        Exception: 获取或解析失败时抛出异常
    """
    try:
        print(f"正在获取版本详细信息: {version_url}")
        response = requests.get(version_url, timeout=30)
        response.raise_for_status()
        data = response.json()
        print("✓ 版本详细信息获取成功")
        return VersionDetails(data)
    except requests.RequestException as e:
        raise Exception(f"获取版本详细信息失败: {e}")
    except json.JSONDecodeError as e:
        raise Exception(f"解析版本详细信息失败: {e}")

def download_sounds_json(
    output_path: Path,
    version_id: Optional[str] = None,
    use_snapshot: bool = True
) -> str:
    """
    下载 sounds.json 文件
    
    Args:
        output_path: 输出文件路径
        version_id: 指定版本ID，如果为 None 则下载最新版本
        use_snapshot: 是否使用 snapshot 版本（默认 True），False 则使用 release 版本
    
    Returns:
        str: 下载的版本ID
    
    Raises:
        Exception: 下载失败时抛出异常
    """
    # 获取版本清单
    manifest = fetch_version_manifest()
    
    # 确定要下载的版本
    if version_id is None:
        # 使用最新版本
        if use_snapshot:
            version_id = manifest.latest.get("snapshot")
            if not version_id:
                raise Exception("未找到最新 snapshot 版本")
            print(f"使用最新 snapshot 版本: {version_id}")
        else:
            version_id = manifest.latest.get("release")
            if not version_id:
                raise Exception("未找到最新 release 版本")
            print(f"使用最新 release 版本: {version_id}")
    else:
        print(f"使用指定版本: {version_id}")
    
    # 查找版本信息
    version_info = None
    for version in manifest.versions:
        if version.get("id") == version_id:
            version_info = version
            break
    
    if not version_info:
        raise Exception(f"未找到版本 {version_id}")
    
    # 获取版本详细信息
    version_url = version_info.get("url")
    if not version_url:
        raise Exception(f"版本 {version_id} 没有 URL")
    
    details = fetch_version_details(version_url)
    
    # 检查是否有资源索引
    if not details.asset_index:
        raise Exception(f"版本 {version_id} 没有资源索引")
    
    asset_index = details.asset_index
    asset_index_url = asset_index.get("url")
    asset_index_id = asset_index.get("id", "unknown")
    
    print(f"资源索引 ID: {asset_index_id}")
    print(f"正在下载资源索引: {asset_index_url}")
    
    # 下载资源索引
    try:
        response = requests.get(asset_index_url, timeout=30)
        response.raise_for_status()
        assets_data = response.json()
        print("✓ 资源索引下载成功")
    except requests.RequestException as e:
        raise Exception(f"下载资源索引失败: {e}")
    except json.JSONDecodeError as e:
        raise Exception(f"解析资源索引失败: {e}")
    
    # 查找 sounds.json
    objects = assets_data.get("objects", {})
    sounds_json_key = "minecraft/sounds.json"
    
    if sounds_json_key not in objects:
        raise Exception(f"在资源索引中未找到 {sounds_json_key}")
    
    sounds_json_asset = objects[sounds_json_key]
    hash_value = sounds_json_asset.get("hash")
    
    if not hash_value:
        raise Exception("sounds.json 的 hash 值为空")
    
    # 构建下载 URL
    # 格式: https://resources.download.minecraft.net/{前2位}/{完整hash}
    download_url = f"https://resources.download.minecraft.net/{hash_value[:2]}/{hash_value}"
    
    print(f"正在下载 sounds.json: {download_url}")
    
    # 下载 sounds.json
    try:
        response = requests.get(download_url, timeout=60)
        response.raise_for_status()
        content = response.content
        print("✓ sounds.json 下载成功")
    except requests.RequestException as e:
        raise Exception(f"下载 sounds.json 失败: {e}")
    
    # 确保输出目录存在
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # 保存文件
    try:
        output_path.write_bytes(content)
        print(f"✓ sounds.json 已保存到: {output_path}")
    except IOError as e:
        raise Exception(f"保存 sounds.json 失败: {e}")
    
    return version_id

def main():
    """主函数"""
    print("=" * 60)
    print("Minecraft sounds.json 自动下载工具")
    print("默认下载最新 snapshot 版本")
    print("=" * 60)
    
    # 默认输出路径为当前目录下的 sounds.json
    output_path = Path(__file__).parent / "sounds.json"
    
    # 默认使用 snapshot 版本
    use_snapshot = True
    version_id = None
    
    # 检查命令行参数
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg == "--release":
            use_snapshot = False
            print("\n使用 release 版本模式")
        else:
            version_id = arg
            print(f"\n指定版本: {version_id}")
    else:
        print("\n将下载最新 snapshot 版本")
        print("提示: 使用 --release 参数下载最新 release 版本")
    
    if len(sys.argv) > 2 and sys.argv[1] != "--release":
        output_path = Path(sys.argv[2])
        print(f"输出路径: {output_path}")
    elif len(sys.argv) > 2 and sys.argv[1] == "--release":
        if len(sys.argv) > 2:
            output_path = Path(sys.argv[2])
            print(f"输出路径: {output_path}")
    
    try:
        # 下载 sounds.json
        downloaded_version = download_sounds_json(output_path, version_id, use_snapshot)
        
        print("\n" + "=" * 60)
        print("下载完成！")
        print(f"版本: {downloaded_version}")
        print(f"文件: {output_path.absolute()}")
        print("=" * 60)
        
        return 0
    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())