use crate::constants;
use crate::image_handler::{get_image_info, ImageInfo};
use crate::pack_parser::{scan_pack_directory, PackInfo};
use crate::pack_merger::{
    preview_merge, execute_merge_async, PackSourceType, MergePreview, MergeResult,
    MergeSourceInput, MergeConfig,
};
use crate::path_security::{resolve_pack_path, get_pack_base_path};
use crate::preloader::ImagePreloader;
use crate::zip_handler::{
    cleanup_temp_files, create_zip, extract_zip, get_temp_extract_dir, validate_pack_zip,
};
use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::State;
use regex::Regex;
use rayon::prelude::*;

fn find_available_extract_path(parent: &Path, stem: &str) -> PathBuf {
    let mut candidate = parent.join(stem);
    let mut counter = 2;

    while candidate.exists() {
        candidate = parent.join(format!("{}_{}", stem, counter));
        counter += 1;
    }

    candidate
}

/// 应用状态
pub struct AppState {
    pub current_pack_path: Mutex<Option<PathBuf>>,
    pub current_pack_info: Mutex<Option<PackInfo>>,
    pub preloader: Arc<ImagePreloader>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_pack_path: Mutex::new(None),
            current_pack_info: Mutex::new(None),
            preloader: Arc::new(ImagePreloader::new(constants::PRELOADER_CACHE_SIZE)),
        }
    }
}

/// 导入材质包
#[tauri::command]
pub async fn import_pack_zip(
    zip_path: String,
    state: State<'_, AppState>,
) -> Result<PackInfo, String> {
    let zip_path = Path::new(&zip_path);

    // 验证ZIP文件
    if !validate_pack_zip(zip_path)? {
        return Err("Invalid resource pack: pack.mcmeta not found".to_string());
    }

    let zip_canon = fs::canonicalize(zip_path)
        .map_err(|e| format!("无法访问 ZIP 文件: {}", e))?;
    let zip_path = zip_canon.as_path();

    let parent = zip_path
        .parent()
        .ok_or_else(|| "无法确定 ZIP 所在目录".to_string())?;

    let stem = zip_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "pack".to_string());

    let extract_path = find_available_extract_path(parent, &stem);

    extract_zip(zip_path, &extract_path)?;

    // 扫描材质包
    let mut pack_info = scan_pack_directory(&extract_path)?;

    // 添加解压路径
    pack_info.pack_path = Some(extract_path.to_string_lossy().to_string());

    // 保存状态
    *state.current_pack_path.lock() = Some(extract_path);
    *state.current_pack_info.lock() = Some(pack_info.clone());

    Ok(pack_info)
}

/// 检查文件夹是否有pack.mcmeta
#[tauri::command]
pub async fn check_pack_mcmeta(folder_path: String) -> Result<bool, String> {
    let folder_path = Path::new(&folder_path);

    if !folder_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    Ok(folder_path.join("pack.mcmeta").exists())
}

/// 导入材质包
#[tauri::command]
pub async fn import_pack_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<PackInfo, String> {
    let folder_path = Path::new(&folder_path);

    if !folder_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    // 扫描材质包
    let pack_info = scan_pack_directory(folder_path)?;

    // 保存状态
    *state.current_pack_path.lock() = Some(folder_path.to_path_buf());
    *state.current_pack_info.lock() = Some(pack_info.clone());

    Ok(pack_info)
}

/// 获取当前材质包信息
#[tauri::command]
pub async fn get_current_pack_info(state: State<'_, AppState>) -> Result<Option<PackInfo>, String> {
    let pack_info = state.current_pack_info.lock();
    Ok(pack_info.clone())
}

/// 获取当前材质包路径
#[tauri::command]
pub async fn get_current_pack_path(state: State<'_, AppState>) -> Result<String, String> {
    let pack_path = state.current_pack_path.lock();
    match pack_path.as_ref() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("No pack loaded".to_string()),
    }
}

/// 获取图片缩略图
#[tauri::command]
pub async fn get_image_thumbnail(
    image_path: String,
    max_size: u32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let full_path = resolve_pack_path(&image_path, &state.current_pack_path)?;
    crate::image_handler::create_thumbnail_async(full_path, max_size).await
}

#[tauri::command]
pub async fn get_image_preview(
    image_path: String,
    size: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let full_path = resolve_pack_path(&image_path, &state.current_pack_path)?;

    let max_size = match size.as_str() {
        "thumbnail" => constants::IMAGE_SIZE_THUMBNAIL,
        "preview" => constants::IMAGE_SIZE_PREVIEW,
        "full" => constants::IMAGE_SIZE_FULL,
        _ => constants::IMAGE_SIZE_DEFAULT,
    };

    crate::image_handler::create_thumbnail_async(full_path, max_size).await
}

/// 获取图片信息
#[tauri::command]
pub async fn get_image_details(
    image_path: String,
    state: State<'_, AppState>,
) -> Result<ImageInfo, String> {
    let full_path = resolve_pack_path(&image_path, &state.current_pack_path)?;
    get_image_info(&full_path)
}

/// 导出材质包
#[tauri::command]
pub async fn export_pack(output_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = get_pack_base_path(&state.current_pack_path)?;
    let output = Path::new(&output_path);
    create_zip(&path, output)?;
    Ok(())
}

/// 清理临时文件
#[tauri::command]
pub async fn cleanup_temp() -> Result<(), String> {
    cleanup_temp_files()
}

