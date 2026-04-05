use serde::{Deserialize, Serialize};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::zip_handler::{create_zip, extract_zip, get_temp_extract_dir};

/// 融合来源类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PackSourceType {
    Zip,
    Folder,
}

impl std::fmt::Display for PackSourceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackSourceType::Zip => write!(f, "zip"),
            PackSourceType::Folder => write!(f, "folder"),
        }
    }
}

/// 一个融合来源包
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeSource {
    pub index: usize,
    pub name: String,
    pub source_path: String,
    pub source_type: PackSourceType,
    pub description: String,
    pub pack_format: i32,
    pub file_count: usize,
}

/// 文件冲突信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileConflict {
    pub path: String,
    pub source_indices: Vec<usize>,
    pub winner_index: usize,
}

/// 冲突摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflictSummary {
    pub conflicts: Vec<FileConflict>,
    pub total_conflicts: usize,
    pub source_stats: HashMap<String, SourceStats>,
}

/// 各来源包的统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceStats {
    pub name: String,
    pub total_files: usize,
    pub conflict_files: usize,
    pub unique_files: usize,
}

/// 融合预览结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePreview {
    pub sources: Vec<MergeSource>,
    pub conflicts: MergeConflictSummary,
    pub total_merged_files: usize,
    pub priority_order: Vec<String>,
}

/// 融合进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeProgress {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub current_file: Option<String>,
}

/// 融合结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub output_path: String,
    pub total_files: usize,
    pub conflicts_resolved: usize,
    pub output_description: String,
    pub output_pack_format: i32,
}

/// 融合来源定义
#[derive(Debug, Clone, Deserialize)]
pub struct MergeSourceInput {
    pub path: String,
    pub source_type: PackSourceType,
}

/// 冲突解决定义
#[derive(Debug, Clone, Deserialize)]
pub struct ConflictResolution {
    pub path: String,
    pub chosen_source: String,
    #[serde(default)]
    pub winner_index: Option<usize>,
    #[serde(default)]
    pub exclude: bool,
}

/// 融合最终配置
#[derive(Debug, Clone, Deserialize)]
pub struct MergeConfig {
    pub output_dir: String,
    pub output_file_name: String,
    pub final_description: String,
    pub final_pack_format: i32,
    pub conflict_resolutions: Vec<ConflictResolution>,
    #[serde(default)]
    pub blacklist_patterns: Vec<String>,
    #[serde(default)]
    pub whitelist_patterns: Vec<String>,
}

fn matches_path_rule(path: &str, pattern: &str) -> bool {
    let path_norm = path.replace('\\', "/");
    let pat = pattern.trim();
    if pat.is_empty() {
        return false;
    }
    let pat_norm = pat.replace('\\', "/");
    if !pat_norm.contains('*') {
        return path_norm.contains(pat_norm.as_str());
    }
    let parts: Vec<&str> = pat_norm.split('*').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return true;
    }
    let mut idx = 0usize;
    for part in parts {
        let rest = &path_norm[idx..];
        if let Some(pos) = rest.find(part) {
            idx += pos + part.len();
        } else {
            return false;
        }
    }
    true
}

fn path_passes_filter_lists(
    path: &str,
    blacklist: &[String],
    whitelist: &[String],
) -> bool {
    if whitelist.iter().any(|p| matches_path_rule(path, p)) {
        return true;
    }
    !blacklist.iter().any(|p| matches_path_rule(path, p))
}

