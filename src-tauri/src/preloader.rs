use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use dashmap::DashMap;
use parking_lot::RwLock;
use rayon::prelude::*;

pub struct ImagePreloader {
    cache: Arc<DashMap<String, Vec<u8>>>,
    loading: Arc<RwLock<HashSet<String>>>,
    #[allow(dead_code)]
    max_cache_size: usize,
    current_folder: Arc<RwLock<Option<PathBuf>>>,
}

impl ImagePreloader {
    pub fn new(max_cache_size: usize) -> Self {
        let cache = DashMap::with_capacity(max_cache_size);
        
        Self {
            cache: Arc::new(cache),
            loading: Arc::new(RwLock::new(HashSet::new())),
            max_cache_size,
            current_folder: Arc::new(RwLock::new(None)),
        }
    }
    
    /// 清理所有缓存
    pub async fn clear_cache(&self) {
        let cache_size = self.cache.len();
        self.cache.clear();
        self.loading.write().clear();
        *self.current_folder.write() = None;
        println!("[预加载] 缓存已清理，释放了 {} 个文件", cache_size);
    }

    pub async fn preload_folder_aggressive(&self, folder_path: &Path, base_path: &Path) -> Result<usize, String> {
        // 更新当前文件夹
        *self.current_folder.write() = Some(folder_path.to_path_buf());
        
        println!("[预加载-多核心]  开始积极预加载: {:?}", folder_path);
        let start_time = std::time::Instant::now();
        
        // 递归收集所有图片文件
        let image_files = Self::collect_images_recursive(folder_path)?;
        let total_count = image_files.len();
        
        println!("[预加载-多核心]  发现 {} 个图片文件", total_count);
        
        // 获取CPU核心数并设置线程池
        let num_cpus = num_cpus::get();
        println!("[预加载-多核心] 使用 {} 个CPU核心", num_cpus);
        
        let cache = Arc::clone(&self.cache);
        let base_path = base_path.to_path_buf();
        
        let loaded_count = image_files
            .par_iter()
            .filter_map(|path| {
                let relative_path = path.strip_prefix(&base_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                
                // 直接读取数据
                match std::fs::read(path) {
                    Ok(data) => {
                        cache.insert(relative_path.clone(), data);
                        Some(())
                    }
                    Err(e) => {
                        eprintln!("[预加载]  读取失败 {}: {}", relative_path, e);
                        None
                    }
                }
            })
            .count();
        
        let duration = start_time.elapsed();
        let throughput = if duration.as_secs_f64() > 0.0 {
            loaded_count as f64 / duration.as_secs_f64()
        } else {
            0.0
        };
        
        println!("[预加载-多核心]  完成! 缓存了 {}/{} 个文件", loaded_count, total_count);
        println!("[预加载-多核心]  耗时: {:?}, 吞吐量: {:.0} 文件/秒", duration, throughput);
        
        Ok(loaded_count)
    }
    
    /// 递归收集所有图片文件
    fn collect_images_recursive(dir: &Path) -> Result<Vec<PathBuf>, String> {
        let mut images = Vec::new();
        
        let entries = std::fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory: {}", e))?;
        
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            
            // 忽略 .history 文件夹
            if path.is_dir() {
                if let Some(name) = path.file_name() {
                    if name == ".history" {
                        continue;
                    }
                }
                // 递归处理子目录
                if let Ok(mut sub_images) = Self::collect_images_recursive(&path) {
                    images.append(&mut sub_images);
                }
            } else if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext = ext.to_string_lossy().to_lowercase();
                    if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
                        images.push(path);
                    }
                }
            }
        }
        
        Ok(images)
    }
    
    #[allow(dead_code)]
    pub async fn get_cached(&self, relative_path: &str) -> Option<Vec<u8>> {
        self.cache.get(relative_path).map(|entry| entry.value().clone())
    }
    
    /// 预加载文件夹
    pub async fn preload_folder(&self, folder_path: &Path, base_path: &Path, _max_size: u32) -> Result<usize, String> {
        self.preload_folder_aggressive(folder_path, base_path).await
    }

    /// 获取缓存统计
    pub async fn get_stats(&self) -> (usize, usize) {
        let cache_size = self.cache.len();
        let loading_size = self.loading.read().len();
        (cache_size, loading_size)
    }
}

mod num_cpus {
    pub fn get() -> usize {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    }
}