/// 读取文件内容 
#[tauri::command]
pub async fn read_file_content(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;
    tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// 读取文件内容
#[tauri::command]
pub async fn read_file_binary(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;
    tokio::fs::read(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file_content(
    file_path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;

    // 创建父目录
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    tokio::fs::write(&full_path, content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// 创建新文件
#[tauri::command]
pub async fn create_new_file(
    file_path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;

    // 创建父目录
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 写入文件
    tokio::fs::write(&full_path, content)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    Ok(())
}

/// 创建新文件夹
#[tauri::command]
pub async fn create_new_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_path = resolve_pack_path(&folder_path, &state.current_pack_path)?;
    tokio::fs::create_dir_all(&full_path)
        .await
        .map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(())
}

/// 删除文件
#[tauri::command]
pub async fn delete_file(file_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;

    let metadata = tokio::fs::metadata(&full_path)
        .await
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&full_path)
            .await
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    } else {
        tokio::fs::remove_file(&full_path)
            .await
            .map_err(|e| format!("Failed to delete file: {}", e))?;
    }

    Ok(())
}

/// 重命名文件
#[tauri::command]
pub async fn rename_file(
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_old_path = resolve_pack_path(&old_path, &state.current_pack_path)?;
    let full_new_path = resolve_pack_path(&new_path, &state.current_pack_path)?;

    tokio::fs::rename(&full_old_path, &full_new_path)
        .await
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

/// 获取pack.mcmeta内容
#[tauri::command]
pub async fn get_pack_mcmeta(state: State<'_, AppState>) -> Result<String, String> {
    let path = get_pack_base_path(&state.current_pack_path)?;
    let mcmeta_path = path.join("pack.mcmeta");
    tokio::fs::read_to_string(mcmeta_path)
        .await
        .map_err(|e| format!("Failed to read pack.mcmeta: {}", e))
}

/// 更新pack.mcmeta
#[tauri::command]
pub async fn update_pack_mcmeta(content: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = get_pack_base_path(&state.current_pack_path)?;
    let mcmeta_path = path.join("pack.mcmeta");
    tokio::fs::write(&mcmeta_path, &content)
        .await
        .map_err(|e| format!("Failed to write pack.mcmeta: {}", e))?;

    // 重新扫描材质包
    let pack_info = scan_pack_directory(&path)?;
    let mut info_guard = state.current_pack_info.lock();
    *info_guard = Some(pack_info);

    Ok(())
}

/// 创建新材质包
#[tauri::command]
pub async fn create_new_pack(
    output_path: String,
    pack_name: String,
    pack_format: i32,
    description: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = std::path::Path::new(&output_path);
    crate::pack_creator::create_new_pack(path, &pack_name, pack_format, &description)?;

    // 自动加载新创建的材质包
    let pack_info = crate::pack_parser::scan_pack_directory(path)?;
    *state.current_pack_path.lock() = Some(path.to_path_buf());
    *state.current_pack_info.lock() = Some(pack_info);

    Ok(())
}

/// 为物品创建模型
#[tauri::command]
pub async fn create_item_model(item_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let pack_path_guard = state.current_pack_path.lock();
    let pack_info_guard = state.current_pack_info.lock();

    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?;
    let info = pack_info_guard.as_ref().ok_or("No pack loaded")?;
    let pack_format = info.pack_format;
    let path_clone = path.clone();

    drop(pack_path_guard);
    drop(pack_info_guard);

    crate::pack_creator::create_item_model(&path_clone, &item_id, pack_format)?;

    // 重新扫描材质包
    let new_pack_info = crate::pack_parser::scan_pack_directory(&path_clone)?;
    *state.current_pack_info.lock() = Some(new_pack_info);

    Ok(())
}

/// 为方块创建模型
#[tauri::command]
pub async fn create_block_model(
    block_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pack_path_guard = state.current_pack_path.lock();
    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?.clone();
    drop(pack_path_guard);

    crate::pack_creator::create_block_model(&path, &block_id)?;

    // 重新扫描材质包
    let pack_info = crate::pack_parser::scan_pack_directory(&path)?;
    *state.current_pack_info.lock() = Some(pack_info);

    Ok(())
}

/// 批量创建物品模型
#[tauri::command]
pub async fn create_multiple_item_models(
    item_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pack_path_guard = state.current_pack_path.lock();
    let pack_info_guard = state.current_pack_info.lock();

    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?;
    let info = pack_info_guard.as_ref().ok_or("No pack loaded")?;
    let pack_format = info.pack_format;
    let path_clone = path.clone();

    drop(pack_path_guard);
    drop(pack_info_guard);

    let created =
        crate::pack_creator::create_multiple_item_models(&path_clone, &item_ids, pack_format)?;

    // 重新扫描材质包
    let new_pack_info = crate::pack_parser::scan_pack_directory(&path_clone)?;
    *state.current_pack_info.lock() = Some(new_pack_info);

    Ok(created)
}
/// 批量创建方块模型
#[tauri::command]
pub async fn create_multiple_block_models(
    block_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pack_path_guard = state.current_pack_path.lock();
    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?.clone();
    drop(pack_path_guard);

    let created = crate::pack_creator::create_multiple_block_models(&path, &block_ids)?;

    // 重新扫描材质包
    let pack_info = crate::pack_parser::scan_pack_directory(&path)?;
    *state.current_pack_info.lock() = Some(pack_info);

    Ok(created)
}

/// 获取系统已安装的字体列表
#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let mut font_names = std::collections::HashSet::new();

    // 获取所有字体族
    let families = source
        .all_families()
        .map_err(|e| format!("Failed to get font families: {}", e))?;

    for family in families {
        font_names.insert(family);
    }

    // 转换为排序的向量
    let mut fonts: Vec<String> = font_names.into_iter().collect();
    fonts.sort();

    Ok(fonts)
}

/// 文件树节点
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
    pub file_count: Option<usize>,
    pub loaded: bool,
}

fn read_directory_tree_lazy(
    path: &Path,
    base_path: &Path,
    depth: usize,
    max_depth: usize,
) -> Result<Vec<FileTreeNode>, String> {
    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut entries: Vec<_> = entries
        .filter_map(|e| e.ok())
        .collect();

    entries.par_sort_unstable_by(|a, b| {
        let name_a = a.file_name().to_string_lossy().to_string();
        let name_b = b.file_name().to_string_lossy().to_string();
        name_a.cmp(&name_b)
    });

    let nodes: Vec<FileTreeNode> = entries
        .par_iter()
        .filter_map(|entry| {
            let entry_path = entry.path();
            let metadata = entry.metadata().ok()?;

            let relative_path = entry_path
                .strip_prefix(base_path)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .replace('\\', "/");

            let name = entry.file_name().to_string_lossy().to_string();
            
            // 跳过 .little100 目录
            if name == ".little100" {
                return None;
            }

            let node = if metadata.is_dir() {
                let file_count = std::fs::read_dir(&entry_path)
                    .map(|entries| entries.count())
                    .unwrap_or(0);

                let children = if depth < max_depth {
                    read_directory_tree_lazy(
                        &entry_path,
                        base_path,
                        depth + 1,
                        max_depth,
                    ).ok()
                } else {
                    None
                };

                FileTreeNode {
                    name,
                    path: relative_path,
                    is_dir: true,
                    children,
                    file_count: Some(file_count),
                    loaded: depth < max_depth,
                }
            } else {
                FileTreeNode {
                    name,
                    path: relative_path,
                    is_dir: false,
                    children: None,
                    file_count: None,
                    loaded: true,
                }
            };

            Some(node)
        })
        .collect();

    Ok(nodes)
}

/// 获取材质包的文件树结构
#[tauri::command]
pub async fn get_file_tree(state: State<'_, AppState>) -> Result<FileTreeNode, String> {
    let path = get_pack_base_path(&state.current_pack_path)?;
    
    let pack_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 锁已释放，安全执行目录遍历
    let children = read_directory_tree_lazy(&path, &path, 0, 2)?;

    let file_count = std::fs::read_dir(&path)
        .map(|entries| entries.count())
        .unwrap_or(0);

    Ok(FileTreeNode {
        name: pack_name,
        path: String::new(),
        is_dir: true,
        children: Some(children),
        file_count: Some(file_count),
        loaded: true,
    })
}

/// 懒加载指定文件夹的子节点
#[tauri::command]
pub async fn load_folder_children(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileTreeNode>, String> {
    let base_path = get_pack_base_path(&state.current_pack_path)?;
    
    let full_path = if folder_path.is_empty() {
        base_path.clone()
    } else {
        base_path.join(&folder_path)
    };

    read_directory_tree_lazy(&full_path, &base_path, 0, 1)
}

/// 创建透明PNG图片
#[tauri::command]
pub async fn create_transparent_png(
    file_path: String,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_path = resolve_pack_path(&file_path, &state.current_pack_path)?;
    crate::image_handler::create_transparent_png(&full_path, width, height)?;
    Ok(())
}

/// 保存编辑后的图片
#[tauri::command]
pub async fn save_image(
    image_path: String,
    base64_data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use base64::{engine::general_purpose, Engine as _};

    let full_path = resolve_pack_path(&image_path, &state.current_pack_path)?;

    // 解码base64数据
    let image_data = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // 确保父目录存在（使用 tokio::fs）
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 写入文件
    tokio::fs::write(&full_path, image_data)
        .await
        .map_err(|e| format!("Failed to save image: {}", e))?;

    Ok(())
}

/// 获取版本清单
#[tauri::command]
pub async fn get_minecraft_versions() -> Result<crate::version_downloader::VersionManifest, String>
{
    crate::version_downloader::fetch_version_manifest().await
}

/// 下载指定的版本jar文件
#[tauri::command]
pub async fn download_minecraft_version(version_id: String) -> Result<String, String> {
    // 获取src-tauri目录的路径
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;

    // 创建temp目录
    let temp_dir = exe_dir.join("temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 下载版本
    crate::version_downloader::download_version(&version_id, &temp_dir).await
}

/// 下载最新的release版本
#[tauri::command]
pub async fn download_latest_minecraft_version() -> Result<String, String> {
    // 获取src-tauri目录的路径
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;

    // 创建temp目录
    let temp_dir = exe_dir.join("temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 下载最新版本
    crate::version_downloader::download_latest_release(&temp_dir).await
}

/// 从jar文件中提取assets到指定目录
#[tauri::command]
pub async fn extract_assets_from_jar(jar_path: String, output_path: String) -> Result<(), String> {
    let jar = Path::new(&jar_path);
    let output = Path::new(&output_path);

    crate::version_downloader::extract_assets_from_jar(jar, output)
}

/// 下载版本并提取assets到材质包
#[tauri::command]
pub async fn download_and_extract_template(
    version_id: String,
    pack_path: String,
    keep_cache: bool,
    manager: State<'_, std::sync::Arc<crate::download_manager::DownloadManager>>,
) -> Result<String, String> {
    // 获取temp目录
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
    let temp_dir = exe_dir.join("temp");

    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output = Path::new(&pack_path);
    
    // 创建下载任务
    let task_id = manager.create_task(
        format!("下载模板: {}", version_id),
        "template".to_string(),
        output.to_path_buf(),
    ).await;
    
    // 克隆管理器用于异步任务
    let manager_clone = std::sync::Arc::clone(&manager);
    let task_id_clone = task_id.clone();
    let version_id_clone = version_id.clone();
    let temp_dir_clone = temp_dir.clone();
    let output_clone = output.to_path_buf();

    // 在后台启动下载任务
    tokio::spawn(async move {
        let result = crate::version_downloader::download_and_extract_version_with_progress(
            &version_id_clone,
            &temp_dir_clone,
            &output_clone,
            keep_cache,
            task_id_clone,
            (*manager_clone).clone(),
        )
        .await;
        
        if let Err(e) = result {
            println!("模板下载失败: {}", e);
        }
    });
    
    // 立即返回 task_id
    Ok(format!("Task created|TASK_ID|{}", task_id))
}

/// 清理模板缓存
#[tauri::command]
pub async fn clear_template_cache() -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
    let temp_dir = exe_dir.join("temp");

    crate::version_downloader::clear_template_cache(&temp_dir)
}

#[tauri::command]
pub async fn preload_folder_images(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let (base_path, full_path) = {
        let pack_path = state.current_pack_path.lock();

        let base_path = match pack_path.as_ref() {
            Some(path) => path.clone(),
            None => return Err("No pack loaded".to_string()),
        };

        let full_path = if folder_path.is_empty() {
            base_path.clone()
        } else {
            base_path.join(&folder_path)
        };

        (base_path, full_path)
    };
    state
        .preloader
        .preload_folder(&full_path, &base_path, 512)
        .await
}

#[tauri::command]
pub async fn get_preloader_stats(state: State<'_, AppState>) -> Result<(usize, usize), String> {
    Ok(state.preloader.get_stats().await)
}

#[tauri::command]
pub async fn clear_preloader_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.preloader.clear_cache().await;
    Ok(())
}

#[tauri::command]
pub async fn preload_folder_aggressive(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let (base_path, full_path) = {
        let pack_path = state.current_pack_path.lock();

        let base_path = match pack_path.as_ref() {
            Some(path) => path.clone(),
            None => return Err("No pack loaded".to_string()),
        };

        let full_path = if folder_path.is_empty() {
            base_path.clone()
        } else {
            base_path.join(&folder_path)
        };

        (base_path, full_path)
    };

    state
        .preloader
        .preload_folder_aggressive(&full_path, &base_path)
        .await
}

/// 打开指定文件夹
#[tauri::command]
pub async fn open_folder(folder_path: String) -> Result<(), String> {
    let path = Path::new(&folder_path);

    if !path.exists() {
        return Err(format!("文件夹不存在: {}", folder_path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// 写入日志到文件
#[allow(dead_code)]
pub async fn write_log(level: &str, message: &str) {
    let exe_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return,
    };

    let exe_dir = match exe_path.parent() {
        Some(dir) => dir,
        None => return,
    };

    let logs_dir = exe_dir.join("logs");

    // 确保logs目录存在
    if let Err(_) = std::fs::create_dir_all(&logs_dir) {
        return;
    }

    let log_file = logs_dir.join("latest.log");

    // 格式化日志条目
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_entry = format!("[{}] [{}] {}\n", timestamp, level.to_uppercase(), message);

    // 追加到文件
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        let _ = file.write_all(log_entry.as_bytes());
    }
}

/// 读取语言映射表
#[tauri::command]
pub async fn load_language_map(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    // 先获取路径，然后立即释放锁
    let map_file = {
        let pack_path = state.current_pack_path.lock();
        
        match pack_path.as_ref() {
            Some(path) => path.join(".little100").join("map.json"),
            None => return Ok(std::collections::HashMap::new()),
        }
    };

    if !map_file.exists() {
        return Ok(std::collections::HashMap::new());
    }
    
    // 读取并解析映射文件
    let content = tokio::fs::read_to_string(&map_file)
        .await
        .map_err(|e| format!("Failed to read map.json: {}", e))?;
    
    let map: std::collections::HashMap<String, String> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse map.json: {}", e))?;
    
    Ok(map)
}

/// 音效条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundEntry {
    pub key: String,
    pub translation: String,
    pub category: String,
}

/// 获取所有音效列表
#[tauri::command]
pub async fn get_sound_subtitles(state: State<'_, AppState>) -> Result<Vec<SoundEntry>, String> {
    // 加载语言映射表
    let language_map = load_language_map(state).await?;
    
    // 过滤键
    let mut sound_entries: Vec<SoundEntry> = language_map
        .iter()
        .filter(|(key, _)| key.starts_with("subtitles."))
        .map(|(key, translation)| {
            let category = key
                .strip_prefix("subtitles.")
                .and_then(|s| s.split('.').next())
                .unwrap_or("other")
                .to_string();
            
            SoundEntry {
                key: key.clone(),
                translation: translation.clone(),
                category,
            }
        })
        .collect();
    
    // 按分类和键排序
    sound_entries.sort_by(|a, b| {
        a.category.cmp(&b.category).then(a.key.cmp(&b.key))
    });
    
    Ok(sound_entries)
}

/// 搜索结果
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub file_path: String,
    pub match_type: String,
    pub line_number: Option<usize>,
    pub line_content: Option<String>,
    pub match_start: Option<usize>,
    pub match_end: Option<usize>,
    pub translation: Option<String>,
}

/// 搜索响应
#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub filename_matches: Vec<SearchResult>,
    pub content_matches: Vec<SearchResult>,
    pub total_count: usize,
}

/// 搜索文件
#[tauri::command]
pub async fn search_files(
    query: String,
    case_sensitive: bool,
    use_regex: bool,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let pack_path = state.current_pack_path.lock();
    
    let base_path = match pack_path.as_ref() {
        Some(path) => path.clone(),
        None => return Err("No pack loaded".to_string()),
    };
    
    drop(pack_path);
    
    // 加载语言映射表用于中文搜索
    let language_map = load_language_map_sync(&base_path);
    
    // 编译正则表达式或准备搜索模式
    let regex_pattern = if use_regex {
        Some(Regex::new(&query).map_err(|e| format!("Invalid regex pattern: {}", e))?)
    } else {
        None
    };
    
    // 收集所有文件
    let files = collect_searchable_files(&base_path)?;
    
    // 并行搜索
    let (filename_matches, content_matches): (Vec<_>, Vec<_>) = files
        .par_iter()
        .filter_map(|file_path| {
            search_in_file(
                file_path,
                &base_path,
                &query,
                case_sensitive,
                use_regex,
                regex_pattern.as_ref(),
                &language_map,
            ).ok()
        })
        .flatten()
        .partition(|result| result.match_type == "filename");
    
    // 限制结果数量
    let filename_matches: Vec<_> = filename_matches.into_iter().take(100).collect();
    let content_matches: Vec<_> = content_matches.into_iter().take(200).collect();
    
    let total_count = filename_matches.len() + content_matches.len();
    
    Ok(SearchResponse {
        filename_matches,
        content_matches,
        total_count,
    })
}

/// 收集可搜索的文件（并行优化版本）
fn collect_searchable_files(base_path: &Path) -> Result<Vec<PathBuf>, String> {
    use walkdir::WalkDir;
    
    // 并行收集文件
    let files: Vec<PathBuf> = WalkDir::new(base_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // 排除 .history 和 .little100
            if let Some(name) = e.file_name().to_str() {
                !matches!(name, ".history" | ".little100")
            } else {
                true
            }
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            if let Some(ext) = e.path().extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                matches!(ext_str.as_str(), "json" | "mcmeta" | "txt" | "png" | "lang")
            } else {
                false
            }
        })
        .map(|e| e.path().to_path_buf())
        .collect();
    
    Ok(files)
}

