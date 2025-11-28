import { useState } from 'react';
import './DownloadSettingsDialog.css';

interface DownloadSettingsDialogProps {
  onConfirm: (threads: number) => void;
  onCancel: () => void;
}

export default function DownloadSettingsDialog({ onConfirm, onCancel }: DownloadSettingsDialogProps) {
  const [threads, setThreads] = useState(() => {
    const saved = localStorage.getItem('downloadThreads');
    return saved ? parseInt(saved) : 32;
  });
  const [showWarning, setShowWarning] = useState(threads > 64);

  const handleThreadsChange = (value: number) => {
    const clamped = Math.max(1, Math.min(256, value));
    setThreads(clamped);
    setShowWarning(clamped > 64);
  };

  const handleConfirm = () => {
    localStorage.setItem('downloadThreads', threads.toString());
    onConfirm(threads);
  };

  return (
    <>
      <div className="modal-overlay" onClick={onCancel} />
      <div className="download-settings-dialog">
        <div className="dialog-header">
          <h3>下载设置</h3>
          <button className="dialog-close" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="dialog-content">
          <div className="setting-group">
            <label htmlFor="threads-input">并发下载线程数</label>
            <div className="threads-input-group">
              <input
                id="threads-input"
                type="number"
                min="1"
                max="256"
                value={threads}
                onChange={(e) => handleThreadsChange(parseInt(e.target.value) || 1)}
              />
              <input
                type="range"
                min="1"
                max="256"
                value={threads}
                onChange={(e) => handleThreadsChange(parseInt(e.target.value))}
                className="threads-slider"
              />
            </div>
            <div className="setting-description">
              <p>推荐值: 32 线程</p>
              <p>范围: 1-256 线程</p>
              {showWarning && (
                <div className="warning-message">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <span>
                    注意: 线程数过高可能会占用较多系统资源和网络带宽。
                  </span> // 太快了是会死人的啦啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊
                </div>
              )}
            </div>
          </div>

          <div className="info-box">
            <h4>说明</h4>
            <ul>
              <li>线程数越高，下载速度越快，但会占用更多系统资源</li>
              <li>建议根据网络状况和系统性能调整</li>
              <li>默认 32 线程适合大多数情况</li>
              <li>如果下载出现错误，可以尝试降低线程数</li>
            </ul>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button className="btn-confirm" onClick={handleConfirm}>
            开始下载
          </button>
        </div>
      </div>
    </>
  );
}