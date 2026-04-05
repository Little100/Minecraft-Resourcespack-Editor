import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@mpe/ui';
import { logger } from '../utils/logger';
import { formatSpeed, formatETA } from '../utils/shared';
import type { DownloadProgress, DownloadTask } from '../types/download';
import './DownloadIndicator.css';

interface DownloadIndicatorProps {
  onShowDetails: () => void;
}

export default function DownloadIndicator({ onShowDetails }: DownloadIndicatorProps) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isSlideOut, setIsSlideOut] = useState(false);

  // 加载所有任务
  const loadTasks = async () => {
    try {
      const allTasks = await invoke<DownloadTask[]>('get_all_download_tasks');
      setTasks(allTasks);
      setIsVisible(allTasks.length > 0);
    } catch (error) {
      logger.error('加载下载任务失败:', error);
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
      // 重置滑出状态
      setIsSlideOut(false);
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

  // 检测所有任务完成,3秒后滑出
  useEffect(() => {
    if (tasks.length > 0 && !hasActiveTasks && !isSlideOut) {
      // 所有任务都已完成,3秒后滑出
      const timer = setTimeout(() => {
        setIsSlideOut(true);
        setTimeout(() => {
          setIsVisible(false);
        }, 500);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [tasks, hasActiveTasks, isSlideOut]);



  if (!isVisible) return null;

  return (
    <div
      className={`download-indicator ${isSlideOut ? 'slide-out' : ''}`}
      onClick={onShowDetails}
    >
      <div className="indicator-icon">
        {hasActiveTasks ? (
          <>
            <Icon name="download" size={20} />
            <span className="task-count">{activeTasks.length}</span>
          </>
        ) : (
          <Icon name="check" size={20} />
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