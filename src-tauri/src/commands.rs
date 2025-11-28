use crate::image_handler::{get_image_info, ImageInfo};
use crate::pack_parser::{scan_pack_directory, PackInfo};
use crate::preloader::ImagePreloader;
use crate::zip_handler::{
    cleanup_temp_files, create_zip, extract_zip, get_temp_extract_dir, validate_pack_zip,
};
use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use regex::Regex;
use rayon::prelude::*;

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
            preloader: Arc::new(ImagePreloader::new(200)),
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

    // 解压到临时目录
    let temp_dir = get_temp_extract_dir();
    let extract_path = temp_dir.join(
        zip_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    );

    extract_zip(zip_path, &extract_path)?;

    // 扫描材质包
    let pack_info = scan_pack_directory(&extract_path)?;

    // 保存状态
    *state.current_pack_path.lock().unwrap() = Some(extract_path);
    *state.current_pack_info.lock().unwrap() = Some(pack_info.clone());

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

    // 扫描材质包(即使没有pack.mcmeta也允许导入)
    let pack_info = scan_pack_directory(folder_path)?;

    // 保存状态
    *state.current_pack_path.lock().unwrap() = Some(folder_path.to_path_buf());
    *state.current_pack_info.lock().unwrap() = Some(pack_info.clone());

    Ok(pack_info)
}

/// 获取当前材质包信息
#[tauri::command]
pub async fn get_current_pack_info(state: State<'_, AppState>) -> Result<Option<PackInfo>, String> {
    let pack_info = state.current_pack_info.lock().unwrap();
    Ok(pack_info.clone())
}

/// 获取当前材质包路径
#[tauri::command]
pub async fn get_current_pack_path(state: State<'_, AppState>) -> Result<String, String> {
    let pack_path = state.current_pack_path.lock().unwrap();
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
    let full_path = {
        let pack_path = state.current_pack_path.lock().unwrap();

        match pack_path.as_ref() {
            Some(base_path) => {
                let path = Path::new(&image_path);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base_path.join(path)
                }
            }
            None => PathBuf::from(&image_path),
        }
    };

    crate::image_handler::create_thumbnail_async(full_path, max_size).await
}

#[tauri::command]
pub async fn get_image_preview(
    image_path: String,
    size: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let full_path = {
        let pack_path = state.current_pack_path.lock().unwrap();

        match pack_path.as_ref() {
            Some(base_path) => {
                let path = Path::new(&image_path);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base_path.join(path)
                }
            }
            None => PathBuf::from(&image_path),
        }
    };

    let max_size = match size.as_str() {
        "thumbnail" => 128, // 缩略
        "preview" => 512,   // 预览
        "full" => 2048,     // 全图
        _ => 512,           // 默认
    };

    // 使用异步
    crate::image_handler::create_thumbnail_async(full_path, max_size).await
}

/// 获取图片信息
#[tauri::command]
pub async fn get_image_details(
    image_path: String,
    state: State<'_, AppState>,
) -> Result<ImageInfo, String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&image_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => PathBuf::from(&image_path),
    };

    get_image_info(&full_path)
}

