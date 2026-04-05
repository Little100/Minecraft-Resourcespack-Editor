import { useState } from 'react';
import { Dialog, Button, Icon } from '@mpe/ui';
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
    <Dialog
      open={true}
      onClose={onCancel}
      title="下载设置"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={handleConfirm}>开始下载</Button>
        </>
      }
    >
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
                <Icon name="warning" size={16} />
                <span>
                  注意: 线程数过高可能会占用较多系统资源和网络带宽。
                </span>
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
    </Dialog>
  );
}