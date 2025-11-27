use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 版本枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MinecraftVersion {
    Legacy,      // 1.13之前
    Flattening,  // 1.13-1.19.3
    Components,  // 1.19.4-1.20.4
    NewModel,    // 1.20.5-1.21.3
    ItemsFolder, // 1.21.4+
}

/// pack.mcmeta结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackMeta {
    pub pack: PackMetaInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackMetaInfo {
    pub pack_format: i32,
    pub description: String,
}

/// 资源类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ResourceType {
    Texture,
    Model,
    ItemModel,
    BlockState,
    Sound,
    Language,
    Font,
    Shader,
    Other,
}

/// 资源文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub resource_type: ResourceType,
    pub namespace: String,
    pub name: String,
    pub size: u64,
}

/// 材质包信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackInfo {
    pub name: String,
    pub version: MinecraftVersion,
    pub pack_format: i32,
    pub description: String,
    pub resources: HashMap<ResourceType, Vec<ResourceFile>>,
    pub namespaces: Vec<String>,
}

impl MinecraftVersion {
    /// 根据pack_format判断版本
    pub fn from_pack_format(format: i32) -> Self {
        match format {
            1..=4 => MinecraftVersion::Legacy,
            5..=12 => MinecraftVersion::Flattening,
            13..=15 => MinecraftVersion::Components,
            16..=34 => MinecraftVersion::NewModel,
            35.. => MinecraftVersion::ItemsFolder,
            _ => MinecraftVersion::Legacy,
        }
    }

    /// 获取版本描述
    pub fn description(&self) -> &str {
        match self {
            MinecraftVersion::Legacy => "1.6-1.12 (Legacy)",
            MinecraftVersion::Flattening => "1.13-1.19.3 (Flattening)",
            MinecraftVersion::Components => "1.19.4-1.20.4 (Components)",
            MinecraftVersion::NewModel => "1.20.5-1.21.3 (New Components)",
            MinecraftVersion::ItemsFolder => "1.21.4+ (Items Folder)",
        }
    }

    /// 是否使用items文件夹
    pub fn uses_items_folder(&self) -> bool {
        matches!(self, MinecraftVersion::ItemsFolder)
    }

    /// 是否使用组件系统
    pub fn uses_components(&self) -> bool {
        matches!(
            self,
            MinecraftVersion::Components | MinecraftVersion::NewModel | MinecraftVersion::ItemsFolder
        )
    }
}

/// 解析资源类型
pub fn parse_resource_type(path: &Path, version: &MinecraftVersion) -> ResourceType {
    let path_str = path.to_string_lossy().to_lowercase();
    
    // 1.21.4+版本的items文件夹
    if version.uses_items_folder() && path_str.contains("/items/") {
        return ResourceType::ItemModel;
    }
    
    if path_str.contains("/textures/") {
        ResourceType::Texture
    } else if path_str.contains("/models/") {
        ResourceType::Model
    } else if path_str.contains("/blockstates/") {
        ResourceType::BlockState
    } else if path_str.contains("/sounds/") {
        ResourceType::Sound
    } else if path_str.contains("/lang/") {
        ResourceType::Language
    } else if path_str.contains("/font/") {
        ResourceType::Font
    } else if path_str.contains("/shaders/") {
        ResourceType::Shader
    } else {
        ResourceType::Other
    }
}

/// 从路径提取命名空间
pub fn extract_namespace(path: &Path) -> Option<String> {
    let path_str = path.to_string_lossy();
    
    // 查找assets/后的第一个目录
    if let Some(assets_pos) = path_str.find("assets/") {
        let after_assets = &path_str[assets_pos + 7..];
        if let Some(slash_pos) = after_assets.find('/') {
            return Some(after_assets[..slash_pos].to_string());
        }
    }
    
    None
}

/// 扫描材质包目录
pub fn scan_pack_directory(root_path: &Path) -> Result<PackInfo, String> {
    // 读取pack.mcmeta
    let mcmeta_path = root_path.join("pack.mcmeta");
    let pack_meta = if mcmeta_path.exists() {
        let content = std::fs::read_to_string(&mcmeta_path)
            .map_err(|e| format!("Failed to read pack.mcmeta: {}", e))?;
        
        // 尝试解析pack.mcmeta,如果失败则使用默认值
        match serde_json::from_str::<PackMeta>(&content) {
            Ok(meta) => meta,
            Err(e) => {
                eprintln!("Warning: Failed to parse pack.mcmeta: {}. Using default values.", e);
                // 使用默认值,允许用户在编辑器中修复
                PackMeta {
                    pack: PackMetaInfo {
                        pack_format: 34, // 默认使用最新格式
                        description: format!("️pack.mcmeta格式错误: {}", e),
                    }
                }
            }
        }
    } else {
        eprintln!("Warning: pack.mcmeta not found. Using default values.");
        // 如果文件不存在,也使用默认值
        PackMeta {
            pack: PackMetaInfo {
                pack_format: 34,
                description: "️ pack.mcmeta文件不存在".to_string(),
            }
        }
    };

    let version = MinecraftVersion::from_pack_format(pack_meta.pack.pack_format);
    let mut resources: HashMap<ResourceType, Vec<ResourceFile>> = HashMap::new();
    let mut namespaces = Vec::new();

    // 扫描assets目录
    let assets_path = root_path.join("assets");
    if assets_path.exists() {
        for entry in WalkDir::new(&assets_path)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            
            // 只处理文件
            if !path.is_file() {
                continue;
            }

            // 提取命名空间
            if let Some(namespace) = extract_namespace(path) {
                if !namespaces.contains(&namespace) {
                    namespaces.push(namespace.clone());
                }

                // 解析资源类型
                let resource_type = parse_resource_type(path, &version);
                
                // 获取相对路径
                let relative_path = path
                    .strip_prefix(root_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();

                // 获取文件名
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                // 获取文件大小
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

                let resource = ResourceFile {
                    path: path.to_path_buf(),
                    relative_path,
                    resource_type: resource_type.clone(),
                    namespace,
                    name,
                    size,
                };

                resources
                    .entry(resource_type)
                    .or_insert_with(Vec::new)
                    .push(resource);
            }
        }
    }

    Ok(PackInfo {
        name: root_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        version,
        pack_format: pack_meta.pack.pack_format,
        description: pack_meta.pack.description,
        resources,
        namespaces,
    })
}