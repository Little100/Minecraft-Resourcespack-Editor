import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Icon, useToast, ConfirmDialog } from '@mpe/ui';
import { logger } from '../utils/logger';
import { formatSpeed, formatETA } from '../utils/shared';
import type { DownloadProgress, DownloadTask } from '../types/download';
import './DownloadDetails.css';

interface DownloadDetailsProps {
  onClose: () => void;
}

export default function DownloadDetails({ onClose }: DownloadDetailsProps) {
  const toast = useToast();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [confirmDialogState, setConfirmDialogState] = useState<{
    open: boolean;
    onConfirm: () => void;
  }>({ open: false, onConfirm: () => {} });

  const loadTasks = async () => {
    try {
      const allTasks = await invoke<DownloadTask[]>('get_all_download_tasks');
      setTasks(allTasks);
    } catch (error) {
      logger.error('加载下载任务失败:', error);
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
      logger.error('取消下载失败:', error);
      toast({ message: `取消下载失败: ${error}`, type: 'error' });
    }
  };

  const handleDelete = (taskId: string) => {
    setConfirmDialogState({
      open: true,
      onConfirm: async () => {
        setConfirmDialogState(prev => ({ ...prev, open: false }));
        try {
          await invoke('delete_download_task', { taskId });
        } catch (error) {
          logger.error('删除任务失败:', error);
          toast({ message: `删除任务失败: ${error}`, type: 'error' });
        }
      },
    });
  };

  const handleClearCompleted = async () => {
    try {
      const count = await invoke<number>('clear_completed_tasks');
      if (count > 0) {
        loadTasks();
      }
    } catch (error) {
      logger.error('清理任务失败:', error);
    }
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
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        <div className="dialog-content">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <Icon name="download" size={32} />
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
                          <Icon name="close" size={16} />
                        </button>
                      )}
                      {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                        <button
                          className="btn-icon"
                          onClick={() => handleDelete(task.id)}
                          title="删除任务"
                        >
                          <Icon name="delete" size={16} />
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
                      <Icon name="report-issue" size={16} />
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

      <ConfirmDialog
        open={confirmDialogState.open}
        title="确认删除"
        message="确定要删除此下载任务吗？"
        variant="warning"
        confirmText="确定"
        cancelText="取消"
        onConfirm={confirmDialogState.onConfirm}
        onCancel={() => setConfirmDialogState(prev => ({ ...prev, open: false }))}
      />
    </>
  );
}