/// 预览融合，分析冲突
pub fn preview_merge(sources: Vec<MergeSourceInput>) -> Result<MergePreview, String> {
    let mut merge_sources: Vec<MergeSource> = Vec::new();
    let mut priority_order: Vec<String> = Vec::new();
    let mut file_sources: HashMap<String, Vec<usize>> = HashMap::new();

    for (source_index, input) in sources.iter().enumerate() {
        let (name, description, pack_format, file_count, extracted_path) =
            prepare_source(&input.path, &input.source_type)?;

        let source_name = name.clone();
        priority_order.push(source_name.clone());

        merge_sources.push(MergeSource {
            index: source_index,
            name,
            source_path: input.path.clone(),
            source_type: input.source_type.clone(),
            description,
            pack_format,
            file_count,
        });

        let files = scan_all_files(&extracted_path)?;
        for file_path in files {
            let relative = file_path
                .strip_prefix(&extracted_path)
                .unwrap_or(&file_path)
                .to_string_lossy()
                .replace('\\', "/");

            file_sources
                .entry(relative.clone())
                .or_insert_with(Vec::new);
            let src_list = file_sources.get_mut(&relative).unwrap();
            if !src_list.contains(&source_index) {
                src_list.push(source_index);
            }
        }
    }

    let mut conflicts: Vec<FileConflict> = Vec::new();
    let mut source_conflict_count: HashMap<usize, usize> = HashMap::new();

    for (path, src_indices) in &file_sources {
        if src_indices.len() > 1 {
            let winner_index = *src_indices.first().unwrap();

            conflicts.push(FileConflict {
                path: path.clone(),
                source_indices: src_indices.clone(),
                winner_index,
            });
            *source_conflict_count.entry(winner_index).or_insert(0) += 1;
        }
    }

    let total_conflicts = conflicts.len();

    let mut source_stats: HashMap<String, SourceStats> = HashMap::new();
    for (source_index, source) in merge_sources.iter().enumerate() {
        let total = source.file_count;
        let conflicts_count = *source_conflict_count.get(&source_index).unwrap_or(&0);
        source_stats.insert(
            source.name.clone(),
            SourceStats {
                name: source.name.clone(),
                total_files: total,
                conflict_files: conflicts_count,
                unique_files: total.saturating_sub(conflicts_count),
            },
        );
    }

    Ok(MergePreview {
        sources: merge_sources,
        conflicts: MergeConflictSummary {
            conflicts,
            total_conflicts,
            source_stats,
        },
        total_merged_files: file_sources.len(),
        priority_order,
    })
}

pub async fn execute_merge_async(
    app_handle: tauri::AppHandle,
    sources: Vec<MergeSourceInput>,
    config: MergeConfig,
) -> Result<MergeResult, String> {
    emit_progress(&app_handle, "准备中", 0, sources.len(), None).await;

    let mut extracted_dirs: Vec<(usize, String, PathBuf)> = Vec::new();

    for (i, input) in sources.iter().enumerate() {
        emit_progress(&app_handle, "解压中", i, sources.len(), Some(&input.path)).await;
        let (name, _, _, _, extracted) = prepare_source(&input.path, &input.source_type)?;
        extracted_dirs.push((i, name, extracted));
    }

    let total_sources = extracted_dirs.len();
    emit_progress(&app_handle, "扫描文件中", 0, total_sources, None).await;

    let mut resolved_files: HashMap<String, (usize, PathBuf)> = HashMap::new();

    for (_i, (source_idx, source_name, extracted_path)) in extracted_dirs.iter().enumerate() {
        emit_progress(&app_handle, "扫描文件中", _i, total_sources, Some(source_name)).await;
        let files = scan_all_files(extracted_path)?;
        for file_path in files {
            let relative = file_path
                .strip_prefix(extracted_path)
                .unwrap_or(&file_path)
                .to_string_lossy()
                .replace('\\', "/");
            match resolved_files.entry(relative) {
                Entry::Vacant(e) => {
                    e.insert((*source_idx, file_path));
                }
                Entry::Occupied(_) => {}
            }
        }
    }

    for cr in &config.conflict_resolutions {
        if cr.exclude {
            resolved_files.remove(&cr.path);
            continue;
        }
        let chosen_source_idx = if let Some(idx) = cr.winner_index {
            idx
        } else {
            match extracted_dirs.iter().find(|(_, name, _)| name == &cr.chosen_source) {
                Some((idx, _, _)) => *idx,
                None => continue,
            }
        };

        for (_source_idx, _source_name, extracted_path) in &extracted_dirs {
            if *_source_idx == chosen_source_idx {
                let full_path = extracted_path.join(cr.path.replace('/', &std::path::MAIN_SEPARATOR.to_string()));
                if full_path.exists() {
                    resolved_files.insert(cr.path.clone(), (*_source_idx, full_path));
                    break;
                }
            }
        }
    }

    let to_drop: Vec<String> = resolved_files
        .keys()
        .filter(|p| !path_passes_filter_lists(p, &config.blacklist_patterns, &config.whitelist_patterns))
        .cloned()
        .collect();
    for p in to_drop {
        resolved_files.remove(&p);
    }

    let output_base = PathBuf::from(&config.output_dir);
    fs::create_dir_all(&output_base)
        .map_err(|e| format!("无法创建输出目录: {}", e))?;

    let total_files = resolved_files.len();
    emit_progress(&app_handle, "写入文件中", 0, total_files, None).await;

    for (i, (relative, (_source, full_path))) in resolved_files.iter().enumerate() {
        if i % 50 == 0 {
            emit_progress(&app_handle, "写入文件中", i, total_files, Some(relative)).await;
        }

        let out_file = output_base.join(relative.replace('/', &std::path::MAIN_SEPARATOR.to_string()));
        if let Some(parent) = out_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("无法创建目录: {}", e))?;
        }
        fs::copy(full_path, &out_file)
            .map_err(|e| format!("无法复制文件: {}", e))?;
    }

    let pack_mcmeta = format!(
        r#"{{
  "pack": {{
    "pack_format": {},
    "description": "{}"
  }}
}}"#,
        config.final_pack_format,
        config.final_description
    );
    let mcmeta_path = output_base.join("pack.mcmeta");
    fs::write(&mcmeta_path, &pack_mcmeta)
        .map_err(|e| format!("无法写入 pack.mcmeta: {}", e))?;

    let zip_file_name = if config.output_file_name.to_lowercase().ends_with(".zip") {
        config.output_file_name.clone()
    } else {
        format!("{}.zip", config.output_file_name)
    };
    let zip_path = output_base.join(&zip_file_name);

    let temp_dir = get_temp_extract_dir()
        .join("merge_temp")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("无法创建临时目录: {}", e))?;

    let zip_temp_path = temp_dir.join("result.zip");
    create_zip(&output_base, &zip_temp_path)
        .map_err(|e| format!("无法创建 ZIP: {}", e))?;
    fs::copy(&zip_temp_path, &zip_path)
        .map_err(|e| format!("无法保存 ZIP: {}", e))?;

    let _ = fs::remove_dir_all(&temp_dir);

    emit_progress(&app_handle, "完成", total_files, total_files, None).await;

    Ok(MergeResult {
        output_path: zip_path.to_string_lossy().to_string(),
        total_files,
        conflicts_resolved: config.conflict_resolutions.len(),
        output_description: config.final_description,
        output_pack_format: config.final_pack_format,
    })
}

