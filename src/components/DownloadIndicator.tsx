import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './DownloadIndicator.css';

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

interface DownloadIndicatorProps {
  onShowDetails: () => void;
}

export default function DownloadIndicator({ onShowDetails }: DownloadIndicatorProps) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  // 加载所有任务
  const loadTasks = async () => {
    try {
      const allTasks = await invoke<DownloadTask[]>('get_all_download_tasks');
      setTasks(allTasks);
      setIsVisible(allTasks.length > 0);
    } catch (error) {
      console.error('加载下载任务失败:', error);
    }
  };

  useEffect(() => {
    // 初始加载
    loadTasks();

    // 监听下载进度更新
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

    // 监听任务创建
    const unlistenCreated = listen<string>('download-task-created', () => {
      loadTasks();
    });

    // 监听任务取消
    const unlistenCancelled = listen<string>('download-cancelled', () => {
      loadTasks();
    });

    // 监听任务删除
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

  // 计算活动任务数
  const activeTasks = tasks.filter(t => 
    t.status === 'downloading' || t.status === 'pending'
  );

  const hasActiveTasks = activeTasks.length > 0;
  const activeTask = activeTasks[0];

  // 格式化速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  // 格式化ETA
  const formatETA = (seconds: number | null): string => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isVisible) return null;

  return (
    <div className="download-indicator" onClick={onShowDetails}>
      <div className="indicator-icon">
        {hasActiveTasks ? (
          <>
            <svg className="download-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span className="task-count">{activeTasks.length}</span>
          </>
        ) : (
          <svg className="check-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        )}
      </div>

      {hasActiveTasks && activeTask && (
        <div className="indicator-info">
          <div className="task-name">{activeTask.name}</div>
          <div className="task-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${activeTask.progress.current}%` }}
              />
            </div>
            <div className="progress-stats">
              <span>{activeTask.progress.current}%</span>
              {activeTask.progress.speed > 0 && (
                <>
                  <span className="separator">•</span>
                  <span>{formatSpeed(activeTask.progress.speed)}</span>
                </>
              )}
              {activeTask.progress.eta && (
                <>
                  <span className="separator">•</span>
                  <span>剩余 {formatETA(activeTask.progress.eta)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!hasActiveTasks && tasks.length > 0 && (
        <div className="indicator-info">
          <div className="task-name">所有下载已完成</div>
          <div className="task-stats">{tasks.length} 个任务</div>
        </div>
      )}
    </div>
  );
}