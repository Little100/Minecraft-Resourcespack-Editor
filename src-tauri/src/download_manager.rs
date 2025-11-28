use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle, Emitter};

/// 下载任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// 下载进度信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub status: DownloadStatus,
    pub current: usize,
    pub total: usize,
    pub current_file: Option<String>,
    pub speed: f64,
    pub eta: Option<u64>,
    pub error: Option<String>,
}

/// 下载任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub name: String,
    pub task_type: String,
    pub status: DownloadStatus,
    pub progress: DownloadProgress,
    pub created_at: u64,
    pub updated_at: u64,
    pub output_dir: PathBuf,
}

/// 下载任务管理器
#[derive(Clone)]
pub struct DownloadManager {
    tasks: Arc<RwLock<HashMap<String, DownloadTask>>>,
    cancel_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    app_handle: AppHandle,
}

impl DownloadManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            cancel_tokens: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
        }
    }

    /// 创建新的下载任务
    pub async fn create_task(
        &self,
        name: String,
        task_type: String,
        output_dir: PathBuf,
    ) -> String {
        let task_id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let task = DownloadTask {
            id: task_id.clone(),
            name,
            task_type,
            status: DownloadStatus::Pending,
            progress: DownloadProgress {
                task_id: task_id.clone(),
                status: DownloadStatus::Pending,
                current: 0,
                total: 0,
                current_file: None,
                speed: 0.0,
                eta: None,
                error: None,
            },
            created_at: now,
            updated_at: now,
            output_dir,
        };

        let mut tasks = self.tasks.write().await;
        tasks.insert(task_id.clone(), task);

        // 发送任务创建事件
        let _ = self.app_handle.emit("download-task-created", &task_id);

        task_id
    }

    /// 更新任务进度
    pub async fn update_progress(&self, task_id: &str, progress: DownloadProgress) {
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.progress = progress.clone();
            task.status = progress.status.clone();
            task.updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();

            // 发送进度更新事件
            let _ = self.app_handle.emit("download-progress", &progress);
        }
    }

    /// 获取任务
    pub async fn get_task(&self, task_id: &str) -> Option<DownloadTask> {
        let tasks = self.tasks.read().await;
        tasks.get(task_id).cloned()
    }

    /// 获取所有任务
    pub async fn get_all_tasks(&self) -> Vec<DownloadTask> {
        let tasks = self.tasks.read().await;
        tasks.values().cloned().collect()
    }

    /// 取消任务
    pub async fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        // 触发取消令牌
        let tokens = self.cancel_tokens.lock().await;
        if let Some(token) = tokens.get(task_id) {
            token.cancel();
        }

        // 更新任务状态
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = DownloadStatus::Cancelled;
            task.progress.status = DownloadStatus::Cancelled;
            task.updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();

            // 发送取消事件
            let _ = self.app_handle.emit("download-cancelled", task_id);
            Ok(())
        } else {
            Err("任务不存在".to_string())
        }
    }

    /// 删除任务
    pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.write().await;
        let mut tokens = self.cancel_tokens.lock().await;

        if let Some(token) = tokens.get(task_id) {
            token.cancel();
        }
        tokens.remove(task_id);

        if tasks.remove(task_id).is_some() {
            let _ = self.app_handle.emit("download-deleted", task_id);
            Ok(())
        } else {
            Err("任务不存在".to_string())
        }
    }

    /// 注册取消令牌
    pub async fn register_cancel_token(&self, task_id: String, token: CancellationToken) {
        let mut tokens = self.cancel_tokens.lock().await;
        tokens.insert(task_id, token);
    }

    /// 移除取消令牌
    pub async fn remove_cancel_token(&self, task_id: &str) {
        let mut tokens = self.cancel_tokens.lock().await;
        tokens.remove(task_id);
    }

    /// 获取取消令牌
    pub async fn get_cancel_token(&self, task_id: &str) -> Option<CancellationToken> {
        let tokens = self.cancel_tokens.lock().await;
        tokens.get(task_id).cloned()
    }

    /// 清理已完成的任务
    pub async fn clear_completed(&self) -> usize {
        let mut tasks = self.tasks.write().await;
        let before_count = tasks.len();
        
        tasks.retain(|_, task| {
            !matches!(
                task.status,
                DownloadStatus::Completed | DownloadStatus::Failed | DownloadStatus::Cancelled
            )
        });

        before_count - tasks.len()
    }
}

/// 获取所有下载任务
#[tauri::command]
pub async fn get_all_download_tasks(
    manager: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<Vec<DownloadTask>, String> {
    Ok(manager.get_all_tasks().await)
}

/// 获取单个下载任务
#[tauri::command]
pub async fn get_download_task(
    task_id: String,
    manager: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<Option<DownloadTask>, String> {
    Ok(manager.get_task(&task_id).await)
}

/// 取消下载任务
#[tauri::command]
pub async fn cancel_download_task(
    task_id: String,
    manager: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    manager.cancel_task(&task_id).await
}

/// 删除下载任务
#[tauri::command]
pub async fn delete_download_task(
    task_id: String,
    manager: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    manager.delete_task(&task_id).await
}

/// 清理已完成的任务
#[tauri::command]
pub async fn clear_completed_tasks(
    manager: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<usize, String> {
    Ok(manager.clear_completed().await)
}