import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { PackInfo, ImageInfo } from "../types/pack";

// 导入材质包
export async function importPackZip(zipPath: string): Promise<PackInfo> {
  return await invoke<PackInfo>("import_pack_zip", { zipPath });
}

// 检查文件夹是否有pack.mcmeta
export async function checkPackMcmeta(folderPath: string): Promise<boolean> {
  return await invoke<boolean>("check_pack_mcmeta", { folderPath });
}

// 导入材质包
export async function importPackFolder(folderPath: string): Promise<PackInfo> {
  return await invoke<PackInfo>("import_pack_folder", { folderPath });
}

// 获取当前材质包信息
export async function getCurrentPackInfo(): Promise<PackInfo | null> {
  return await invoke<PackInfo | null>("get_current_pack_info");
}

// 获取图片缩略图
export async function getImageThumbnail(
  imagePath: string,
  maxSize: number = 256
): Promise<string> {
  return await invoke<string>("get_image_thumbnail", { imagePath, maxSize });
}

// 获取图片详细信息
export async function getImageDetails(imagePath: string): Promise<ImageInfo> {
  return await invoke<ImageInfo>("get_image_details", { imagePath });
}

// 导出材质包
export async function exportPack(outputPath: string): Promise<void> {
  return await invoke<void>("export_pack", { outputPath });
}

// 清理临时文件
export async function cleanupTemp(): Promise<void> {
  return await invoke<void>("cleanup_temp");
}

// 读取文件内容
export async function readFileContent(filePath: string): Promise<string> {
  return await invoke<string>("read_file_content", { filePath });
}

// 读取内容
export async function readFileBinary(filePath: string): Promise<Uint8Array> {
  return await invoke<Uint8Array>("read_file_binary", { filePath });
}

// 写入文件内容
export async function writeFileContent(
  filePath: string,
  content: string
): Promise<void> {
  return await invoke<void>("write_file_content", { filePath, content });
}

// 创建新文件
export async function createNewFile(
  filePath: string,
  content: string
): Promise<void> {
  return await invoke<void>("create_new_file", { filePath, content });
}

// 删除文件
export async function deleteFile(filePath: string): Promise<void> {
  return await invoke<void>("delete_file", { filePath });
}

// 重命名文件
export async function renameFile(
  oldPath: string,
  newPath: string
): Promise<void> {
  return await invoke<void>("rename_file", { oldPath, newPath });
}

// 获取pack.mcmeta内容
export async function getPackMcmeta(): Promise<string> {
  return await invoke<string>("get_pack_mcmeta");
}

// 更新pack.mcmeta
export async function updatePackMcmeta(content: string): Promise<void> {
  return await invoke<void>("update_pack_mcmeta", { content });
}

// 打开文件选择对话框
export async function selectZipFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Resource Pack",
        extensions: ["zip"],
      },
    ],
  });

  return selected as string | null;
}

// 打开文件夹选择对话框
export async function selectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  });

  return selected as string | null;
}

// 保存文件对话框
export async function saveFileDialog(
  defaultName: string = "resource-pack.zip"
): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Resource Pack",
        extensions: ["zip"],
      },
    ],
  });

  return selected as string | null;
}

export interface MinecraftItem {
  id: string;
  name: string;
  category: ItemCategory;
}

export enum ItemCategory {
  Block = "Block",
  Item = "Item",
  Tool = "Tool",
  Weapon = "Weapon",
  Armor = "Armor",
  Food = "Food",
  Decoration = "Decoration",
  Redstone = "Redstone",
  Transportation = "Transportation",
  Misc = "Misc",
}

// 获取所有物品/方块
export async function getAllMinecraftItems(): Promise<MinecraftItem[]> {
  return await invoke<MinecraftItem[]>("get_all_minecraft_items");
}

// 按类别获取物品
export async function getItemsByCategory(
  category: ItemCategory
): Promise<MinecraftItem[]> {
  return await invoke<MinecraftItem[]>("get_items_by_category", { category });
}

// 搜索物品
export async function searchMinecraftItems(
  query: string
): Promise<MinecraftItem[]> {
  return await invoke<MinecraftItem[]>("search_minecraft_items", { query });
}

// 创建新材质包
export async function createNewPack(
  outputPath: string,
  packName: string,
  packFormat: number,
  description: string
): Promise<void> {
  return await invoke<void>("create_new_pack", {
    outputPath,
    packName,
    packFormat,
    description,
  });
}

// 为物品创建模型
export async function createItemModel(itemId: string): Promise<void> {
  return await invoke<void>("create_item_model", { itemId });
}

// 为方块创建模型
export async function createBlockModel(blockId: string): Promise<void> {
  return await invoke<void>("create_block_model", { blockId });
}

// 批量创建物品模型
export async function createMultipleItemModels(
  itemIds: string[]
): Promise<string[]> {
  return await invoke<string[]>("create_multiple_item_models", { itemIds });
}

// 批量创建方块模型
export async function createMultipleBlockModels(
  blockIds: string[]
): Promise<string[]> {
  return await invoke<string[]>("create_multiple_block_models", { blockIds });
}

// 获取系统已安装的字体列表
export async function getSystemFonts(): Promise<string[]> {
  return await invoke<string[]>("get_system_fonts");
}

// 启动 Web 服务器
export async function startWebServer(
  port: number,
  mode: "lan" | "all"
): Promise<string> {
  return await invoke<string>("start_server", { port, mode });
}

// 停止 Web 服务器
export async function stopWebServer(): Promise<string> {
  return await invoke<string>("stop_server");
}

// 获取服务器状态
export async function getServerStatus(): Promise<boolean> {
  return await invoke<boolean>("get_server_status");
}

export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionInfo[];
}

export interface VersionInfo {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
}

// 获取版本清单
export async function getMinecraftVersions(): Promise<VersionManifest> {
  return await invoke<VersionManifest>("get_minecraft_versions");
}

// 下载指定的版本jar文件
export async function downloadMinecraftVersion(versionId: string): Promise<string> {
  return await invoke<string>("download_minecraft_version", { versionId });
}

// 下载最新的release版本
export async function downloadLatestMinecraftVersion(): Promise<string> {
  return await invoke<string>("download_latest_minecraft_version");
}

// 从jar文件中提取assets到指定目录
export async function extractAssetsFromJar(
  jarPath: string,
  outputPath: string
): Promise<void> {
  return await invoke<void>("extract_assets_from_jar", { jarPath, outputPath });
}

// 下载版本并提取assets到材质包
export async function downloadAndExtractTemplate(
  versionId: string,
  packPath: string,
  keepCache: boolean = false
): Promise<string> {
  return await invoke<string>("download_and_extract_template", { versionId, packPath, keepCache });
}

// 清理模板缓存
export async function clearTemplateCache(): Promise<void> {
  return await invoke<void>("clear_template_cache");
}