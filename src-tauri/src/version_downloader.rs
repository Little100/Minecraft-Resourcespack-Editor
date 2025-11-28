use serde::{Deserialize, Serialize};
use std::path::Path;

/// 版本清单
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionInfo>,
}

/// 最新版本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

/// 版本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

/// 版本详细信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDetails {
    pub id: String,
    pub downloads: Downloads,
    #[serde(rename = "assetIndex")]
    pub asset_index: Option<AssetIndex>,
}

/// 资源索引信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
    pub url: String,
}

/// 资源对象信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

/// 下载信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Downloads {
    pub client: Option<DownloadInfo>,
    pub server: Option<DownloadInfo>,
}

/// 单个下载信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

const VERSION_MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest.json";

/// 获取版本清单
pub async fn fetch_version_manifest() -> Result<VersionManifest, String> {
    let response = reqwest::get(VERSION_MANIFEST_URL)
        .await
        .map_err(|e| format!("Failed to fetch version manifest: {}", e))?;
    
    let manifest = response
        .json::<VersionManifest>()
        .await
        .map_err(|e| format!("Failed to parse version manifest: {}", e))?;
    
    Ok(manifest)
}

/// 获取版本详细信息
pub async fn fetch_version_details(version_url: &str) -> Result<VersionDetails, String> {
    let response = reqwest::get(version_url)
        .await
        .map_err(|e| format!("Failed to fetch version details: {}", e))?;
    
    let details = response
        .json::<VersionDetails>()
        .await
        .map_err(|e| format!("Failed to parse version details: {}", e))?;
    
    Ok(details)
}

/// 下载jar文件
pub async fn download_jar_with_progress(
    download_url: &str,
    output_path: &Path,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;
    
    // 确保输出目录存在
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // 下载文件
    let response = reqwest::get(download_url)
        .await
        .map_err(|e| format!("Failed to download jar: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    
    // 创建文件
    let mut file = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    // 流式下载
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        
        downloaded += chunk.len() as u64;
        
        // 进度
        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            println!("Download progress: {}%", progress);
        }
    }
    
    Ok(())
}

/// 获取最新的release版本并下载
pub async fn download_latest_release(output_dir: &Path) -> Result<String, String> {
    // 获取版本清单
    let manifest = fetch_version_manifest().await?;
    
    // 找到最新的release版本
    let latest_release = manifest.versions
        .iter()
        .find(|v| v.id == manifest.latest.release)
        .ok_or("Latest release version not found")?;
    
    // 获取版本详细信息
    let details = fetch_version_details(&latest_release.url).await?;
    
    // 获取客户端下载链接
    let client_download = details.downloads.client
        .ok_or("Client download not available")?;
    
    // 构建输出路径
    let output_path = output_dir.join(format!("{}.jar", details.id));
    
    // 检查文件是否已存在(缓存)
    if output_path.exists() {
        println!("Using cached jar file: {:?}", output_path);
        return Ok(details.id);
    }
    
    // 下载jar文件
    download_jar_with_progress(&client_download.url, &output_path).await?;
    
    Ok(details.id)
}
/// 下载指定版本
pub async fn download_version(
    version_id: &str,
    output_dir: &Path,
) -> Result<String, String> {
    // 获取版本清单
    let manifest = fetch_version_manifest().await?;
    
    // 找到指定版本
    let version = manifest.versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or(format!("Version {} not found", version_id))?;
    
    // 获取版本详细信息
    let details = fetch_version_details(&version.url).await?;
    
    // 获取客户端下载链接
    let client_download = details.downloads.client
        .ok_or("Client download not available")?;
    
    // 构建输出路径
    let output_path = output_dir.join(format!("{}.jar", details.id));
    
    // 检查文件是否已存在(缓存)
    if output_path.exists() {
        println!("Using cached jar file: {:?}", output_path);
        return Ok(output_path.to_string_lossy().to_string());
    }
    
    // 下载jar文件
    download_jar_with_progress(&client_download.url, &output_path).await?;
    
    Ok(output_path.to_string_lossy().to_string())
}

