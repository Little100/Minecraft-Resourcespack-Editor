use std::path::{Path, PathBuf};
use std::fs;
use std::io::{Read, Write};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

#[derive(Debug, Deserialize)]
struct VersionMap {
    resource_pack: HashMap<String, Vec<String>>,
    last_updated: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PackMeta {
    pub pack: PackInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PackInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack_format: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_format: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_format: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_formats: Option<Value>,
}

pub fn convert_pack_version(
    input_path: &Path,
    output_path: &Path,
    target_version: &str,
) -> Result<String, String> {
    let target_pack_format = get_pack_format_from_version(target_version)?;
    
    if input_path.is_file() {
        convert_zip_pack(input_path, output_path, target_pack_format)
    } else if input_path.is_dir() {
        convert_folder_pack(input_path, output_path, target_pack_format)
    } else {
        Err("输入路径既不是文件也不是文件夹".to_string())
    }
}

fn get_pack_format_from_version(version: &str) -> Result<u32, String> {
    let versions = get_supported_versions();
    
    for (pack_format, ver_string) in versions {
        if ver_string == version {
            return Ok(pack_format);
        }
    }
    
    Err(format!("不支持的版本: {}", version))
}

fn convert_zip_pack(
    input_path: &Path,
    output_path: &Path,
    target_pack_format: u32,
) -> Result<String, String> {
    let file = fs::File::open(input_path)
        .map_err(|e| format!("无法打开输入ZIP: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("无法读取ZIP文件: {}", e))?;
    
    let output_file = fs::File::create(output_path)
        .map_err(|e| format!("无法创建输出ZIP: {}", e))?;
    let mut zip_writer = zip::ZipWriter::new(output_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("无法读取ZIP内容: {}", e))?;
        let file_name = file.name().to_string();
        
        if file_name == "pack.mcmeta" || file_name.ends_with("/pack.mcmeta") {
            let mut contents = String::new();
            file.read_to_string(&mut contents)
                .map_err(|e| format!("无法读取pack.mcmeta: {}", e))?;
            
            let new_contents = update_pack_format_in_json(&contents, target_pack_format)?;
            
            zip_writer.start_file(&file_name, options)
                .map_err(|e| format!("无法创建文件: {}", e))?;
            zip_writer.write_all(new_contents.as_bytes())
                .map_err(|e| format!("无法写入文件: {}", e))?;
        } else {
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("无法读取文件内容: {}", e))?;
            
            zip_writer.start_file(&file_name, options)
                .map_err(|e| format!("无法创建文件: {}", e))?;
            zip_writer.write_all(&buffer)
                .map_err(|e| format!("无法写入文件: {}", e))?;
        }
    }
    
    zip_writer.finish()
        .map_err(|e| format!("无法完成ZIP写入: {}", e))?;
    
    Ok(format!("成功转换到输出路径: {:?}", output_path))
}

/// 转换文件夹格式的资源包
fn convert_folder_pack(
    input_path: &Path,
    output_path: &Path,
    target_pack_format: u32,
) -> Result<String, String> {
    if output_path.exists() {
        fs::remove_dir_all(output_path)
            .map_err(|e| format!("无法删除已存在的输出目录: {}", e))?;
    }
    
    // 复制整个文件夹
    copy_dir_all(input_path, output_path)?;
    
    // 修改pack.mcmeta
    let mcmeta_path = output_path.join("pack.mcmeta");
    if mcmeta_path.exists() {
        let contents = fs::read_to_string(&mcmeta_path)
            .map_err(|e| format!("无法读取pack.mcmeta: {}", e))?;
        
        let new_contents = update_pack_format_in_json(&contents, target_pack_format)?;
        
        fs::write(&mcmeta_path, new_contents)
            .map_err(|e| format!("无法写入pack.mcmeta: {}", e))?;
    } else {
        return Err("未找到pack.mcmeta文件".to_string());
    }
    
    Ok(format!("成功转换到输出路径: {:?}", output_path))
}

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("无法创建目录: {}", e))?;
    
    for entry in fs::read_dir(src)
        .map_err(|e| format!("无法读取目录: {}", e))? {
        let entry = entry.map_err(|e| format!("无法读取条目: {}", e))?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest_path = dst.join(&file_name);
        
        if path.is_dir() {
            copy_dir_all(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)
                .map_err(|e| format!("无法复制文件: {}", e))?;
        }
    }
    
    Ok(())
}

/// 更新pack_format
fn update_pack_format_in_json(json_str: &str, new_pack_format: u32) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(json_str)
        .map_err(|e| format!("无法解析JSON: {}", e))?;
    
    // 修改pack_format
    if let Some(pack) = value.get_mut("pack") {
        if let Some(obj) = pack.as_object_mut() {
            // 检查原始文件是否使用1.21.9+的格式
            let has_new_format = obj.contains_key("min_format") || obj.contains_key("max_format");
            
            // 移除所有版本相关字段
            obj.remove("supported_formats");
            obj.remove("supported_format");
            obj.remove("min_format");
            obj.remove("max_format");
            
            if new_pack_format >= 69 && has_new_format {
                // 保持使用新格式
                obj.insert("min_format".to_string(),
                    Value::Array(vec![Value::Number(new_pack_format.into()), Value::Number(0.into())]));
                obj.insert("max_format".to_string(),
                    Value::Array(vec![Value::Number(999.into()), Value::Number(0.into())]));
                obj.insert("pack_format".to_string(), Value::Number(new_pack_format.into()));
            } else {
                obj.insert("pack_format".to_string(), Value::Number(new_pack_format.into()));
            }
        }
    }
    
    // 格式化输出
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("无法序列化JSON: {}", e))
}