/// 导出材质包
#[tauri::command]
pub async fn export_pack(output_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    match pack_path.as_ref() {
        Some(path) => {
            let output = Path::new(&output_path);
            create_zip(path, output)?;
            Ok(())
        }
        None => Err("No pack loaded".to_string()),
    }
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
    let full_path = {
        let pack_path = state.current_pack_path.lock().unwrap();

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

    tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// 写入文件内容
#[tauri::command]
pub async fn read_file_binary(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let full_path = {
        let pack_path = state.current_pack_path.lock().unwrap();

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
    let full_path = {
        let pack_path = state.current_pack_path.lock().unwrap();

        match pack_path.as_ref() {
            Some(base_path) => {
                let path = Path::new(&file_path);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base_path.join(path)
                }
            }
            None => {
                // 如果没有加载材质包，尝试直接使用路径
                PathBuf::from(&file_path)
            }
        }
    };

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
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&file_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    // 创建父目录
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 写入文件
    std::fs::write(&full_path, content).map_err(|e| format!("Failed to create file: {}", e))?;

    Ok(())
}

/// 创建新文件夹
#[tauri::command]
pub async fn create_new_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&folder_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    // 创建文件夹
    std::fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create folder: {}", e))?;

    Ok(())
}

/// 删除文件
#[tauri::command]
pub async fn delete_file(file_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&file_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    // 判断是文件还是目录
    let metadata =
        std::fs::metadata(&full_path).map_err(|e| format!("Failed to get file metadata: {}", e))?;

    if metadata.is_dir() {
        std::fs::remove_dir_all(&full_path)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    } else {
        std::fs::remove_file(&full_path).map_err(|e| format!("Failed to delete file: {}", e))?;
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
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_old_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&old_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    let full_new_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&new_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    std::fs::rename(&full_old_path, &full_new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

/// 获取pack.mcmeta内容
#[tauri::command]
pub async fn get_pack_mcmeta(state: State<'_, AppState>) -> Result<String, String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    match pack_path.as_ref() {
        Some(path) => {
            let mcmeta_path = path.join("pack.mcmeta");
            std::fs::read_to_string(mcmeta_path)
                .map_err(|e| format!("Failed to read pack.mcmeta: {}", e))
        }
        None => Err("No pack loaded".to_string()),
    }
}

/// 更新pack.mcmeta
#[tauri::command]
pub async fn update_pack_mcmeta(content: String, state: State<'_, AppState>) -> Result<(), String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    match pack_path.as_ref() {
        Some(path) => {
            let mcmeta_path = path.join("pack.mcmeta");
            std::fs::write(mcmeta_path, content)
                .map_err(|e| format!("Failed to write pack.mcmeta: {}", e))?;

            // 重新扫描材质包
            let pack_info = scan_pack_directory(path)?;
            drop(pack_path);
            *state.current_pack_info.lock().unwrap() = Some(pack_info);

            Ok(())
        }
        None => Err("No pack loaded".to_string()),
    }
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
    *state.current_pack_path.lock().unwrap() = Some(path.to_path_buf());
    *state.current_pack_info.lock().unwrap() = Some(pack_info);

    Ok(())
}

/// 为物品创建模型
#[tauri::command]
pub async fn create_item_model(item_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let pack_path_guard = state.current_pack_path.lock().unwrap();
    let pack_info_guard = state.current_pack_info.lock().unwrap();

    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?;
    let info = pack_info_guard.as_ref().ok_or("No pack loaded")?;
    let pack_format = info.pack_format;
    let path_clone = path.clone();

    drop(pack_path_guard);
    drop(pack_info_guard);

    crate::pack_creator::create_item_model(&path_clone, &item_id, pack_format)?;

    // 重新扫描材质包
    let new_pack_info = crate::pack_parser::scan_pack_directory(&path_clone)?;
    *state.current_pack_info.lock().unwrap() = Some(new_pack_info);

    Ok(())
}

/// 为方块创建模型
#[tauri::command]
pub async fn create_block_model(
    block_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pack_path_guard = state.current_pack_path.lock().unwrap();
    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?.clone();
    drop(pack_path_guard);

    crate::pack_creator::create_block_model(&path, &block_id)?;

    // 重新扫描材质包
    let pack_info = crate::pack_parser::scan_pack_directory(&path)?;
    *state.current_pack_info.lock().unwrap() = Some(pack_info);

    Ok(())
}

/// 批量创建物品模型
#[tauri::command]
pub async fn create_multiple_item_models(
    item_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pack_path_guard = state.current_pack_path.lock().unwrap();
    let pack_info_guard = state.current_pack_info.lock().unwrap();

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
    *state.current_pack_info.lock().unwrap() = Some(new_pack_info);

    Ok(created)
}
/// 批量创建方块模型
#[tauri::command]
pub async fn create_multiple_block_models(
    block_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let pack_path_guard = state.current_pack_path.lock().unwrap();
    let path = pack_path_guard.as_ref().ok_or("No pack loaded")?.clone();
    drop(pack_path_guard);

    let created = crate::pack_creator::create_multiple_block_models(&path, &block_ids)?;

    // 重新扫描材质包
    let pack_info = crate::pack_parser::scan_pack_directory(&path)?;
    *state.current_pack_info.lock().unwrap() = Some(pack_info);

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

    let mut entries: Vec<_> = entries.collect();

    entries.sort_unstable_by(|a, b| {
        let name_a = a
            .as_ref()
            .ok()
            .and_then(|e| e.file_name().into_string().ok())
            .unwrap_or_default();
        let name_b = b
            .as_ref()
            .ok()
            .and_then(|e| e.file_name().into_string().ok())
            .unwrap_or_default();
        name_a.cmp(&name_b)
    });

    let mut nodes = Vec::with_capacity(entries.len());

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let relative_path = entry_path
            .strip_prefix(base_path)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");

        let name = entry.file_name().to_string_lossy().to_string();
        
        // 跳忽略 .little100 目录
        if name == ".little100" {
            continue;
        }

        let node = if metadata.is_dir() {
            let file_count = std::fs::read_dir(&entry_path)
                .map(|entries| entries.count())
                .unwrap_or(0);

            let children = if depth < max_depth {
                Some(read_directory_tree_lazy(
                    &entry_path,
                    base_path,
                    depth + 1,
                    max_depth,
                )?)
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

        nodes.push(node);
    }

    Ok(nodes)
}

/// 获取材质包的文件树结构
#[tauri::command]
pub async fn get_file_tree(state: State<'_, AppState>) -> Result<FileTreeNode, String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    match pack_path.as_ref() {
        Some(path) => {
            let pack_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let children = read_directory_tree_lazy(path, path, 0, 2)?;

            let file_count = std::fs::read_dir(path)
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
        None => Err("No pack loaded".to_string()),
    }
}

/// 懒加载指定文件夹的子节点
#[tauri::command]
pub async fn load_folder_children(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileTreeNode>, String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    match pack_path.as_ref() {
        Some(base_path) => {
            let full_path = if folder_path.is_empty() {
                base_path.clone()
            } else {
                base_path.join(&folder_path)
            };

            read_directory_tree_lazy(&full_path, base_path, 0, 1)
        }
        None => Err("No pack loaded".to_string()),
    }
}

/// 创建透明PNG图片
#[tauri::command]
pub async fn create_transparent_png(
    file_path: String,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&file_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

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

    let pack_path = state.current_pack_path.lock().unwrap();

    let full_path = match pack_path.as_ref() {
        Some(base_path) => {
            let path = Path::new(&image_path);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                base_path.join(path)
            }
        }
        None => {
            return Err("No pack loaded".to_string());
        }
    };

    // 解码base64数据
    let image_data = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // 写入文件
    std::fs::write(&full_path, image_data).map_err(|e| format!("Failed to save image: {}", e))?;

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
) -> Result<String, String> {
    // 获取temp目录
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
    let temp_dir = exe_dir.join("temp");

    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output = Path::new(&pack_path);

    // 下载并提取
    crate::version_downloader::download_and_extract_version(
        &version_id,
        &temp_dir,
        output,
        keep_cache,
    )
    .await
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
        let pack_path = state.current_pack_path.lock().unwrap();

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
        let pack_path = state.current_pack_path.lock().unwrap();

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

/// Debug信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugInfo {
    pub cpu_cores: usize,
    pub cached_files: usize,
    pub gpu_info: String,
    pub throughput: String,
    pub total_time: String,
    pub logs: Vec<DebugLog>,
}

/// Debug日志条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugLog {
    pub level: String,
    pub message: String,
}

/// 获取调试信息
#[tauri::command]
pub async fn get_debug_info(state: State<'_, AppState>) -> Result<DebugInfo, String> {
    // 获取CPU核心数
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    // 获取缓存统计
    let (cached_files, _loading) = state.preloader.get_stats().await;

    // 获取GPU信息
    let gpu_info = "请在前端获取".to_string();

    // 读取日志文件
    let logs = read_latest_logs().await;

    Ok(DebugInfo {
        cpu_cores,
        cached_files,
        gpu_info,
        throughput: if cached_files > 0 {
            format!("{} 文件/秒", cached_files)
        } else {
            "N/A".to_string()
        },
        total_time: "N/A".to_string(),
        logs,
    })
}

/// 打开日志文件夹
#[tauri::command]
pub async fn open_logs_folder() -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
    let logs_dir = exe_dir.join("logs");

    // 确保logs目录存在
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Failed to create logs directory: {}", e))?;

    // 打开文件夹
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(logs_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(logs_dir)
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
        let pack_path = state.current_pack_path.lock().unwrap();
        
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

/// 读取最新的日志
async fn read_latest_logs() -> Vec<DebugLog> {
    let exe_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };

    let exe_dir = match exe_path.parent() {
        Some(dir) => dir,
        None => return Vec::new(),
    };

    let log_file = exe_dir.join("logs").join("latest.log");

    if !log_file.exists() {
        return Vec::new();
    }

    // 读取日志文件
    let content = match std::fs::read_to_string(&log_file) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    // 只返回最后50行
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > 50 {
        lines.len() - 50
    } else {
        0
    };

    lines[start..]
        .iter()
        .filter_map(|line| {
            if let Some(level_start) = line.find("] [") {
                if let Some(level_end) = line[level_start + 3..].find(']') {
                    let level = &line[level_start + 3..level_start + 3 + level_end];
                    let message = &line[level_start + 3 + level_end + 2..];

                    return Some(DebugLog {
                        level: level.to_lowercase(),
                        message: message.to_string(),
                    });
                }
            }
            None
        })
        .collect()
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
    let pack_path = state.current_pack_path.lock().unwrap();
    
    let base_path = match pack_path.as_ref() {
        Some(path) => path.clone(),
        None => return Err("No pack loaded".to_string()),
    };
    
    drop(pack_path);
    
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

/// 收集可搜索的文件
fn collect_searchable_files(base_path: &Path) -> Result<Vec<PathBuf>, String> {
    use walkdir::WalkDir;
    
    let mut files = Vec::new();
    
    for entry in WalkDir::new(base_path)
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
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                // 支持的文件类型
                if matches!(ext_str.as_str(), "json" | "mcmeta" | "txt" | "png") {
                    files.push(entry.path().to_path_buf());
                }
            }
        }
    }
    
    Ok(files)
}