/// 从jar文件中提取assets文件夹
pub fn extract_assets_from_jar(jar_path: &Path, output_dir: &Path) -> Result<(), String> {
    use std::fs::File;
    use std::io::Read;
    use zip::ZipArchive;
    
    // 打开jar文件
    let file = File::open(jar_path)
        .map_err(|e| format!("Failed to open jar file: {}", e))?;
    
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read jar archive: {}", e))?;
    
    // 遍历所有文件
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;
        
        let file_path = file.name().to_string();
        
        // 只提取assets目录下的文件
        if file_path.starts_with("assets/") {
            let output_path = output_dir.join(&file_path);
            
            if file.is_dir() {
                // 创建目录
                std::fs::create_dir_all(&output_path)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                // 确保父目录存在
                if let Some(parent) = output_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
                
                // 写入文件
                let mut output_file = File::create(&output_path)
                    .map_err(|e| format!("Failed to create output file: {}", e))?;
                
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)
                    .map_err(|e| format!("Failed to read file content: {}", e))?;
                
                std::io::Write::write_all(&mut output_file, &buffer)
                    .map_err(|e| format!("Failed to write file: {}", e))?;
            }
        }
    }
    
    Ok(())
}

/// 下载语言文件
async fn download_language_file(
    version_url: &str,
    version_id: &str,
    output_dir: &Path,
    task_id: Option<String>,
    manager: Option<crate::download_manager::DownloadManager>,
) -> Result<(bool, bool, String), String> {
    use std::collections::HashMap;
    use crate::download_manager::{DownloadProgress, DownloadStatus};
    
    // 获取版本详细信息
    let response = reqwest::get(version_url)
        .await
        .map_err(|e| format!("Failed to fetch version details: {}", e))?;
    
    let details: VersionDetails = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse version details: {}", e))?;
    
    // 检查是否有 assetIndex
    let asset_index = match details.asset_index {
        Some(index) => index,
        None => {
            println!("No assetIndex found, skipping language file download");
            return Ok((false, false, version_id.to_string()));
        }
    };
    
    // 获取资源索引
    let response = reqwest::get(&asset_index.url)
        .await
        .map_err(|e| format!("Failed to fetch asset index: {}", e))?;
    
    let assets: HashMap<String, AssetObject> = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse asset index: {}", e))?
        .get("objects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or("Failed to parse objects from asset index")?;
    
    // 查找中文语言文件
    let lang_key = "minecraft/lang/zh_cn.json";
    let lang_asset = match assets.get(lang_key) {
        Some(asset) => asset,
        None => {
            // 如果当前版本没有中文文件使用最新 release版本
            println!("Chinese language file not found for version {}, trying latest release", version_id);
            
            // 更新进度信息
            if let (Some(tid), Some(mgr)) = (&task_id, &manager) {
                mgr.update_progress(tid, DownloadProgress {
                    task_id: tid.clone(),
                    status: DownloadStatus::Downloading,
                    current: 3,
                    total: 4,
                    current_file: Some(format!("版本 {} 无中文文件，使用最新版本...", version_id)),
                    speed: 0.0,
                    eta: None,
                    error: None,
                }).await;
            }
            
            // 获取版本清单
            let manifest = fetch_version_manifest().await?;
            let latest_version = manifest.versions
                .iter()
                .find(|v| v.id == manifest.latest.release)
                .ok_or("Latest release version not found")?;
            
            if latest_version.id == version_id {
                return Err(format!("Chinese language file not found for version {} and latest release", version_id));
            }
            
            return Box::pin(download_language_file(&latest_version.url, &latest_version.id, output_dir, task_id, manager)).await
                .map(|(success, _, _)| (success, true, latest_version.id.clone()));
        }
    };
    
    // 构建下载URL: https://resources.download.minecraft.net/{前2位}/{完整hash}
    let hash = &lang_asset.hash;
    let download_url = format!(
        "https://resources.download.minecraft.net/{}/{}",
        &hash[0..2],
        hash
    );
    
    // 下载语言文件
    let response = reqwest::get(&download_url)
        .await
        .map_err(|e| format!("Failed to download language file: {}", e))?;
    
    let content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read language file: {}", e))?;
    
    // 保存为 .little100/map.json
    let little100_dir = output_dir.join(".little100");
    std::fs::create_dir_all(&little100_dir)
        .map_err(|e| format!("Failed to create .little100 directory: {}", e))?;
    
    let map_json_path = little100_dir.join("map.json");
    std::fs::write(&map_json_path, &content)
        .map_err(|e| format!("Failed to write map.json: {}", e))?;
    
    // 保存到 assets/minecraft/lang/zh_cn.lang
    let lang_dir = output_dir.join("assets").join("minecraft").join("lang");
    std::fs::create_dir_all(&lang_dir)
        .map_err(|e| format!("Failed to create lang directory: {}", e))?;
    
    let zh_cn_path = lang_dir.join("zh_cn.lang");
    std::fs::write(&zh_cn_path, &content)
        .map_err(|e| format!("Failed to write zh_cn.lang: {}", e))?;
    
    println!("Successfully downloaded and saved language file for version {}", version_id);
    Ok((true, false, version_id.to_string()))
}

/// 下载版本并提取assets
pub async fn download_and_extract_version(
    version_id: &str,
    temp_dir: &Path,
    output_dir: &Path,
    keep_cache: bool,
) -> Result<String, String> {
    // 获取版本清单以获取版本URL
    let manifest = fetch_version_manifest().await?;
    let version = manifest.versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or(format!("Version {} not found", version_id))?;
    
    // 下载jar文件
    let jar_path = download_version(version_id, temp_dir).await?;
    
    // 提取assets
    extract_assets_from_jar(Path::new(&jar_path), output_dir)?;
    
    // 下载语言文件并返回结果
    let lang_result = download_language_file(&version.url, version_id, output_dir, None, None).await;
    
    let result_message = match lang_result {
        Ok((_, used_latest, actual_version)) => {
            if used_latest {
                format!("Successfully extracted assets from version {}|LANG_FALLBACK|{}", version_id, actual_version)
            } else {
                format!("Successfully extracted assets from version {}", version_id)
            }
        },
        Err(e) => {
            println!("Warning: Failed to download language file: {}", e);
            format!("Successfully extracted assets from version {}", version_id)
        }
    };
    
    // 根据设置决定是否删除jar文件
    if !keep_cache {
        std::fs::remove_file(&jar_path).ok();
    }
    
    Ok(result_message)
}

/// 下载版本并提取assets
pub async fn download_and_extract_version_with_progress(
    version_id: &str,
    temp_dir: &Path,
    output_dir: &Path,
    keep_cache: bool,
    task_id: String,
    manager: crate::download_manager::DownloadManager,
) -> Result<String, String> {
    use crate::download_manager::{DownloadProgress, DownloadStatus};
    
    // 获取版本清单
    manager.update_progress(&task_id, DownloadProgress {
        task_id: task_id.clone(),
        status: DownloadStatus::Downloading,
        current: 0,
        total: 4,
        current_file: Some("获取版本信息...".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    let manifest = fetch_version_manifest().await.map_err(|e| {
        let error_msg = format!("获取版本清单失败: {}", e);
        tokio::spawn({
            let manager = manager.clone();
            let task_id_clone = task_id.clone();
            let error_msg = error_msg.clone();
            async move {
                let task_id_clone2 = task_id_clone.clone();
                manager.update_progress(&task_id_clone, DownloadProgress {
                    task_id: task_id_clone2,
                    status: DownloadStatus::Failed,
                    current: 0,
                    total: 4,
                    current_file: None,
                    speed: 0.0,
                    eta: None,
                    error: Some(error_msg),
                }).await;
            }
        });
        error_msg
    })?;
    
    let version = manifest.versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| format!("未找到版本 {}", version_id))?;
    
    // 下载jar文件
    manager.update_progress(&task_id, DownloadProgress {
        task_id: task_id.clone(),
        status: DownloadStatus::Downloading,
        current: 1,
        total: 4,
        current_file: Some(format!("下载 {}.jar...", version_id)),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    let jar_path = download_version(version_id, temp_dir).await.map_err(|e| {
        let error_msg = format!("下载jar文件失败: {}", e);
        tokio::spawn({
            let manager = manager.clone();
            let task_id_clone = task_id.clone();
            let error_msg = error_msg.clone();
            async move {
                let task_id_clone2 = task_id_clone.clone();
                manager.update_progress(&task_id_clone, DownloadProgress {
                    task_id: task_id_clone2,
                    status: DownloadStatus::Failed,
                    current: 1,
                    total: 4,
                    current_file: None,
                    speed: 0.0,
                    eta: None,
                    error: Some(error_msg),
                }).await;
            }
        });
        error_msg
    })?;
    
    // 提取assets
    manager.update_progress(&task_id, DownloadProgress {
        task_id: task_id.clone(),
        status: DownloadStatus::Downloading,
        current: 2,
        total: 4,
        current_file: Some("提取资源文件...".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    extract_assets_from_jar(Path::new(&jar_path), output_dir).map_err(|e| {
        let error_msg = format!("提取资源失败: {}", e);
        tokio::spawn({
            let manager = manager.clone();
            let task_id_clone = task_id.clone();
            let error_msg = error_msg.clone();
            async move {
                let task_id_clone2 = task_id_clone.clone();
                manager.update_progress(&task_id_clone, DownloadProgress {
                    task_id: task_id_clone2,
                    status: DownloadStatus::Failed,
                    current: 2,
                    total: 4,
                    current_file: None,
                    speed: 0.0,
                    eta: None,
                    error: Some(error_msg),
                }).await;
            }
        });
        error_msg
    })?;
    
    // 下载语言文件
    manager.update_progress(&task_id, DownloadProgress {
        task_id: task_id.clone(),
        status: DownloadStatus::Downloading,
        current: 3,
        total: 4,
        current_file: Some("下载中文语言文件...".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    
    let lang_result = download_language_file(&version.url, version_id, output_dir, Some(task_id.clone()), Some(manager.clone())).await;
    
    let result_message = match lang_result {
        Ok((_, used_latest, actual_version)) => {
            if used_latest {
                format!("Successfully extracted assets from version {}|LANG_FALLBACK|{}", version_id, actual_version)
            } else {
                format!("Successfully extracted assets from version {}", version_id)
            }
        },
        Err(e) => {
            println!("Warning: Failed to download language file: {}", e);
            format!("Successfully extracted assets from version {}", version_id)
        }
    };
    
    // 根据设置决定是否删除jar文件
    if !keep_cache {
        std::fs::remove_file(&jar_path).ok();
    }
    
    // 完成
    manager.update_progress(&task_id, DownloadProgress {
        task_id: task_id.clone(),
        status: DownloadStatus::Completed,
        current: 4,
        total: 4,
        current_file: Some("完成！".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    
    Ok(result_message)
}

/// 清理缓存的jar文件
pub fn clear_template_cache(temp_dir: &Path) -> Result<(), String> {
    if !temp_dir.exists() {
        return Ok(());
    }
    
    let entries = std::fs::read_dir(temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        
        if path.extension().and_then(|s| s.to_str()) == Some("jar") {
            std::fs::remove_file(&path).ok();
        }
    }
    
    Ok(())
}

/// 下载 最新版sounds.json和所有.ogg文件
pub async fn download_minecraft_sounds(output_dir: &Path) -> Result<String, String> {
    use std::collections::HashMap;
    
    println!("[下载声音资源] 开始下载最新版本的声音资源...");
    
    let manifest = fetch_version_manifest().await?;
    let latest_release = manifest.versions
        .iter()
        .find(|v| v.id == manifest.latest.release)
        .ok_or("未找到最新 release 版本")?;
    
    println!("[下载声音资源] 最新版本: {}", latest_release.id);
    
    let details = fetch_version_details(&latest_release.url).await?;
    
    // 获取资源索引
    let asset_index = details.asset_index
        .ok_or("该版本没有资源索引")?;
    
    println!("[下载声音资源] 资源索引 ID: {}", asset_index.id);
    
    // 下载资源索引文件
    let response = reqwest::get(&asset_index.url)
        .await
        .map_err(|e| format!("下载资源索引失败: {}", e))?;
    
    let assets: HashMap<String, AssetObject> = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析资源索引失败: {}", e))?
        .get("objects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or("解析资源对象失败")?;
    
    let little100_dir = output_dir.join(".little100");
    std::fs::create_dir_all(&little100_dir)
        .map_err(|e| format!("创建 .little100 目录失败: {}", e))?;
    
    let sounds_json_key = "minecraft/sounds.json";
    let sounds_json_asset = assets.get(sounds_json_key)
        .ok_or("未找到 sounds.json")?;
    
    println!("[下载声音资源] 下载 sounds.json...");
    let sounds_json_url = format!(
        "https://resources.download.minecraft.net/{}/{}",
        &sounds_json_asset.hash[0..2],
        sounds_json_asset.hash
    );
    
    let sounds_json_content = reqwest::get(&sounds_json_url)
        .await
        .map_err(|e| format!("下载 sounds.json 失败: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("读取 sounds.json 失败: {}", e))?;
    
    // 保存到 .little100/sounds.json
    let sounds_json_path = little100_dir.join("sounds.json");
    std::fs::write(&sounds_json_path, &sounds_json_content)
        .map_err(|e| format!("保存 sounds.json 失败: {}", e))?;
    
    let ogg_files: Vec<(String, &AssetObject)> = assets
        .iter()
        .filter(|(key, _)| key.starts_with("minecraft/sounds/") && key.ends_with(".ogg"))
        .map(|(key, value)| (key.clone(), value))
        .collect();
    
    println!("[下载声音资源] 找到 {} 个音频文件", ogg_files.len());
    
    let sounds_dir = little100_dir.join("sounds");
    std::fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("创建 sounds 目录失败: {}", e))?;
    
    let total = ogg_files.len();
    for (index, (key, asset)) in ogg_files.iter().enumerate() {
        let relative_path = key.strip_prefix("minecraft/sounds/")
            .ok_or_else(|| format!("无效的路径: {}", key))?;
        
        let file_path = sounds_dir.join(relative_path);
        
        // 创建父目录
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }
        
        // 下载文件
        let url = format!(
            "https://resources.download.minecraft.net/{}/{}",
            &asset.hash[0..2],
            asset.hash
        );
        
        let content = reqwest::get(&url)
            .await
            .map_err(|e| format!("下载文件失败 {}: {}", relative_path, e))?
            .bytes()
            .await
            .map_err(|e| format!("读取文件失败 {}: {}", relative_path, e))?;
        
        std::fs::write(&file_path, &content)
            .map_err(|e| format!("保存文件失败 {}: {}", relative_path, e))?;
        
        if (index + 1) % 50 == 0 || index == total - 1 {
            println!("[下载声音资源] 进度: {}/{}", index + 1, total);
        }
    }
    
    println!("[下载声音资源] 下载完成！");
    println!("[下载声音资源] sounds.json 已保存到: {:?}", sounds_json_path);
    println!("[下载声音资源] 音频文件已保存到: {:?}", sounds_dir);
    
    Ok(format!("成功下载 {} 的声音资源 (共 {} 个文件)", latest_release.id, total))
}

/// 下载 Minecraft 声音资源
pub async fn download_minecraft_sounds_with_progress(
    output_dir: &Path,
    task_id: String,
    manager: std::sync::Arc<crate::download_manager::DownloadManager>,
    concurrent_downloads: usize,
) -> Result<String, String> {
    use std::collections::HashMap;
    use tokio_util::sync::CancellationToken;
    use futures_util::StreamExt;
    
    // 限制线程数在 1-256 之间
    let concurrent_downloads = concurrent_downloads.clamp(1, 256);
    
    println!("[下载声音资源] 开始下载最新版本的声音资源...");
    
    // 创建取消令牌
    let cancel_token = CancellationToken::new();
    manager.register_cancel_token(task_id.clone(), cancel_token.clone()).await;
    
    let manifest = fetch_version_manifest().await?;
    let latest_release = manifest.versions
        .iter()
        .find(|v| v.id == manifest.latest.release)
        .ok_or("未找到最新 release 版本")?;
    
    println!("[下载声音资源] 最新版本: {}", latest_release.id);
    
    manager.update_progress(&task_id, crate::download_manager::DownloadProgress {
        task_id: task_id.clone(),
        status: crate::download_manager::DownloadStatus::Downloading,
        current: 0,
        total: 100,
        current_file: Some("获取版本信息...".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    
    // 检查取消
    if cancel_token.is_cancelled() {
        return Err("下载已取消".to_string());
    }
    
    let details = fetch_version_details(&latest_release.url).await?;
    
    let asset_index = details.asset_index
        .ok_or("该版本没有资源索引")?;
    
    println!("[下载声音资源] 资源索引 ID: {}", asset_index.id);
    
    manager.update_progress(&task_id, crate::download_manager::DownloadProgress {
        task_id: task_id.clone(),
        status: crate::download_manager::DownloadStatus::Downloading,
        current: 5,
        total: 100,
        current_file: Some("下载资源索引...".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    
    let response = reqwest::get(&asset_index.url)
        .await
        .map_err(|e| format!("下载资源索引失败: {}", e))?;
    
    let assets: HashMap<String, AssetObject> = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析资源索引失败: {}", e))?
        .get("objects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or("解析资源对象失败")?;
    
    // 检查取消
    if cancel_token.is_cancelled() {
        return Err("下载已取消".to_string());
    }
    
    // 创建 .little100 目录
    let little100_dir = output_dir.join(".little100");
    std::fs::create_dir_all(&little100_dir)
        .map_err(|e| format!("创建 .little100 目录失败: {}", e))?;
    
    let sounds_json_key = "minecraft/sounds.json";
    let sounds_json_asset = assets.get(sounds_json_key)
        .ok_or("未找到 sounds.json")?;
    
    manager.update_progress(&task_id, crate::download_manager::DownloadProgress {
        task_id: task_id.clone(),
        status: crate::download_manager::DownloadStatus::Downloading,
        current: 10,
        total: 100,
        current_file: Some("sounds.json".to_string()),
        speed: 0.0,
        eta: None,
        error: None,
    }).await;
    
    println!("[下载声音资源] 下载 sounds.json...");
    let sounds_json_url = format!(
        "https://resources.download.minecraft.net/{}/{}",
        &sounds_json_asset.hash[0..2],
        sounds_json_asset.hash
    );
    
    let sounds_json_content = reqwest::get(&sounds_json_url)
        .await
        .map_err(|e| format!("下载 sounds.json 失败: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("读取 sounds.json 失败: {}", e))?;
    
    // 保存到 .little100/sounds.json
    let sounds_json_path = little100_dir.join("sounds.json");
    std::fs::write(&sounds_json_path, &sounds_json_content)
        .map_err(|e| format!("保存 sounds.json 失败: {}", e))?;
    
    // 检查取消
    if cancel_token.is_cancelled() {
        return Err("下载已取消".to_string());
    }
    
    // 查找所有 .ogg 文件
    let ogg_files: Vec<(String, &AssetObject)> = assets
        .iter()
        .filter(|(key, _)| key.starts_with("minecraft/sounds/") && key.ends_with(".ogg"))
        .map(|(key, value)| (key.clone(), value))
        .collect();
    
    println!("[下载声音资源] 找到 {} 个音频文件", ogg_files.len());
    
    // 载所有 .ogg 文件
    let sounds_dir = little100_dir.join("sounds");
    std::fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("创建 sounds 目录失败: {}", e))?;
    
    let total = ogg_files.len();
    let start_time = std::time::Instant::now();
    
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let total_bytes = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    
    // 创建并发下载流
    let download_stream = futures_util::stream::iter(
        ogg_files.iter()
            .enumerate()
            .map(|(idx, (k, a))| (idx, k.clone(), (*a).clone()))
            .collect::<Vec<_>>()
    )
        .map(|(_index, key, asset)| {
            let cancel_token = cancel_token.clone();
            let sounds_dir = sounds_dir.clone();
            let task_id = task_id.clone();
            let manager = manager.clone();
            let completed = completed.clone();
            let total_bytes = total_bytes.clone();
            let start_time = start_time;
            
            async move {
                // 检查取消
                if cancel_token.is_cancelled() {
                    return Err("下载已取消".to_string());
                }
                
                // 提取相对路径
                let relative_path = key.strip_prefix("minecraft/sounds/")
                    .ok_or_else(|| format!("无效的路径: {}", key))?;
                
                let file_path = sounds_dir.join(relative_path);
                
                // 创建父目录
                if let Some(parent) = file_path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("创建目录失败: {}", e))?;
                }
                
                // 下载文件
                let url = format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    &asset.hash[0..2],
                    asset.hash
                );
                
                let mut retry_count = 0;
                let max_retries = 3;
                let content = loop {
                    match reqwest::get(&url).await {
                        Ok(response) => {
                            match response.bytes().await {
                                Ok(bytes) => break bytes,
                                Err(e) => {
                                    retry_count += 1;
                                    if retry_count >= max_retries {
                                        return Err(format!("读取文件失败 {} (重试{}次后): {}", relative_path, max_retries, e));
                                    }
                                    tokio::time::sleep(tokio::time::Duration::from_millis(500 * retry_count as u64)).await;
                                }
                            }
                        }
                        Err(e) => {
                            retry_count += 1;
                            if retry_count >= max_retries {
                                return Err(format!("下载文件失败 {} (重试{}次后): {}", relative_path, max_retries, e));
                            }
                            tokio::time::sleep(tokio::time::Duration::from_millis(500 * retry_count as u64)).await;
                        }
                    }
                };
                
                tokio::fs::write(&file_path, &content)
                    .await
                    .map_err(|e| format!("保存文件失败 {}: {}", relative_path, e))?;
                
                // 更新计数器
                let current = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                total_bytes.fetch_add(asset.size, std::sync::atomic::Ordering::Relaxed);
                
                // 计算进度和速度
                let progress_percent = 10 + ((current as f64 / total as f64) * 85.0) as usize;
                let elapsed = start_time.elapsed().as_secs_f64();
                let bytes = total_bytes.load(std::sync::atomic::Ordering::Relaxed);
                let speed = if elapsed > 0.0 {
                    bytes as f64 / elapsed
                } else {
                    0.0
                };
                let remaining = total - current;
                let avg_file_size = if current > 0 { bytes / current as u64 } else { 0 };
                let eta = if speed > 0.0 && avg_file_size > 0 {
                    Some((remaining as f64 * avg_file_size as f64 / speed) as u64)
                } else {
                    None
                };
                
                // 更新进度
                manager.update_progress(&task_id, crate::download_manager::DownloadProgress {
                    task_id: task_id.clone(),
                    status: crate::download_manager::DownloadStatus::Downloading,
                    current: progress_percent,
                    total: 100,
                    current_file: Some(format!("{}/{} - {}", current, total, relative_path)),
                    speed,
                    eta,
                    error: None,
                }).await;
                
                if current % 50 == 0 || current == total {
                    println!("[下载声音资源] 进度: {}/{}", current, total);
                }
                
                Ok::<(), String>(())
            }
        })
        .buffer_unordered(concurrent_downloads);
    
    // 收集所有结果
    let results: Vec<Result<(), String>> = download_stream.collect().await;
    
    // 检查是否有错误
    for result in results {
        result?;
    }
    
    println!("[下载声音资源] 下载完成！");
    println!("[下载声音资源] sounds.json 已保存到: {:?}", sounds_json_path);
    println!("[下载声音资源] 音频文件已保存到: {:?}", sounds_dir);
    
    Ok(format!("成功下载 {} 的声音资源 (共 {} 个文件)", latest_release.id, total))
}