/// 同步加载语言映射表
fn load_language_map_sync(base_path: &Path) -> std::collections::HashMap<String, String> {
    let map_file = base_path.join(".little100").join("map.json");
    
    if !map_file.exists() {
        return std::collections::HashMap::new();
    }
    
    match std::fs::read_to_string(&map_file) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_default()
        }
        Err(_) => std::collections::HashMap::new(),
    }
}

/// 获取文件的中文翻译
fn get_file_translation(
    file_path: &Path,
    base_path: &Path,
    language_map: &std::collections::HashMap<String, String>,
) -> Option<String> {
    if language_map.is_empty() {
        return None;
    }
    
    let relative_path = file_path
        .strip_prefix(base_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace('\\', "/");
    
    // 移除文件扩展名
    let path_without_ext = relative_path.rsplit_once('.').map(|(p, _)| p).unwrap_or(&relative_path);
    
    // 检查是否是 block 路径
    if path_without_ext.contains("assets/minecraft/textures/block/") {
        if let Some(block_name) = path_without_ext.strip_prefix("assets/minecraft/textures/block/") {
            let map_key = format!("block.minecraft.{}", block_name.replace('/', "."));
            if let Some(translation) = language_map.get(&map_key) {
                return Some(translation.clone());
            }
        }
    }
    // 检查是否是 item 路径
    else if path_without_ext.contains("assets/minecraft/textures/item/") {
        if let Some(item_name) = path_without_ext.strip_prefix("assets/minecraft/textures/item/") {
            let map_key = format!("item.minecraft.{}", item_name.replace('/', "."));
            if let Some(translation) = language_map.get(&map_key) {
                return Some(translation.clone());
            }
        }
    }
    
    None
}

/// 检查文件路径是否匹配中文查询
fn check_chinese_match(
    file_path: &Path,
    base_path: &Path,
    query: &str,
    case_sensitive: bool,
    language_map: &std::collections::HashMap<String, String>,
) -> Option<(usize, usize)> {
    // 如果映射表为空,直接返回
    if language_map.is_empty() {
        return None;
    }
    
    // 只在查询包含 CJK 字符时才进行映射搜索
    if !query.chars().any(constants::is_cjk_char) {
        return None;
    }
    
    let relative_path = file_path
        .strip_prefix(base_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace('\\', "/");
    
    // 移除文件扩展名
    let path_without_ext = relative_path.rsplit_once('.').map(|(p, _)| p).unwrap_or(&relative_path);
    
    // 检查是否是 block 或 item 路径
    if path_without_ext.contains("assets/minecraft/textures/block/") {
        // 提取 block 名称,如 assets/minecraft/textures/block/cherry_log -> cherry_log
        if let Some(block_name) = path_without_ext.strip_prefix("assets/minecraft/textures/block/") {
            let map_key = format!("block.minecraft.{}", block_name.replace('/', "."));
            
            if let Some(translation) = language_map.get(&map_key) {
                let search_translation = if case_sensitive {
                    translation.clone()
                } else {
                    translation.to_lowercase()
                };
                
                let search_query = if case_sensitive {
                    query.to_string()
                } else {
                    query.to_lowercase()
                };
                
                if let Some(pos) = search_translation.find(&search_query) {
                    return Some((pos, pos + query.len()));
                }
            }
        }
    } else if path_without_ext.contains("assets/minecraft/textures/item/") {
        // 提取 item 名称,如 assets/minecraft/textures/item/diamond -> diamond
        if let Some(item_name) = path_without_ext.strip_prefix("assets/minecraft/textures/item/") {
            let map_key = format!("item.minecraft.{}", item_name.replace('/', "."));
            
            if let Some(translation) = language_map.get(&map_key) {
                let search_translation = if case_sensitive {
                    translation.clone()
                } else {
                    translation.to_lowercase()
                };
                
                let search_query = if case_sensitive {
                    query.to_string()
                } else {
                    query.to_lowercase()
                };
                
                if let Some(pos) = search_translation.find(&search_query) {
                    return Some((pos, pos + query.len()));
                }
            }
        }
    }
    
    None
}

/// 在单个文件中搜索
fn search_in_file(
    file_path: &Path,
    base_path: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    regex_pattern: Option<&Regex>,
    language_map: &std::collections::HashMap<String, String>,
) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    
    let relative_path = file_path
        .strip_prefix(base_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace('\\', "/");
    
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    // 获取文件的中文翻译(如果存在)
    let translation = get_file_translation(file_path, base_path, language_map);
    
    // 搜索文件名
    let (filename_match, match_start, match_end) = if use_regex {
        if let Some(regex) = regex_pattern {
            if regex.is_match(&file_name) {
                if let Some(mat) = regex.find(&file_name) {
                    (true, Some(mat.start()), Some(mat.end()))
                } else {
                    (true, None, None)
                }
            } else {
                (false, None, None)
            }
        } else {
            (false, None, None)
        }
    } else {
        // 尝试直接匹配文件名
        let search_name = if case_sensitive {
            file_name.clone()
        } else {
            file_name.to_lowercase()
        };
        let search_query = if case_sensitive {
            query.to_string()
        } else {
            query.to_lowercase()
        };
        
        if let Some(pos) = search_name.find(&search_query) {
            (true, Some(pos), Some(pos + query.len()))
        } else {
            if let Some((start, end)) = check_chinese_match(file_path, base_path, query, case_sensitive, language_map) {
                (true, Some(start), Some(end))
            } else {
                (false, None, None)
            }
        }
    };
    
    if filename_match {
        results.push(SearchResult {
            file_path: relative_path.clone(),
            match_type: "filename".to_string(),
            line_number: None,
            line_content: None,
            match_start,
            match_end,
            translation: translation.clone(),
        });
    }
    
    // 搜索文件内容
    if let Some(ext) = file_path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if matches!(ext_str.as_str(), "json" | "mcmeta" | "txt" | "lang") {
            // 读取文件内容限制大小
            let metadata = std::fs::metadata(file_path).ok();
            if let Some(meta) = metadata {
                if meta.len() > constants::SEARCH_MAX_FILE_SIZE {
                    // 文件过大跳过内容搜索
                    return Ok(results);
                }
            }
            
            // 预计算小写查询字符串，避免在循环中重复调用
            let query_lower = if !case_sensitive { query.to_lowercase() } else { String::new() };
            
            if let Ok(content) = std::fs::read_to_string(file_path) {
                for (line_num, line) in content.lines().enumerate() {
                    let line_match = if use_regex {
                        if let Some(regex) = regex_pattern {
                            regex.is_match(line)
                        } else {
                            false
                        }
                    } else {
                        if case_sensitive {
                            line.contains(query)
                        } else {
                            line.to_lowercase().contains(&query_lower)
                        }
                    };
                    
                    if line_match {
                        let (match_start, match_end) = if use_regex {
                            if let Some(regex) = regex_pattern {
                                if let Some(mat) = regex.find(line) {
                                    (Some(mat.start()), Some(mat.end()))
                                } else {
                                    (None, None)
                                }
                            } else {
                                (None, None)
                            }
                        } else {
                            let search_line = if case_sensitive {
                                line.to_string()
                            } else {
                                line.to_lowercase()
                            };
                            let search_query = if case_sensitive {
                                query.to_string()
                            } else {
                                query.to_lowercase()
                            };
                            
                            if let Some(pos) = search_line.find(&search_query) {
                                (Some(pos), Some(pos + query.len()))
                            } else {
                                (None, None)
                            }
                        };
                        
                        results.push(SearchResult {
                            file_path: relative_path.clone(),
                            match_type: "content".to_string(),
                            line_number: Some(line_num + 1),
                            line_content: Some(line.to_string()),
                            match_start,
                            match_end,
                            translation: None, // 内容匹配不需要翻译
                        });
                    }
                }
            }
        }
    }
    
    Ok(results)
}

/// 下载声音资源
#[tauri::command]
pub async fn download_minecraft_sounds(
    state: State<'_, AppState>,
    manager: State<'_, std::sync::Arc<crate::download_manager::DownloadManager>>,
    concurrent_downloads: Option<usize>,
) -> Result<String, String> {
    use std::sync::Arc;
    
    let output_dir = {
        let pack_path = state.current_pack_path.lock();
        match pack_path.as_ref() {
            Some(path) => path.clone(),
            None => return Err("没有加载材质包".to_string()),
        }
    };
    
    // 创建下载任务
    let task_id = manager.create_task(
        "Minecraft 声音资源".to_string(),
        "sounds".to_string(),
        output_dir.clone(),
    ).await;
    
    let manager_clone = Arc::clone(&manager);
    let task_id_clone = task_id.clone();
    
    // 在后台启动下载任务
    tokio::spawn(async move {
        let result = crate::version_downloader::download_minecraft_sounds_with_progress(
            &output_dir,
            task_id_clone.clone(),
            manager_clone.clone(),
            concurrent_downloads.unwrap_or(32),
        ).await;
        
        // 更新最终状态
        match result {
            Ok(_message) => {
                let progress = crate::download_manager::DownloadProgress {
                    task_id: task_id_clone.clone(),
                    status: crate::download_manager::DownloadStatus::Completed,
                    current: 100,
                    total: 100,
                    current_file: None,
                    speed: 0.0,
                    eta: None,
                    error: None,
                };
                manager_clone.update_progress(&task_id_clone, progress).await;
            }
            Err(e) => {
                let progress = crate::download_manager::DownloadProgress {
                    task_id: task_id_clone.clone(),
                    status: crate::download_manager::DownloadStatus::Failed,
                    current: 0,
                    total: 100,
                    current_file: None,
                    speed: 0.0,
                    eta: None,
                    error: Some(e),
                };
                manager_clone.update_progress(&task_id_clone, progress).await;
            }
        }
        
        // 移除取消令牌
        manager_clone.remove_cancel_token(&task_id_clone).await;
    });
    Ok(task_id)
}

/// 读取pack.mcmeta文件内容
#[tauri::command]
pub async fn read_pack_mcmeta(path: String, is_zip: bool) -> Result<serde_json::Value, String> {
    use std::fs::File;
    use std::io::Read;
    use zip::ZipArchive;

    if is_zip {
        // 从ZIP文件中读取pack.mcmeta
        let file = File::open(&path)
            .map_err(|e| format!("无法打开ZIP文件: {}", e))?;
        
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("无法读取ZIP文件: {}", e))?;
        
        // 查找pack.mcmeta文件
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("无法读取ZIP内容: {}", e))?;
            
            let file_name = file.name().to_string();
            if file_name == "pack.mcmeta" || file_name.ends_with("/pack.mcmeta") {
                let mut contents = String::new();
                file.read_to_string(&mut contents)
                    .map_err(|e| format!("无法读取pack.mcmeta: {}", e))?;
                
                // 解析
                let json: serde_json::Value = serde_json::from_str(&contents)
                    .map_err(|e| format!("无法解析pack.mcmeta JSON: {}", e))?;
                
                return json.get("pack")
                    .ok_or_else(|| "pack.mcmeta中缺少pack字段".to_string())
                    .map(|v| v.clone());
            }
        }
        
        Err("ZIP文件中未找到pack.mcmeta".to_string())
    } else {
        // 从文件夹中读取pack.mcmeta
        let mcmeta_path = Path::new(&path).join("pack.mcmeta");
        
        if !mcmeta_path.exists() {
            return Err("文件夹中未找到pack.mcmeta".to_string());
        }
        
        let mut file = File::open(&mcmeta_path)
            .map_err(|e| format!("无法打开pack.mcmeta: {}", e))?;
        
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| format!("无法读取pack.mcmeta: {}", e))?;
        
        let json: serde_json::Value = serde_json::from_str(&contents)
            .map_err(|e| format!("无法解析pack.mcmeta JSON: {}", e))?;
        
        json.get("pack")
            .ok_or_else(|| "pack.mcmeta中缺少pack字段".to_string())
            .map(|v| v.clone())
    }
}