/// 在单个文件中搜索
fn search_in_file(
    file_path: &Path,
    base_path: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    regex_pattern: Option<&Regex>,
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
    
    // 搜索文件名
    let filename_match = if use_regex {
        if let Some(regex) = regex_pattern {
            regex.is_match(&file_name)
        } else {
            false
        }
    } else {
        if case_sensitive {
            file_name.contains(query)
        } else {
            file_name.to_lowercase().contains(&query.to_lowercase())
        }
    };
    
    if filename_match {
        let (match_start, match_end) = if use_regex {
            if let Some(regex) = regex_pattern {
                if let Some(mat) = regex.find(&file_name) {
                    (Some(mat.start()), Some(mat.end()))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        } else {
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
                (Some(pos), Some(pos + query.len()))
            } else {
                (None, None)
            }
        };
        
        results.push(SearchResult {
            file_path: relative_path.clone(),
            match_type: "filename".to_string(),
            line_number: None,
            line_content: None,
            match_start,
            match_end,
        });
    }
    
    // 搜索文件内容
    if let Some(ext) = file_path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if matches!(ext_str.as_str(), "json" | "mcmeta" | "txt") {
            // 读取文件内容限制大小为 10MB
            let metadata = std::fs::metadata(file_path).ok();
            if let Some(meta) = metadata {
                if meta.len() > 10 * 1024 * 1024 {
                    // 文件过大跳过内容搜索
                    return Ok(results);
                }
            }
            
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
                            line.to_lowercase().contains(&query.to_lowercase())
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
                        });
                    }
                }
            }
        }
    }
    
    Ok(results)
}