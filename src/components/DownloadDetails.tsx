import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './DownloadDetails.css';

interface DownloadProgress {
  task_id: string;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  current: number;
  total: number;
  current_file: string | null;
  speed: number;
  eta: number | null;
  error: string | null;
}

interface DownloadTask {
  id: string;
  name: string;
  task_type: string;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: DownloadProgress;
  created_at: number;
  updated_at: number;
  output_dir: string;
}

interface DownloadDetailsProps {
  onClose: () => void;
}

export default function DownloadDetails({ onClose }: DownloadDetailsProps) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  const loadTasks = async () => {
    try {
      const allTasks = await invoke<DownloadTask[]>('get_all_download_tasks');
      setTasks(allTasks);
    } catch (error) {
      console.error('加载下载任务失败:', error);
    }
  };

  useEffect(() => {
    loadTasks();

    const unlistenProgress = listen<DownloadProgress>('download-progress', (event) => {
      setTasks(prevTasks => {
        const newTasks = [...prevTasks];
        const taskIndex = newTasks.findIndex(t => t.id === event.payload.task_id);
        
        if (taskIndex >= 0) {
          newTasks[taskIndex].progress = event.payload;
          newTasks[taskIndex].status = event.payload.status;
        }
        
        return newTasks;
      });
    });

    const unlistenCreated = listen<string>('download-task-created', () => {
      loadTasks();
    });

    const unlistenCancelled = listen<string>('download-cancelled', () => {
      loadTasks();
    });

    const unlistenDeleted = listen<string>('download-deleted', () => {
      loadTasks();
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenCreated.then(fn => fn());
      unlistenCancelled.then(fn => fn());
      unlistenDeleted.then(fn => fn());
    };
  }, []);

  const handleCancel = async (taskId: string) => {
    try {
      await invoke('cancel_download_task', { taskId });
    } catch (error) {
      console.error('取消下载失败:', error);
      alert(`取消下载失败: ${error}`);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定要删除此下载任务吗？')) return;
    
    try {
      await invoke('delete_download_task', { taskId });
    } catch (error) {
      console.error('删除任务失败:', error);
      alert(`删除任务失败: ${error}`);
    }
  };

  const handleClearCompleted = async () => {
    try {
      const count = await invoke<number>('clear_completed_tasks');
      if (count > 0) {
        loadTasks();
      }
    } catch (error) {
      console.error('清理任务失败:', error);
    }
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatETA = (seconds: number | null): string => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  };

  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      pending: '等待中',
      downloading: '下载中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string): string => {
    const colorMap: Record<string, string> = {
      pending: '#f59e0b',
      downloading: '#3b82f6',
      paused: '#6b7280',
      completed: '#10b981',
      failed: '#ef4444',
      cancelled: '#6b7280',
    };
    return colorMap[status] || '#6b7280';
  };

  return (
    <>
      <div className="overlay" onClick={onClose}></div>
      <div className="download-details-dialog">
        <div className="dialog-header">
          <h3>下载管理器</h3>
          <div className="header-actions">
            <button
              className="btn-secondary btn-sm"
              onClick={handleClearCompleted}
              title="清理已完成的任务"
            >
              清理已完成
            </button>
            <button className="dialog-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div className="dialog-content">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <p>暂无下载任务</p>
            </div>
          ) : (
            <div className="tasks-list">
              {tasks.map(task => (
                <div key={task.id} className={`task-item ${task.status}`}>
                  <div className="task-header">
                    <div className="task-title">
                      <span className="task-name">{task.name}</span>
                      <span 
                        className="task-status"
                        style={{ color: getStatusColor(task.status) }}
                      >
                        {getStatusText(task.status)}
                      </span>
                    </div>
                    <div className="task-actions">
                      {(task.status === 'downloading' || task.status === 'pending') && (
                        <button
                          className="btn-icon"
                          onClick={() => handleCancel(task.id)}
                          title="取消下载"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      )}
                      {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                        <button
                          className="btn-icon"
                          onClick={() => handleDelete(task.id)}
                          title="删除任务"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {task.progress.current_file && (
                    <div className="task-current-file">
                      <span className="file-label">当前文件:</span>
                      <span className="file-name">{task.progress.current_file}</span>
                    </div>
                  )}

                  <div className="task-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${task.progress.current}%`,
                          backgroundColor: getStatusColor(task.status)
                        }}
                      />
                    </div>
                    <div className="progress-info">
                      <span className="progress-percent">{task.progress.current}%</span>
                      {task.progress.speed > 0 && (
                        <span className="progress-speed">{formatSpeed(task.progress.speed)}</span>
                      )}
                      {task.progress.eta && (
                        <span className="progress-eta">剩余 {formatETA(task.progress.eta)}</span>
                      )}
                    </div>
                  </div>

                  {task.progress.error && (
                    <div className="task-error">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <span>{task.progress.error}</span>
                    </div>
                  )}

                  <div className="task-meta">
                    <span>创建时间: {formatDate(task.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}