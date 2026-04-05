import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Icon, Button, useToast } from '@mpe/ui';
import './SoundCreatorDialog.css';
import { logger } from '../utils/logger';

interface SoundCreatorDialogProps {
  onClose: () => void;
  onSave: (soundData: any) => void;
}

interface SoundTranslation {
  name: string;
  volume?: number;
  weight?: number;
  pitch?: number;
  chinese: string;
}

interface SoundEvent {
  sounds: SoundTranslation[];
}

interface TranslateData {
  [key: string]: SoundEvent;
}

interface CategoryData {
  category: string;
  items: {
    key: string;
    sound: SoundTranslation;
  }[];
}

interface CategoryItem {
  displayName: string;     // 显示名
  fullPath: string;        // 完整路径
  count: number;           // 子项数量
  isLeaf: boolean;         // 是否是叶子节点
  soundKey?: string;       // 音效键名
  sound?: SoundTranslation; // 音效数据
}

interface SoundEntryForm {
  name: string;
  volume: number;
  pitch: number;
  weight?: number;
  stream: boolean;
}

interface SoundEventForm {
  eventKey: string;
  category: string;
  replace: boolean;
  subtitle?: string;
  sounds: SoundEntryForm[];
}

export default function SoundCreatorDialog({ onClose, onSave }: SoundCreatorDialogProps) {
  const toast = useToast();
  const [hasAudioFiles, setHasAudioFiles] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [translateData, setTranslateData] = useState<TranslateData | null>(null);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [filteredCategories, setFilteredCategories] = useState<CategoryData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSound, setSelectedSound] = useState<{
    key: string;
    sound: SoundTranslation;
  } | null>(null);
  const [navigationPath, setNavigationPath] = useState<string[]>([]);
  const [currentLevel, setCurrentLevel] = useState<CategoryItem[]>([]);
  const [hierarchy, setHierarchy] = useState<Map<string, any>>(new Map());
  const [formData, setFormData] = useState<SoundEventForm>({
    eventKey: '',
    category: 'block',
    replace: true,
    subtitle: '',
    sounds: []
  });
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);

  useEffect(() => {
    checkAudioFiles();
  }, []);

  useEffect(() => {
    if (hasAudioFiles && !isChecking) {
      loadTranslateData();
    }
  }, [hasAudioFiles, isChecking]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredCategories(categories);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = categories.map(cat => ({
      ...cat,
      items: cat.items.filter(item =>
        item.key.toLowerCase().includes(query) ||
        item.sound.chinese.includes(searchQuery) ||
        item.sound.name.toLowerCase().includes(query)
      )
    })).filter(cat => cat.items.length > 0);
    
    setFilteredCategories(filtered);
  }, [searchQuery, categories]);

  const checkAudioFiles = async () => {
    try {
      const files = await invoke<string[]>('check_temp_audio_files');
      setHasAudioFiles(files.length > 0);
    } catch (error) {
      logger.error('检查音频文件失败:', error);
      setHasAudioFiles(false);
    } finally {
      setIsChecking(false);
    }
  };

  const loadTranslateData = async () => {
    setIsLoadingData(true);
    try {
      let content: string;
      
      try {
        const response = await fetch('/sounds/translate/sounds.json');
        if (response.ok) {
          content = await response.text();
        } else {
          throw new Error('File not found in public directory');
        }
      } catch (fetchError) {
        logger.debug('尝试从开发环境路径读取翻译文件...');
        content = await invoke<string>('read_file_content', {
          filePath: 'sounds/translate/sounds.json'
        });
      }
      
      const data: TranslateData = JSON.parse(content);
      setTranslateData(data);
      
      // 构建层级结构
      const hierarchyData = buildHierarchy(data);
      setHierarchy(hierarchyData);
      
      // 加载根层级
      loadRootLevel(hierarchyData);
      
      const categorized = categorizeData(data);
      setCategories(categorized);
      setFilteredCategories(categorized);
    } catch (error) {
      logger.error('读取翻译文件失败:', error);
      toast({ message: '读取音效翻译文件失败，请确保已下载音效资源', type: 'error' });
    } finally {
      setIsLoadingData(false);
    }
  };

  const buildHierarchy = (data: TranslateData): Map<string, any> => {
    const pathMap = new Map<string, Map<string, any>>();
    pathMap.set('root', new Map());
    
    for (const [key, value] of Object.entries(data)) {
      if (!value.sounds || value.sounds.length === 0) continue;
      
      value.sounds.forEach(sound => {
        if (!sound.chinese) return;
        
        const parts = sound.chinese.split('/');
        if (parts.length < 2) return;
        
        const rootMap = pathMap.get('root')!;
        
        if (!rootMap.has(parts[0])) {
          rootMap.set(parts[0], { count: 0, children: new Map() });
        }
        const level1 = rootMap.get(parts[0]);
        level1.count++;
        
        if (parts[1]) {
          if (!level1.children.has(parts[1])) {
            level1.children.set(parts[1], { count: 0, items: [] });
          }
          const level2 = level1.children.get(parts[1]);
          level2.count++;
          level2.items.push({ key, sound });
        }
      });
    }
    
    return pathMap;
  };

  const categorizeData = (data: TranslateData): CategoryData[] => {
    const categoryMap = new Map<string, CategoryData>();
    
    for (const [key, value] of Object.entries(data)) {
      if (!value.sounds || value.sounds.length === 0) continue;
      
      value.sounds.forEach(sound => {
        if (!sound.chinese) return;
        
        const pathParts = sound.chinese.split('/');
        const categoryName = pathParts.slice(0, 2).join('/');
        
        if (!categoryMap.has(categoryName)) {
          categoryMap.set(categoryName, {
            category: categoryName,
            items: []
          });
        }
        
        categoryMap.get(categoryName)!.items.push({
          key,
          sound
        });
      });
    }
    
    return Array.from(categoryMap.values()).sort((a, b) =>
      a.category.localeCompare(b.category, 'zh-CN')
    );
  };

  const handleSelectSound = (item: { key: string; sound: SoundTranslation }) => {
    setSelectedSound(item);
    setFormData({
      eventKey: item.key,
      category: 'block',
      replace: true,
      subtitle: '',
      sounds: [{
        name: item.sound.name,
        volume: item.sound.volume || 1.0,
        pitch: item.sound.pitch || 1.0,
        weight: item.sound.weight,
        stream: false
      }]
    });
  };

  const handleAddSoundEntry = () => {
    setFormData({
      ...formData,
      sounds: [
        ...formData.sounds,
        {
          name: '',
          volume: 1.0,
          pitch: 1.0,
          stream: false
        }
      ]
    });
  };

  const handleRemoveSoundEntry = (index: number) => {
    setFormData({
      ...formData,
      sounds: formData.sounds.filter((_, i) => i !== index)
    });
  };

  const handleUpdateSoundEntry = (index: number, field: string, value: any) => {
    const newSounds = [...formData.sounds];
    newSounds[index] = { ...newSounds[index], [field]: value };
    setFormData({ ...formData, sounds: newSounds });
  };

  const validateForm = (): string | null => {
    if (!formData.eventKey.trim()) {
      return '请输入音效事件键名';
    }
    
    if (formData.sounds.length === 0) {
      return '至少需要一个音效条目';
    }
    
    for (let i = 0; i < formData.sounds.length; i++) {
      const sound = formData.sounds[i];
      
      if (!sound.name.trim()) {
        return `条目 #${i + 1}: 请输入音频文件路径`;
      }
      
      if (sound.volume < 0 || sound.volume > 1) {
        return `条目 #${i + 1}: 音量必须在 0.0-1.0 之间`;
      }
      
      if (sound.pitch < 0.5 || sound.pitch > 2) {
        return `条目 #${i + 1}: 音调必须在 0.5-2.0 之间`;
      }
    }
    
    return null;
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) {
      toast({ message: error, type: 'warning' });
      return;
    }
    
    try {
      let currentData: any = {};
      
      try {
        const currentContent = await invoke<string>('read_file_content', {
          filePath: 'assets/minecraft/sounds/sounds.json'
        });
        currentData = JSON.parse(currentContent);
      } catch (readError) {
        logger.debug('sounds.json 不存在，将创建新文件');
        currentData = {};
      }
      
      const newEvent: any = {
        category: formData.category,
        replace: formData.replace,
        sounds: formData.sounds.map(s => {
          const entry: any = { name: s.name };
          if (s.volume !== 1.0) entry.volume = s.volume;
          if (s.pitch !== 1.0) entry.pitch = s.pitch;
          if (s.weight) entry.weight = s.weight;
          if (s.stream) entry.stream = s.stream;
          return entry;
        })
      };
      
      if (formData.subtitle) {
        newEvent.subtitle = formData.subtitle;
      }
      
      currentData[formData.eventKey] = newEvent;
      
      const newContent = JSON.stringify(currentData, null, 2);
      await invoke('write_file_content', {
        filePath: 'assets/minecraft/sounds/sounds.json',
        content: newContent
      });
      
      logger.debug('自定义音效保存成功，文件内容:', newContent);
      
      // 复制所有音频文件
      for (const sound of formData.sounds) {
        if (sound.name) {
          try {
            logger.debug('开始复制音频文件:', sound.name);
            await invoke('copy_sound_file', {
              soundName: sound.name
            });
            logger.debug('音频文件复制成功:', sound.name);
          } catch (copyError) {
            logger.error('复制音频文件失败:', sound.name, copyError);
          }
        }
      }
      
      toast({ message: '音效已成功保存！', type: 'success' });
      onSave(newEvent);
      onClose();
    } catch (error) {
      logger.error('保存失败:', error);
      toast({ message: `保存失败: ${error}`, type: 'error' });
    }
  };

  const loadRootLevel = (hierarchyData: Map<string, any>) => {
    const rootMap = hierarchyData.get('root');
    if (!rootMap) return;
    
    const items: CategoryItem[] = [];
    
    items.push({
      displayName: '自定义音效',
      fullPath: '__custom__',
      count: 0,
      isLeaf: true,
      soundKey: '__custom__'
    });
    
    rootMap.forEach((value: any, key: string) => {
      items.push({
        displayName: key,
        fullPath: key,
        count: value.count,
        isLeaf: false
      });
    });
    
    const customItem = items[0];
    const otherItems = items.slice(1).sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'zh-CN')
    );
    
    setCurrentLevel([customItem, ...otherItems]);
    setNavigationPath([]);
  };

  const loadLevel = (path: string[]) => {
    if (path.length === 0) {
      loadRootLevel(hierarchy);
    } else if (path.length === 1) {
      const rootMap = hierarchy.get('root');
      const level1 = rootMap?.get(path[0])?.children;
      if (!level1) return;
      
      const items: CategoryItem[] = [];
      level1.forEach((value: any, key: string) => {
        items.push({
          displayName: key,
          fullPath: `${path[0]}/${key}`,
          count: value.items.length,
          isLeaf: false
        });
      });
      setCurrentLevel(items.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'zh-CN')
      ));
    } else if (path.length === 2) {
      const rootMap = hierarchy.get('root');
      const level1 = rootMap?.get(path[0])?.children;
      const level2 = level1?.get(path[1])?.items;
      if (!level2) return;
      
      const items: CategoryItem[] = level2.map((item: any) => ({
        displayName: item.sound.chinese.split('/').slice(2).join('/') || item.key,
        fullPath: item.sound.chinese,
        count: 0,
        isLeaf: true,
        soundKey: item.key,
        sound: item.sound
      }));
      setCurrentLevel(items);
    }
  };

  const navigateToLevel = (item: CategoryItem) => {
    if (item.isLeaf) {
      if (item.soundKey === '__custom__') {
        setIsCustomMode(true);
        setSelectedSound(null);
        setFormData({
          eventKey: '',
          category: 'block',
          replace: true,
          subtitle: '',
          sounds: [{
            name: '',
            volume: 1.0,
            pitch: 1.0,
            stream: false
          }]
        });
      } else {
        handleSaveVanillaSound(item.soundKey!, item.sound!);
      }
    } else {
      const newPath = [...navigationPath, item.displayName];
      setNavigationPath(newPath);
      loadLevel(newPath);
    }
  };

  const navigateBack = () => {
    if (selectedSound) {
      setSelectedSound(null);
      return;
    }
    
    if (navigationPath.length === 0) return;
    
    const newPath = navigationPath.slice(0, -1);
    setNavigationPath(newPath);
    loadLevel(newPath);
  };

  const handleBackToList = () => {
    setSelectedSound(null);
    setIsCustomMode(false);
    setFormData({
      eventKey: '',
      category: 'block',
      replace: true,
      subtitle: '',
      sounds: []
    });
  };

  // 保存原版音效
  const handleSaveVanillaSound = async (key: string, sound: SoundTranslation) => {
    try {
      let currentData: any = {};
      try {
        const currentContent = await invoke<string>('read_file_content', {
          filePath: 'assets/minecraft/sounds/sounds.json'
        });
        currentData = JSON.parse(currentContent);
      } catch (readError) {
        logger.debug('sounds.json 不存在，将创建新文件');
        currentData = {};
      }
      
      logger.debug('当前文件数据:', currentData);
      
      const newEvent: any = {
        sounds: [sound.name]
      };
      
      if (sound.volume && sound.volume !== 1.0) {
        newEvent.sounds = [{
          name: sound.name,
          volume: sound.volume
        }];
      }
      
      if (sound.weight) {
        if (typeof newEvent.sounds[0] === 'string') {
          newEvent.sounds = [{
            name: sound.name,
            weight: sound.weight
          }];
        } else {
          newEvent.sounds[0].weight = sound.weight;
        }
      }
      
      if (sound.pitch && sound.pitch !== 1.0) {
        if (typeof newEvent.sounds[0] === 'string') {
          newEvent.sounds = [{
            name: sound.name,
            pitch: sound.pitch
          }];
        } else {
          newEvent.sounds[0].pitch = sound.pitch;
        }
      }
      
      currentData[key] = newEvent;
      
      const newContent = JSON.stringify(currentData, null, 2);
      
      logger.debug('准备写入文件，路径: assets/minecraft/sounds/sounds.json');
      logger.debug('写入内容:', newContent);
      
      await invoke('write_file_content', {
        filePath: 'assets/minecraft/sounds/sounds.json',
        content: newContent
      });
      
      logger.debug('write_file_content 调用完成');
      
      // 复制音频文件
      try {
        logger.debug('开始复制音频文件:', sound.name);
        await invoke('copy_sound_file', {
          soundName: sound.name
        });
        logger.debug('音频文件复制成功');
      } catch (copyError) {
        logger.error('复制音频文件失败:', copyError);
        toast({ message: `警告：音效配置已保存，但音频文件复制失败: ${copyError}`, type: 'warning' });
      }
      
      toast({ message: `音效 "${sound.chinese || key}" 已成功添加！`, type: 'success' });
      onSave(newEvent);
      onClose();
    } catch (error) {
      logger.error('保存原版音效失败:', error);
      toast({ message: `保存失败: ${error}`, type: 'error' });
    }
  };

