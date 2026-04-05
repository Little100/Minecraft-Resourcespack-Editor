import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@mpe/ui';
import { logger } from '../utils/logger';
import './AudioHoverPlayer.css';

interface AudioHoverPlayerProps {
  audioPath: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function AudioHoverPlayer({ audioPath, position, onClose }: AudioHoverPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let blobUrl: string | null = null;

    const loadAudio = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const packDir = await invoke<string>('get_current_pack_path');
        
        const extensions = ['ogg', 'wav'];
        let found = false;

        for (const ext of extensions) {
          const fullPath = `${packDir}/assets/minecraft/sounds/${audioPath}.${ext}`;
          
          try {
            const exists = await invoke<boolean>('check_file_exists', { filePath: fullPath });
            
            if (exists) {
              const base64Content = await invoke<string>('read_file_as_base64', { filePath: fullPath });
              
              const byteCharacters = atob(base64Content);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: `audio/${ext}` });
              
              blobUrl = URL.createObjectURL(blob);
              setAudioUrl(blobUrl);
              found = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!found) {
          setError('音频文件不存在');
        }
      } catch (err) {
        logger.error('加载音频失败:', err);
        setError('加载失败');
      } finally {
        setIsLoading(false);
      }
    };

    loadAudio();

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [audioPath]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const togglePlay = () => {
    if (!audioRef.current || error) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        logger.error('播放失败:', err);
        setError('播放失败');
      });
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  const handleError = () => {
    setError('播放失败');
    setIsPlaying(false);
  };

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    
    audioRef.current.currentTime = newTime;
    setProgress(percentage * 100);
  };

  return (
    <div 
      ref={playerRef}
      className="audio-hover-player"
      style={{
        top: `${position.y}px`,
        left: `${position.x}px`,
      }}
      onMouseLeave={onClose}
    >
      <div className="audio-hover-header">
        <div className="audio-path-display">
          <Icon name="music" size={16} />
          <span>{audioPath}</span>
        </div>
        <button className="close-btn" onClick={onClose} title="关闭">
          x
        </button>
      </div>

      {isLoading && (
        <div className="audio-hover-loading">
          <div className="spinner-small"></div>
          <span>加载中...</span>
        </div>
      )}

      {error && (
        <div className="audio-hover-error" title={error}>
          <Icon name="report-issue" size={32} />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && audioUrl && (
        <div className="audio-hover-controls">
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onError={handleError}
          />

          <div className="play-controls">
            <button 
              className="play-btn-hover" 
              onClick={togglePlay}
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <Icon name="pause" size={20} filled />
              ) : (
                <Icon name="play" size={20} filled />
              )}
            </button>

            <div className="progress-section">
              <div 
                className="progress-bar-hover" 
                onClick={handleProgressClick}
                title="点击跳转"
              >
                <div className="progress-fill-hover" style={{ width: `${progress}%` }} />
              </div>
              <div className="time-display-hover">
                {formatTime((progress / 100) * duration)} / {formatTime(duration)}
              </div>
            </div>
          </div>

          <div className="volume-section">
            <Icon name="volume" size={16} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="volume-slider-hover"
              title={`音量: ${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      )}
    </div>
  );
}