/// 获取支持的版本列表
pub fn get_supported_versions() -> Vec<(u32, String)> {
    if let Ok(versions) = load_version_map_from_file() {
        return versions;
    }
    
    // 如果读取失败使用备用数据
    vec![
        (1, "1.6.1 – 1.8.9".to_string()),
        (2, "1.9 – 1.10.2".to_string()),
        (3, "1.11 – 1.12.2".to_string()),
        (4, "1.13 – 1.14.4".to_string()),
        (5, "1.15 – 1.16.1".to_string()),
        (6, "1.16.2 – 1.16.5".to_string()),
        (7, "1.17 – 1.17.1".to_string()),
        (8, "1.18 – 1.18.2".to_string()),
        (9, "1.19 – 1.19.2".to_string()),
        (12, "1.19.3".to_string()),
        (13, "1.19.4".to_string()),
        (15, "1.20 – 1.20.1".to_string()),
        (18, "1.20.2".to_string()),
        (22, "1.20.3 – 1.20.4".to_string()),
        (32, "1.20.5 – 1.20.6".to_string()),
        (34, "1.21 – 1.21.1".to_string()),
        (42, "1.21.2 – 1.21.3".to_string()),
        (46, "1.21.4".to_string()),
        (55, "1.21.5".to_string()),
        (63, "1.21.6".to_string()),
        (64, "1.21.7 – 1.21.8".to_string()),
    ]
}

/// 从文件加载版本映射
fn load_version_map_from_file() -> Result<Vec<(u32, String)>, String> {
    // 获取可执行文件目录
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("无法获取执行路径: {}", e))?;
    let exe_dir = exe_path.parent()
        .ok_or("无法获取父目录")?;
    
    // 获取当前工作目录
    let current_dir = std::env::current_dir()
        .map_err(|e| format!("无法获取当前目录: {}", e))?;
    
    // 尝试多个可能的路径
    let possible_paths = vec![
        // 打包后的路径
        exe_dir.join("resources").join("version_map.json"),
        current_dir.join("version_map").join("version_map.json"),
        current_dir.join("..").join("version_map").join("version_map.json"),
        PathBuf::from("version_map/version_map.json"),
        PathBuf::from("../version_map/version_map.json"),
        exe_dir.join("..").join("..").join("version_map").join("version_map.json"),
        exe_dir.join("version_map").join("version_map.json"),
        exe_dir.join("version_map.json"),
        PathBuf::from("version_map.json"),
    ];
    
    for path in &possible_paths {
        let canonical_path = path.canonicalize().ok();
        if path.exists() {
            match load_version_map(path) {
                Ok(versions) => {
                    eprintln!("✓ 成功从 {:?} 加载版本映射", canonical_path.unwrap_or_else(|| path.clone()));
                    return Ok(versions);
                },
                Err(e) => eprintln!("✗ 从 {:?} 加载失败: {}", path, e),
            }
        }
    }
    
    eprintln!("未找到 version_map.json 文件，使用内置版本数据");
    eprintln!("  当前目录: {:?}", current_dir);
    eprintln!("  可执行文件目录: {:?}", exe_dir);
    
    Err("未找到 version_map.json 文件，已使用备用数据".to_string())
}

/// 从指定路径加载版本映射
fn load_version_map(path: &Path) -> Result<Vec<(u32, String)>, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    
    let version_map: VersionMap = serde_json::from_str(&content)
        .map_err(|e| format!("解析JSON失败: {}", e))?;
    
    let mut versions: Vec<(u32, String)> = Vec::new();
    
    for (k, versions_list) in version_map.resource_pack.iter() {
        if let Ok(pack_format) = k.parse::<u32>() {
            if versions_list.is_empty() {
                continue;
            }
            
            // 分离正式版和预览版
            let mut release_versions: Vec<String> = Vec::new();
            let mut preview_versions: Vec<String> = Vec::new();
            
            for version in versions_list.iter() {
                if is_release_version(version) {
                    release_versions.push(version.clone());
                } else {
                    preview_versions.push(version.clone());
                }
            }
            
            // 构建版本范围字符串
            let version_range = if !release_versions.is_empty() {
                let release_range = if release_versions.len() == 1 {
                    release_versions[0].clone()
                } else {
                    let newest = &release_versions[0];
                    let oldest = &release_versions[release_versions.len() - 1];
                    format!("{} – {}", oldest, newest)
                };
                
                if !preview_versions.is_empty() {
                    format!("{} (含 {} 个预览版)", release_range, preview_versions.len())
                } else {
                    release_range
                }
            } else if !preview_versions.is_empty() {
                // 只有预览版
                if preview_versions.len() == 1 {
                    format!("{} (预览版)", preview_versions[0])
                } else {
                    let newest = &preview_versions[0];
                    let oldest = &preview_versions[preview_versions.len() - 1];
                    format!("{} – {} (预览版)", oldest, newest)
                }
            } else {
                continue;
            };
            
            versions.push((pack_format, version_range));
        }
    }
    
    versions.sort_by_key(|(pack_format, _)| *pack_format);
    
    Ok(versions)
}

/// 判断是否为正式版本
fn is_release_version(version: &str) -> bool {
    version.chars().all(|c| c.is_numeric() || c == '.')
        && version.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_numeric()))
}