fn find_pack_mcmeta_dir(dir: &Path) -> Option<PathBuf> {
    for entry in WalkDir::new(dir)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy();
            if name.eq_ignore_ascii_case("pack.mcmeta") {
                return entry.path().parent().map(|p| p.to_path_buf());
            }
        }
    }
    None
}

fn prepare_source(
    path: &str,
    source_type: &PackSourceType,
) -> Result<(String, String, i32, usize, PathBuf), String> {
    let path = Path::new(path);
    let temp_dir = get_temp_extract_dir()
        .join("merge_temp")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("无法创建临时目录: {}", e))?;

    match source_type {
        PackSourceType::Zip => {
            extract_zip(path, &temp_dir)
                .map_err(|e| format!("无法解压 ZIP: {}", e))?;
        }
        PackSourceType::Folder => {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let dest = temp_dir.join(&name);
            copy_dir_recursive(path, &dest)?;
        }
    }

    let pack_name = match source_type {
        PackSourceType::Zip => path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
        PackSourceType::Folder => path.file_name().unwrap_or_default().to_string_lossy().to_string(),
    };

    let extracted = find_pack_mcmeta_dir(&temp_dir).unwrap_or_else(|| temp_dir.clone());

    let mcmeta_path = extracted.join("pack.mcmeta");
    let (description, pack_format) = if mcmeta_path.exists() {
        let content = fs::read_to_string(&mcmeta_path).unwrap_or_default();
        let json: serde_json::Value = serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({"pack": {"pack_format": 0, "description": ""}}));
        (
            json["pack"]["description"].as_str().unwrap_or("").to_string(),
            json["pack"]["pack_format"].as_i64().unwrap_or(0) as i32,
        )
    } else {
        ("(无 pack.mcmeta)".to_string(), 0)
    };

    let file_count = scan_all_files(&extracted)?.len();
    Ok((pack_name, description, pack_format, file_count, extracted))
}

fn scan_all_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

const MERGE_PREVIEW_MAX_BYTES: usize = 12 * 1024 * 1024;

pub fn read_merge_source_file_bytes(
    source_path: &str,
    source_type: &PackSourceType,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let rel = relative_path.replace('\\', "/");
    if rel.contains("..") {
        return Err("非法路径".to_string());
    }
    let bytes = match source_type {
        PackSourceType::Folder => read_merge_from_folder(source_path, &rel)?,
        PackSourceType::Zip => read_merge_from_zip(source_path, &rel)?,
    };
    if bytes.len() > MERGE_PREVIEW_MAX_BYTES {
        return Err("文件过大，无法预览".to_string());
    }
    Ok(bytes)
}