/// 获取支持的版本列表
#[tauri::command]
pub async fn get_supported_versions() -> Result<Vec<(u32, String)>, String> {
    Ok(crate::version_converter::get_supported_versions())
}

/// 转换材质包版本
#[tauri::command]
pub async fn convert_pack_version(
    input_path: String,
    output_path: String,
    target_version: String,
) -> Result<String, String> {
    let input = Path::new(&input_path);
    let output = Path::new(&output_path);
    
    crate::version_converter::convert_pack_version(input, output, &target_version)
}

/// 获取URL内容
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("Invalid URL: {}", e))?;
    
    let host = parsed.host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    
    if constants::is_blocked_host(host) {
        return Err(format!("Access denied: blocked host '{}'", host));
    }
    
    let is_trusted = constants::is_trusted_domain(host);
    
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error! status: {}", response.status()));
    }
    
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(serde_json::json!({
        "body": body,
        "trusted": is_trusted,
        "host": host,
    }))
}

/// 检查文件是否存在
#[tauri::command]
pub fn check_file_exists(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    Ok(path.exists())
}

/// 复制音频文件到资源包
#[tauri::command]
pub async fn copy_sound_file(
    sound_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 获取路径
    let base_path = {
        let pack_path = state.current_pack_path.lock();
        match pack_path.as_ref() {
            Some(path) => path.clone(),
            None => return Err("No pack loaded".to_string()),
        }
    };
    
    let source_ogg = base_path.join(".little100").join("sounds").join(format!("{}.ogg", sound_name));
    let source_wav = base_path.join(".little100").join("sounds").join(format!("{}.wav", sound_name));
    
    let target_path = base_path.join("assets").join("minecraft").join("sounds").join(format!("{}.ogg", sound_name));
    
    // 确定源文件
    let source_path = if source_ogg.exists() {
        source_ogg
    } else if source_wav.exists() {
        source_wav
    } else {
        return Err(format!("音频文件不存在: {}", sound_name));
    };
    
    // 创建目标目录
    if let Some(parent) = target_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // 复制文件
    tokio::fs::copy(&source_path, &target_path)
        .await
        .map_err(|e| format!("Failed to copy audio file: {}", e))?;
    
    Ok(())
}

