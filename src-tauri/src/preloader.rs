use dashmap::DashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use parking_lot::RwLock;
use lru::LruCache;
use std::num::NonZeroUsize;

pub struct ImagePreloader {
    lru_cache: Arc<RwLock<LruCache<String, String>>>,
    loading: Arc<DashMap<String, ()>>,
    max_cache_size: usize,
    semaphore: Arc<Semaphore>,
}

impl ImagePreloader {
    pub fn new(max_cache_size: usize) -> Self {
        let cpu_count = num_cpus::get();
        let concurrent_limit = (cpu_count * 2).max(4);
        
        Self {
            lru_cache: Arc::new(RwLock::new(
                LruCache::new(NonZeroUsize::new(max_cache_size).unwrap())
            )),
            loading: Arc::new(DashMap::new()),
            max_cache_size,
            semaphore: Arc::new(Semaphore::new(concurrent_limit)),
        }
    }

    #[allow(dead_code)]
    pub fn get(&self, path: &str) -> Option<String> {
        let mut lru = self.lru_cache.write();
        if let Some(data) = lru.get(path) {
            return Some(data.clone());
        }
        
        None
    }

    /// 预加载单个图片
    async fn preload_image(&self, path: PathBuf, base_path: &Path, max_size: u32) -> Result<(), String> {
        let relative_path = path
            .strip_prefix(base_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        // 检查是否缓存
        if self.lru_cache.read().peek(&relative_path).is_some() {
            return Ok(());
        }

        // 检查是否正在加载
        if self.loading.contains_key(&relative_path) {
            return Ok(());
        }

        // 标记为正在加载
        self.loading.insert(relative_path.clone(), ());

        let _permit = self.semaphore.acquire().await
            .map_err(|e| format!("Semaphore error: {}", e))?;

        let path_clone = path.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        
        rayon::spawn(move || {
            let result = crate::image_handler::create_thumbnail(&path_clone, max_size);
            let _ = tx.send(result);
        });

        match rx.await {
            Ok(Ok(data)) => {
                let mut lru = self.lru_cache.write();
                lru.put(relative_path.clone(), data);
            }
            Ok(Err(e)) => {
                eprintln!("Failed to load image {}: {}", relative_path, e);
            }
            Err(e) => {
                eprintln!("Channel error for {}: {}", relative_path, e);
            }
        }

        self.loading.remove(&relative_path);

        Ok(())
    }

    pub async fn preload_folder(
        &self,
        folder_path: &Path,
        base_path: &Path,
        max_size: u32,
    ) -> Result<usize, String> {
        use walkdir::WalkDir;

        // 收集所有图片文件
        let image_files: Vec<PathBuf> = WalkDir::new(folder_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                if let Some(ext) = e.path().extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    matches!(ext_str.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
                } else {
                    false
                }
            })
            .map(|e| e.path().to_path_buf())
            .collect();

        let count = image_files.len();

        let tasks: Vec<_> = image_files
            .into_iter()
            .map(|path| {
                let self_clone = self.clone();
                let base_path = base_path.to_path_buf();
                tokio::spawn(async move {
                    self_clone.preload_image(path, &base_path, max_size).await
                })
            })
            .collect();

        for task in tasks {
            let _ = task.await;
        }

        Ok(count)
    }

    pub async fn preload_folder_aggressive(
        &self,
        folder_path: &Path,
        base_path: &Path,
    ) -> Result<usize, String> {
        use walkdir::WalkDir;
        use rayon::prelude::*;

        let image_files: Vec<PathBuf> = WalkDir::new(folder_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                if let Some(ext) = e.path().extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    matches!(ext_str.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
                } else {
                    false
                }
            })
            .map(|e| e.path().to_path_buf())
            .collect();

        let count = image_files.len();
        
        let results: Vec<_> = image_files
            .par_iter()
            .map(|path| {
                let relative_path = path
                    .strip_prefix(base_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();

                if self.lru_cache.read().peek(&relative_path).is_some() {
                    return Ok(());
                }

                match crate::image_handler::create_thumbnail(path, 512) {
                    Ok(data) => {
                        let mut lru = self.lru_cache.write();
                        lru.put(relative_path, data);
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            })
            .collect();

        let success_count = results.iter().filter(|r| r.is_ok()).count();
        
        println!("[预加载] 完成 {}/{} 个文件", success_count, count);

        Ok(success_count)
    }

    /// 获取缓存统计
    pub async fn get_stats(&self) -> (usize, usize) {
        (self.lru_cache.read().len(), self.loading.len())
    }

    /// 清空缓存
    pub async fn clear_cache(&self) {
        self.lru_cache.write().clear();
        self.loading.clear();
    }
}

impl Clone for ImagePreloader {
    fn clone(&self) -> Self {
        Self {
            lru_cache: Arc::clone(&self.lru_cache),
            loading: Arc::clone(&self.loading),
            max_cache_size: self.max_cache_size,
            semaphore: Arc::clone(&self.semaphore),
        }
    }
}

mod num_cpus {
    pub fn get() -> usize {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    }
}