// 音频播放器组件
const AudioPlayer = ({ soundPath }: { soundPath: string }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  useEffect(() => {
    const loadAudioUrl = async () => {
      if (!soundPath) {
        setAudioUrl('');
        return;
      }
      
      setIsLoading(true);
      setError(null);
      
      try {
        // 获取当前资源包路径
        const packDir = await invoke<string>('get_current_pack_path');
        
        const oggPath = `${packDir}/.little100/sounds/${soundPath}.ogg`;
        const wavPath = `${packDir}/.little100/sounds/${soundPath}.wav`;
        
        // 检查文件是否存在
        try {
          const oggExists = await invoke<boolean>('check_file_exists', { filePath: oggPath });
          if (oggExists) {
            setAudioUrl(`file:///${oggPath.replace(/\\/g, '/')}`);
            setError(null);
          } else {
            const wavExists = await invoke<boolean>('check_file_exists', { filePath: wavPath });
            if (wavExists) {
              setAudioUrl(`file:///${wavPath.replace(/\\/g, '/')}`);
              setError(null);
            } else {
              setAudioUrl('');
              setError('音频文件不存在');
            }
          }
        } catch (checkError) {
          logger.error('检查文件失败:', checkError);
          setAudioUrl('');
          setError('音频文件不存在');
        }
      } catch (error) {
        logger.error('加载音频URL失败:', error);
        setAudioUrl('');
        setError('加载音频失败');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAudioUrl();
  }, [soundPath]);
  
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        logger.error('播放失败:', err);
        setError('无法播放音频文件');
      });
    }
    setIsPlaying(!isPlaying);
  };
  
  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };
  
  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };
  
  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setError(null);
    }
  };
  
  const handleError = () => {
    setError('音频文件加载失败');
    setIsPlaying(false);
  };
  
  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
  };
  
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  if (!soundPath) {
    return (
      <div className="audio-player disabled">
        <span className="audio-placeholder">请先输入音频文件路径</span>
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div className="audio-player-loading">
        <span>加载中...</span>
      </div>
    );
  }
  
  if (error && !audioUrl) {
    return (
      <div className="audio-player-error">
        <span>{error}</span>
      </div>
    );
  }
  
  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleError}
      />
      
      <button className="play-btn" onClick={togglePlay} disabled={!!error}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="time-display">
          {duration > 0 && (
            <span>{formatTime((progress / 100) * duration)} / {formatTime(duration)}</span>
          )}
        </div>
      </div>
      
      <div className="volume-control">
        <span className="volume-icon">🔊</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          className="volume-slider"
        />
      </div>
      
      {error && <div className="audio-error">{error}</div>}
    </div>
  );
};


  return (
    <>
      <div className="sound-creator-backdrop" onClick={onClose}></div>
      <div className="sound-creator-dialog">
      {isChecking && (
        <div className="sound-creator-loading">
          <div className="spinner"></div>
          <p>检查音频文件中...</p>
        </div>
      )}

      {!isChecking && !hasAudioFiles && (
        <div className="sound-creator-error">
          <Icon name="report-issue" size={24} style={{ width: 64, height: 64 }} />
          <h3>没有音频文件</h3>
          <p>必须要下载音频文件才可以使用此功能</p>
          <Button variant="primary" onClick={onClose}>
            关闭
          </Button>
        </div>
      )}

      {!isChecking && hasAudioFiles && (
        <div className="sound-creator-main">
          <div className="sound-creator-header">
            <div className="header-left">
              {(navigationPath.length > 0 || selectedSound) && (
                <button
                  className="btn-back"
                  onClick={navigateBack}
                  title="返回上一层"
                  data-version="v2"
                >
                  <Icon name="arrow-left" size={20} />
                </button>
              )}
              <div className="breadcrumb">
                <span className="breadcrumb-item">创建音效</span>
                <span className="ai-translation-notice-header">
                  (翻译文件由 AI 翻译，不保证一定准确)
                </span>
                {navigationPath.map((name, index) => (
                  <React.Fragment key={index}>
                    <span className="breadcrumb-separator">/</span>
                    <span className="breadcrumb-item">{name}</span>
                  </React.Fragment>
                ))}
                {selectedSound && (
                  <>
                    <span className="breadcrumb-separator">/</span>
                    <span className="breadcrumb-item">编辑</span>
                  </>
                )}
              </div>
            </div>
            <button className="dialog-close" onClick={onClose} title="关闭">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="sound-creator-content">
            {!selectedSound && !isCustomMode ? (
              <>
                {/* 搜索框 */}
                <div className="sound-search-box">
                  <Icon name="search" size={16} />
                  <input
                    type="text"
                    placeholder="搜索音效..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="sound-search-input"
                  />
                  {searchQuery && (
                    <button
                      className="search-clear-btn"
                      onClick={() => setSearchQuery('')}
                    >
                      x
                    </button>
                  )}
                </div>

                {/* 层级导航卡片 */}
                {isLoadingData ? (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>加载音效数据中...</p>
                  </div>
                ) : (
                  <div className="category-grid">
                    {currentLevel.map((item, index) => (
                      <div
                        key={index}
                        className="category-card"
                      >
                        <div onClick={() => navigateToLevel(item)} style={{ cursor: 'pointer', flex: 1 }}>
                          <div className="card-icon">
                            {item.isLeaf ? '🎵' : '📁'}
                          </div>
                          <div className="card-title">{item.displayName}</div>
                          {!item.isLeaf && (
                            <div className="card-count">{item.count} 项</div>
                          )}
                        </div>
                        {/* 如果是叶子节点且不是自定义音效，显示播放器 */}
                        {item.isLeaf && item.soundKey !== '__custom__' && item.sound && (
                          <div style={{ marginTop: '8px', width: '100%' }}>
                            <AudioPlayer soundPath={item.sound.name} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 自定义音效表单区域 */}
                <div className="sound-form-container">
                  <div className="form-header">
                    <button className="btn-back" onClick={handleBackToList}>
                      ← 返回列表
                    </button>
                  </div>
                  
                  <div className="form-group">
                    <label>音效事件键名</label>
                    <input
                      type="text"
                      value={formData.eventKey}
                      onChange={(e) => setFormData({...formData, eventKey: e.target.value})}
                      placeholder="例如: block.anvil.place"
                    />
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>分类 (category)</label>
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({...formData, category: e.target.value})}
                      >
                        <option value="block">block</option>
                        <option value="entity">entity</option>
                        <option value="music">music</option>
                        <option value="player">player</option>
                        <option value="ambient">ambient</option>
                        <option value="ui">ui</option>
                      </select>
                    </div>
                    
                    <div className="form-group checkbox-group">
                      <label>
                        <input
                          type="checkbox"
                          checked={formData.replace}
                          onChange={(e) => setFormData({...formData, replace: e.target.checked})}
                        />
                        覆盖默认音效 (replace)
                      </label>
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>字幕键 (subtitle) - 可选</label>
                    <input
                      type="text"
                      value={formData.subtitle}
                      onChange={(e) => setFormData({...formData, subtitle: e.target.value})}
                      placeholder="例如: subtitles.block.anvil.place"
                    />
                  </div>

                  {/* 音效条目列表 */}
                  <div className="sound-entries">
                    <div className="entries-header">
                      <h5>音效条目 ({formData.sounds.length})</h5>
                      <button className="btn-add" onClick={handleAddSoundEntry}>+ 添加条目</button>
                    </div>
                    
                    {formData.sounds.map((sound, index) => (
                      <div key={index} className="sound-entry-card">
                        <div className="entry-header">
                          <span>条目 #{index + 1}</span>
                          <button className="btn-remove" onClick={() => handleRemoveSoundEntry(index)}>删除</button>
                        </div>
                        
                        <div className="form-group">
                          <label>音频文件路径 (不含扩展名)</label>
                          <input
                            type="text"
                            value={sound.name}
                            onChange={(e) => handleUpdateSoundEntry(index, 'name', e.target.value)}
                            placeholder="例如: custom/anvil/hit1"
                          />
                        </div>
                        
                        <div className="form-row">
                          <div className="form-group">
                            <label>音量 (volume): {sound.volume.toFixed(2)}</label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={sound.volume}
                              onChange={(e) => handleUpdateSoundEntry(index, 'volume', parseFloat(e.target.value))}
                            />
                          </div>
                          
                          <div className="form-group">
                            <label>音调 (pitch): {sound.pitch.toFixed(2)}</label>
                            <input
                              type="range"
                              min="0.5"
                              max="2"
                              step="0.1"
                              value={sound.pitch}
                              onChange={(e) => handleUpdateSoundEntry(index, 'pitch', parseFloat(e.target.value))}
                            />
                          </div>
                        </div>
                        
                        <div className="form-row">
                          <div className="form-group">
                            <label>权重 (weight) - 可选</label>
                            <input
                              type="number"
                              min="1"
                              value={sound.weight || ''}
                              onChange={(e) => handleUpdateSoundEntry(index, 'weight', e.target.value ? parseInt(e.target.value) : undefined)}
                              placeholder="留空使用默认"
                            />
                          </div>
                          
                          <div className="form-group checkbox-group">
                            <label>
                              <input
                                type="checkbox"
                                checked={sound.stream}
                                onChange={(e) => handleUpdateSoundEntry(index, 'stream', e.target.checked)}
                              />
                              流式播放 (stream) - 大文件推荐
                            </label>
                          </div>
                        </div>
                        
                        {/* 音频播放器 */}
                        <AudioPlayer soundPath={sound.name} />
                      </div>
                    ))}
                  </div>

                  {/* 底部操作按钮 */}
                  <div className="form-footer">
                    <Button variant="secondary" onClick={handleBackToList}>
                      取消
                    </Button>
                    <Button variant="primary" onClick={handleSave}>
                      保存音效
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}