/// 检查临时文件夹中的音频文件
#[tauri::command]
pub async fn check_temp_audio_files(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let pack_path = state.current_pack_path.lock();
    
    let base_path = match pack_path.as_ref() {
        Some(path) => path.clone(),
        None => return Err("No pack loaded".to_string()),
    };
    
    drop(pack_path);
    
    let sounds_dir = base_path.join(".little100").join("sounds");
    
    if !sounds_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut audio_files = Vec::new();
    
    use walkdir::WalkDir;
    for entry in WalkDir::new(&sounds_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "ogg" | "wav") {
                    if let Ok(relative) = entry.path().strip_prefix(&sounds_dir) {
                        audio_files.push(relative.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
    }
    
    Ok(audio_files)
}

/// 读取文件内容并转换为 base64
#[tauri::command]
pub async fn read_file_as_base64(file_path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    
    let file_content = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(&file_content))
}

/// 在资源管理器中打开文件或文件夹
#[tauri::command]
pub async fn open_in_explorer(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let full_path = {
        let pack_path = state.current_pack_path.lock();
        
        match pack_path.as_ref() {
            Some(base_path) => {
                let path = Path::new(&file_path);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base_path.join(path)
                }
            }
            None => PathBuf::from(&file_path),
        }
    };
    
    // 检查路径是否存在
    if !full_path.exists() {
        return Err(format!("路径不存在: {}", full_path.display()));
    }
    
    // 根据操作系统打开资源管理器
    #[cfg(target_os = "windows")]
    {
        if full_path.is_file() {
            std::process::Command::new("explorer")
                .args(&["/select,", &full_path.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {}", e))?;
        } else {
            std::process::Command::new("explorer")
                .arg(&full_path)
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {}", e))?;
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        if full_path.is_file() {
            std::process::Command::new("open")
                .args(&["-R", &full_path.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("无法打开 Finder: {}", e))?;
        } else {
            std::process::Command::new("open")
                .arg(&full_path)
                .spawn()
                .map_err(|e| format!("无法打开 Finder: {}", e))?;
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        if full_path.is_file() {
            // 尝试打开父目录
            if let Some(parent) = full_path.parent() {
                std::process::Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("无法打开文件管理器: {}", e))?;
            }
        } else {
            std::process::Command::new("xdg-open")
                .arg(&full_path)
                .spawn()
                .map_err(|e| format!("无法打开文件管理器: {}", e))?;
        }
    }

    Ok(())
}

/// 读取融合来源中单个文件
#[tauri::command]
pub async fn read_merge_source_file_base64(
    source_path: String,
    source_type: PackSourceType,
    relative_path: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let bytes = tokio::task::spawn_blocking(move || {
        crate::pack_merger::read_merge_source_file_bytes(&source_path, &source_type, &relative_path)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

/// 预览融合/分析冲突
#[tauri::command]
pub async fn preview_pack_merge(
    sources: Vec<MergeSourceInput>,
) -> Result<MergePreview, String> {
    preview_merge(sources)
}

/// 执行融合
#[tauri::command]
pub async fn execute_pack_merge(
    app_handle: tauri::AppHandle,
    sources: Vec<MergeSourceInput>,
    config: MergeConfig,
) -> Result<MergeResult, String> {
    execute_merge_async(app_handle, sources, config).await
}

/// 获取pack.mcmeta
#[tauri::command]
pub async fn get_pack_meta_from_source(
    path: String,
    source_type: PackSourceType,
) -> Result<serde_json::Value, String> {
    use std::fs;
    use crate::zip_handler::extract_zip;

    let path_obj = std::path::Path::new(&path);
    let mcmeta_content = if source_type == PackSourceType::Zip {
        let temp_dir = get_temp_extract_dir()
            .join("merge_temp")
            .join(uuid::Uuid::new_v4().to_string());
        extract_zip(path_obj, &temp_dir)
            .map_err(|e| format!("无法解压: {}", e))?;
        let mcmeta_path = temp_dir.join("pack.mcmeta");
        if !mcmeta_path.exists() {
            return Err("该包不包含 pack.mcmeta".to_string());
        }
        fs::read_to_string(&mcmeta_path)
            .map_err(|e| format!("无法读取 pack.mcmeta: {}", e))?
    } else {
        let mcmeta_path = path_obj.join("pack.mcmeta");
        if !mcmeta_path.exists() {
            return Err("该包不包含 pack.mcmeta".to_string());
        }
        fs::read_to_string(&mcmeta_path)
            .map_err(|e| format!("无法读取 pack.mcmeta: {}", e))?
    };

    serde_json::from_str(&mcmeta_content)
        .map_err(|e| format!("无法解析 pack.mcmeta JSON: {}", e))
}

/// 打开devtools
#[tauri::command]
pub async fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}