fn read_merge_from_folder(folder_path: &str, rel: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err("来源不是有效文件夹".to_string());
    }
    let root = find_pack_mcmeta_dir(path).unwrap_or_else(|| path.to_path_buf());
    let full = root.join(rel);
    let root_canon = fs::canonicalize(&root).map_err(|_| "无法解析包根路径".to_string())?;
    let full_canon = fs::canonicalize(&full).map_err(|_| "文件不存在或无法访问".to_string())?;
    if !full_canon.starts_with(&root_canon) {
        return Err("路径越界".to_string());
    }
    fs::read(&full_canon).map_err(|e| format!("读取失败: {}", e))
}

fn infer_zip_pack_root(entries: &[(usize, String)]) -> String {
    let mut best: Option<(usize, String)> = None;
    for (_, norm) in entries {
        let lower = norm.to_ascii_lowercase();
        if lower.ends_with("/pack.mcmeta") || lower == "pack.mcmeta" {
            let prefix = if lower == "pack.mcmeta" {
                String::new()
            } else {
                norm[..norm.len() - "/pack.mcmeta".len()]
                    .trim_end_matches('/')
                    .to_string()
            };
            let depth = prefix.matches('/').count();
            if best.as_ref().map_or(true, |(d, _)| depth < *d) {
                best = Some((depth, prefix));
            }
        }
    }
    best.map(|(_, p)| p).unwrap_or_default()
}

fn resolve_zip_entry_index(
    entries: &[(usize, String)],
    root: &str,
    rel_norm: &str,
) -> Result<usize, String> {
    let r = root.trim_end_matches('/');
    let primary = if r.is_empty() {
        rel_norm.to_string()
    } else {
        format!("{}/{}", r, rel_norm)
    };

    for (idx, name) in entries {
        if name == &primary {
            return Ok(*idx);
        }
    }
    let wl = primary.to_ascii_lowercase();
    for (idx, name) in entries {
        if name.to_ascii_lowercase() == wl {
            return Ok(*idx);
        }
    }

    let rl = rel_norm.to_ascii_lowercase();
    let slash_rel = format!("/{}", rl);
    let mut matches: Vec<usize> = entries
        .iter()
        .filter(|(_, n)| {
            let nl = n.to_ascii_lowercase();
            nl == rl || nl.ends_with(&slash_rel)
        })
        .map(|(i, _)| *i)
        .collect();

    matches.sort_unstable();
    matches.dedup();
    match matches.len() {
        0 => Err(format!("在 ZIP 中找不到: {}", rel_norm)),
        1 => Ok(matches[0]),
        _ => Err(format!("ZIP 内存在多处匹配: {}", rel_norm)),
    }
}

fn read_merge_from_zip(zip_path: &str, rel: &str) -> Result<Vec<u8>, String> {
    let file = File::open(Path::new(zip_path)).map_err(|e| format!("无法打开 ZIP: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("ZIP 无效: {}", e))?;

    let n = archive.len();
    let mut entries: Vec<(usize, String)> = Vec::new();
    for i in 0..n {
        let name = {
            let zf = archive.by_index(i).map_err(|e| format!("读取 ZIP 目录失败: {}", e))?;
            zf.name().to_string().replace('\\', "/")
        };
        if name.ends_with('/') {
            continue;
        }
        entries.push((i, name));
    }

    let root = infer_zip_pack_root(&entries);
    let rel_norm = rel.trim_start_matches('/').to_string();
    let idx = resolve_zip_entry_index(&entries, &root, &rel_norm)?;

    let mut zf = archive
        .by_index(idx)
        .map_err(|e| format!("无法打开 ZIP 内文件: {}", e))?;
    let mut buf = Vec::new();
    zf.read_to_end(&mut buf)
        .map_err(|e| format!("读取 ZIP 条目失败: {}", e))?;
    Ok(buf)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("无法创建目录 {:?}: {}", dst, e))?;

    for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let rel = entry.path().strip_prefix(src)
            .map_err(|e| format!("无法计算相对路径: {}", e))?;
        let dst_path = dst.join(rel);

        if entry.file_type().is_dir() {
            fs::create_dir_all(&dst_path)
                .map_err(|e| format!("无法创建目录: {}", e))?;
        } else {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("无法创建父目录: {}", e))?;
            }
            fs::copy(entry.path(), &dst_path)
                .map_err(|e| format!("无法复制文件: {}", e))?;
        }
    }
    Ok(())
}

async fn emit_progress(
    app_handle: &tauri::AppHandle,
    phase: &str,
    current: usize,
    total: usize,
    current_file: Option<&str>,
) {
    let _ = app_handle.emit(
        "merge-progress",
        MergeProgress {
            phase: phase.to_string(),
            current,
            total,
            current_file: current_file.map(|s| s.to_string()),
        },
    );
}
