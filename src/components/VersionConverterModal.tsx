import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { selectZipFile, selectFolder, selectOutputFolder } from '../utils/tauri-api';
import { getVersionRange, getVersionsWithType, isReleaseVersion, getVersionsByPackFormat } from '../utils/version-map';
import { Icon, useToast } from '@mpe/ui';
import './VersionConverterModal.css';
import { logger } from '../utils/logger';
import { useThemeDetector } from '../hooks/useThemeDetector';
import { formatMinecraftTextHtml } from '../utils/minecraft-text';

interface PackMetadata {
  pack_format?: number;
  min_format?: number | [number, number];
  max_format?: number | [number, number];
  supported_format?: number[] | { min_inclusive: number; max_inclusive: number };
  supported_formats?: number[] | { min_inclusive: number; max_inclusive: number };
  description?: string;
}

interface VersionConverterModalProps {
  onClose: () => void;
}

const VersionConverterModal = ({ onClose }: VersionConverterModalProps) => {
  const toast = useToast();
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [packMetadata, setPackMetadata] = useState<PackMetadata | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('未知版本');
  const [supportedVersionRange, setSupportedVersionRange] = useState<string>('');
  const [supportedVersionHtml, setSupportedVersionHtml] = useState<string>('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [allVersionsData, setAllVersionsData] = useState<{releases: string[], previews: string[]}>({releases: [], previews: []});
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableVersions, setAvailableVersions] = useState<Array<[number, string, string[]]>>([]);
  const [selectedTargetVersion, setSelectedTargetVersion] = useState<string>('');
  const [outputPath, setOutputPath] = useState<string>('');
  const [outputFileName, setOutputFileName] = useState<string>('');
  const [converting, setConverting] = useState(false);
  const [conversionSuccess, setConversionSuccess] = useState(false);
  const [currentVersionHtml, setCurrentVersionHtml] = useState<string>('');
  const [showPreviewVersions, setShowPreviewVersions] = useState(false);
  const [versionSearchQuery, setVersionSearchQuery] = useState<string>('');
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [isDraggingOnConverter, setIsDraggingOnConverter] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const analyzeRef = useRef<(path: string, type: 'zip' | 'folder') => Promise<void>>(() => { throw new Error('not initialized'); });
  const currentTheme = useThemeDetector();

  // 从拖拽路径中提取文件路径 (Tauri WebView2 下 DataTransfer 不带 path)
  const extractNativePath = (file: File): string | undefined => {
    const withPath = file as File & { path?: string };
    return typeof withPath.path === 'string' && withPath.path.length > 0
      ? withPath.path
      : undefined;
  };

  const handleConverterDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOnConverter(true);
  };

  const handleConverterDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleConverterDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    setIsDraggingOnConverter(false);
  };

  const handleConverterDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOnConverter(false);

    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = extractNativePath(file);
      if (p) paths.push(p);
    }

    if (paths.length === 0) {
      toast({ message: '未获取到本地路径，请使用「导入 ZIP 文件」或「导入文件夹」按钮选择', type: 'warning' });
      return;
    }

    const firstPath = paths[0];
    const isZip = /\.zip$/i.test(firstPath);

    try {
      setError(null);
      setSelectedPath(firstPath);
      setLoading(true);

      // 生成默认输出文件名
      if (isZip) {
        const inputFileName = firstPath.split(/[/\\]/).pop() || 'pack';
        const defaultFileName = inputFileName.replace(/\.(zip|mcpack)$/i, '') + '_converted.zip';
        setOutputFileName(defaultFileName);
        await analyzeRef.current(firstPath, 'zip');
      } else {
        const folderName = firstPath.split(/[/\\]/).pop() || 'pack';
        setOutputFileName(`${folderName}_converted`);
        await analyzeRef.current(firstPath, 'folder');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Tauri 系统级拖放（WebView 原生拖放事件）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      if (!alive) return;
      try {
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          if (!alive) return;
          const p = event.payload;
          if (p.type === 'drop' && p.paths.length > 0) {
            const firstPath = p.paths[0];
            const isZip = /\.zip$/i.test(firstPath);

            setError(null);
            setSelectedPath(firstPath);
            setLoading(true);

            const doAnalyze = async () => {
              try {
                if (isZip) {
                  const inputFileName = firstPath.split(/[/\\]/).pop() || 'pack';
                  const defaultFileName = inputFileName.replace(/\.(zip|mcpack)$/i, '') + '_converted.zip';
                  setOutputFileName(defaultFileName);
                  await analyzeRef.current(firstPath, 'zip');
                } else {
                  const folderName = firstPath.split(/[/\\]/).pop() || 'pack';
                  setOutputFileName(`${folderName}_converted`);
                  await analyzeRef.current(firstPath, 'folder');
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setLoading(false);
              }
            };

            doAnalyze();
          }
        });
        if (alive) unlisten = fn;
        else fn();
      } catch {
        /* 非 Tauri 环境 */
      }
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowVersionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // 搜索时自动打开下拉框
  useEffect(() => {
    if (versionSearchQuery) {
      setShowVersionDropdown(true);
    }
  }, [versionSearchQuery]);

  const handleSelectZip = async () => {
    try {
      setError(null);
      const zipPath = await selectZipFile();
      if (zipPath && zipPath.trim() !== '') {
        setLoading(true);
        setSelectedPath(zipPath);
        
        // 生成默认输出文件名
        const inputFileName = zipPath.split(/[/\\]/).pop() || 'pack';
        const defaultFileName = inputFileName.replace(/\.(zip|mcpack)$/i, '') + '_converted.zip';
        setOutputFileName(defaultFileName);
        
        await analyzeRef.current(zipPath, 'zip');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      setError(null);
      const folderPath = await selectFolder();
      if (folderPath && folderPath.trim() !== '') {
        setLoading(true);
        setSelectedPath(folderPath);
        
        // 生成默认输出文件名
        const folderName = folderPath.split(/[/\\]/).pop() || 'pack';
        setOutputFileName(`${folderName}_converted`);
        
        await analyzeRef.current(folderPath, 'folder');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 获取可用的版本列表
  useEffect(() => {
    const loadVersions = async () => {
      try {
        const versions = await invoke<Array<[number, string]>>('get_supported_versions');
        // 将后端返回的数据扩展为包含原始版本列表的格式
        const versionsWithRaw: Array<[number, string, string[]]> = await Promise.all(
          versions.map(async ([packFormat, displayStr]) => {
            // 从显示字符串中提取原始版本
            const rawVersions = await getVersionsByPackFormat(packFormat);
            return [packFormat, displayStr, rawVersions];
          })
        );
        setAvailableVersions(versionsWithRaw);
      } catch (err) {
        logger.error('[VersionConverter] 无法加载版本列表:', err);
      }
    };
    loadVersions();
  }, []);

  const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  };

  const isSubdirectory = (parentPath: string, childPath: string): boolean => {
    const normalizedParent = normalizePath(parentPath);
    const normalizedChild = normalizePath(childPath);
    
    if (normalizedParent === normalizedChild) {
      return false;
    }
    
    return normalizedChild.startsWith(normalizedParent + '/');
  };

  // 检查两个路径是否相同
  const isSamePath = (path1: string, path2: string): boolean => {
    return normalizePath(path1) === normalizePath(path2);
  };

  const [sameDirectoryWarning, setSameDirectoryWarning] = useState<string | null>(null);

  const handleSelectOutputPath = async () => {
    try {
      const folder = await selectOutputFolder();
      if (folder && folder.trim() !== '') {
        // 检查是否选择了输入路径的子目录
        if (selectedPath && isSubdirectory(selectedPath, folder)) {
          setError('禁止操作：不允许将输出目录设置为输入目录的子目录，这会导致严重的套娃问题！');
          return;
        }
        
        // 检查是否选择了相同的目录
        if (selectedPath && isSamePath(selectedPath, folder)) {
          setError('禁止操作：不允许将输出目录设置为与输入目录相同的位置，这会导致套娃问题！\n请选择其他目录作为输出位置。');
          return;
        }
        
        setSameDirectoryWarning(null);
        setOutputPath(folder);
        setError(null);
      }
    } catch (err) {
      setError('选择输出路径失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleConvert = async () => {
    if (!packMetadata) {
      setError('无效的资源包：未能读取pack.mcmeta文件，无法进行转换');
      return;
    }

    if (!selectedPath || !selectedTargetVersion) {
      setError('请选择目标版本');
      return;
    }

    if (!outputPath) {
      setError('请选择输出路径');
      return;
    }

    const trimmedFileName = outputFileName.trim();
    if (!trimmedFileName) {
      setError('请输入输出文件名');
      return;
    }

    const inputFolderName = selectedPath.split(/[/\\]/).pop() || '';
    
    const finalOutputPath = `${outputPath}/${trimmedFileName}`;
    
    if (isSamePath(selectedPath, outputPath) || isSubdirectory(selectedPath, outputPath)) {
      setError('禁止操作：输出目录不能是输入目录或其子目录！\n请选择其他目录作为输出位置。');
      return;
    }
    
    if (isSamePath(selectedPath, finalOutputPath)) {
      setError('输出路径不能与输入路径完全相同！\n请使用不同的输出文件名或选择不同的输出目录。');
      return;
    }
    
    const inputParentPath = selectedPath.substring(0, Math.max(selectedPath.lastIndexOf('/'), selectedPath.lastIndexOf('\\')));
    if (isSamePath(outputPath, inputParentPath) && trimmedFileName.toLowerCase() === inputFolderName.toLowerCase()) {
      setError('输出文件名不能与输入目录名相同，这会导致原始资源包被覆盖！\n请使用不同的文件名。');
      return;
    }

    if (isSubdirectory(finalOutputPath, selectedPath)) {
      setError('禁止操作：输入目录不能在输出路径内部，这会导致数据被覆盖！');
      return;
    }

    try {
      setConverting(true);
      setError(null);
      setConversionSuccess(false);

      // 调用转换命令
      const result = await invoke<string>('convert_pack_version', {
        inputPath: selectedPath,
        outputPath: finalOutputPath,
        targetVersion: selectedTargetVersion
      });

      logger.debug('[VersionConverter] 转换结果:', result);
      setConversionSuccess(true);
    } catch (err) {
      setError('转换失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setConverting(false);
    }
  };

  analyzeRef.current = async (path: string, type: 'zip' | 'folder') => {
    try {
      logger.debug('[VersionConverter] 开始分析资源包');
      logger.debug('[VersionConverter] 路径:', path);
      logger.debug('[VersionConverter] 类型:', type);
      
      const metadata = await invoke<PackMetadata>('read_pack_mcmeta', {
        path,
        isZip: type === 'zip'
      });

      logger.debug('[VersionConverter] 读取到的metadata:', JSON.stringify(metadata, null, 2));
      setPackMetadata(metadata);

      // 解析描述
      if (metadata.description) {
        let desc = '';
        if (typeof metadata.description === 'string') {
          desc = metadata.description;
        } else if (typeof metadata.description === 'object' && 'text' in metadata.description) {
          desc = (metadata.description as any).text;
        }
        logger.debug('[VersionConverter] 描述:', desc);
        setDescription(desc);
      }

      // 解析版本信息
      logger.debug('[VersionConverter] pack_format:', metadata.pack_format);
      logger.debug('[VersionConverter] min_format:', metadata.min_format);
      logger.debug('[VersionConverter] max_format:', metadata.max_format);
      
      // 优先使用pack_format
      let currentPackFormat: number | undefined = metadata.pack_format;
      
      // 如果没有pack_format但有min_format，使用min_format
      if (!currentPackFormat && metadata.min_format) {
        if (Array.isArray(metadata.min_format)) {
          currentPackFormat = metadata.min_format[0];
        } else {
          currentPackFormat = metadata.min_format;
        }
      }
      
      if (currentPackFormat) {
        try {
          const versionsInfo = await getVersionsWithType(currentPackFormat);
          logger.debug('[VersionConverter] 查询到的版本信息:', versionsInfo);
          
          setAllVersionsData(versionsInfo);
          
          // 默认只显示正式版范围
          if (versionsInfo.releases.length > 0) {
            const firstRelease = versionsInfo.releases[versionsInfo.releases.length - 1];
            const lastRelease = versionsInfo.releases[0];
            const releaseRange = firstRelease === lastRelease ? firstRelease : `${firstRelease} – ${lastRelease}`;
            setCurrentVersion(releaseRange);
            setCurrentVersionHtml(`<span class="version-chip release">${releaseRange}</span>`);
          } else if (versionsInfo.all.length > 0) {
            const firstVersion = versionsInfo.all[versionsInfo.all.length - 1];
            const lastVersion = versionsInfo.all[0];
            const versionRange = firstVersion === lastVersion ? firstVersion : `${firstVersion} – ${lastVersion}`;
            setCurrentVersion(versionRange);
            setCurrentVersionHtml(`<span class="version-chip preview">${versionRange}</span>`);
          } else {
            setCurrentVersion('未知版本');
            setCurrentVersionHtml('未知版本');
          }
        } catch (error) {
          logger.error('[VersionConverter] 版本查询失败:', error);
          setCurrentVersion('未知版本');
          setCurrentVersionHtml('未知版本');
        }
      } else {
        logger.debug('[VersionConverter] 没有pack_format字段');
        setCurrentVersion('未知版本');
        setCurrentVersionHtml('未知版本');
      }

      // 解析支持的版本范围
      const supportedFormats = metadata.supported_format || metadata.supported_formats;
      logger.debug('[VersionConverter] supported_format/formats:', supportedFormats);
      if (supportedFormats) {
        let minFormat = 0;
        let maxFormat = 0;
        
        if (Array.isArray(supportedFormats)) {
          logger.debug('[VersionConverter] supported_format是数组:', supportedFormats);
          minFormat = supportedFormats[0] || 0;
          maxFormat = supportedFormats[1] || minFormat;
        } else if (typeof supportedFormats === 'object') {
          logger.debug('[VersionConverter] supported_format是对象:', supportedFormats);
          const { min_inclusive, max_inclusive } = supportedFormats;
          minFormat = min_inclusive || 0;
          maxFormat = max_inclusive || minFormat;
        }
        
        if (minFormat > 0) {
          try {
            // 获取所有支持的版本
            const allVersions: string[] = [];
            const allVersionsHtml: string[] = [];
            
            for (let format = minFormat; format <= maxFormat; format++) {
              try {
                const versionsInfo = await getVersionsWithType(format);
                
                // 添加正式版
                if (versionsInfo.releases.length > 0) {
                  allVersions.push(...versionsInfo.releases);
                  const releaseChips = versionsInfo.releases.map(v =>
                    `<span class="version-chip release">${v}</span>`
                  );
                  allVersionsHtml.push(...releaseChips);
                }
                
                // 添加预览版
                if (versionsInfo.previews.length > 0) {
                  allVersions.push(...versionsInfo.previews);
                  const previewChips = versionsInfo.previews.map(v =>
                    `<span class="version-chip preview">${v}</span>`
                  );
                  allVersionsHtml.push(...previewChips);
                }
              } catch (error) {
                logger.error(`[VersionConverter] 查询pack_format ${format}失败:`, error);
              }
            }
            
            if (allVersions.length > 0) {
              setSupportedVersionHtml(allVersionsHtml.join(''));
              
              const firstVersion = allVersions[allVersions.length - 1];
              const lastVersion = allVersions[0];
              setSupportedVersionRange(`${firstVersion} - ${lastVersion}`);
              
              if (!selectedTargetVersion) {
                setSelectedTargetVersion(firstVersion);
                logger.debug('[VersionConverter] 默认选择最低版本:', firstVersion);
              }
            } else {
              setSupportedVersionRange('未知版本');
              setSupportedVersionHtml('未知版本');
            }
          } catch (error) {
            logger.error('[VersionConverter] 解析supported_format失败:', error);
            setSupportedVersionRange('未知版本');
            setSupportedVersionHtml('未知版本');
          }
        }
      } else {
        logger.debug('[VersionConverter] 没有supported_format/formats字段');
        setSupportedVersionRange('');
        setSupportedVersionHtml('');
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      if (errorMsg.includes('pack.mcmeta') || errorMsg.includes('not found') || errorMsg.includes('找不到')) {
        // 找不到pack.mcmeta显示错误
        toast({ message: '无效的资源包：未找到pack.mcmeta文件', type: 'error' });
        onClose();
        return;
      } else {
        setError('无法读取pack.mcmeta文件: ' + errorMsg);
      }
      
      // 清空之前的数据
      setPackMetadata(null);
      setCurrentVersion('未知版本');
      setCurrentVersionHtml('');
      setAllVersionsData({releases: [], previews: []});
      setDescription('');
      setSupportedVersionRange('');
      setSupportedVersionHtml('');
    }
  };

  const filteredVersions = availableVersions.filter(([packFormat, displayVersion, rawVersions]) => {
    // 搜索过滤
    if (versionSearchQuery) {
      const query = versionSearchQuery.toLowerCase();
      
      // 检查是否匹配显示字符串
      const matchesDisplay = displayVersion.toLowerCase().includes(query);
      
      // 检查是否匹配
      const matchesPackFormat = packFormat.toString().includes(query);
      
      // 检查是否匹配原始版本列表中的任何版本
      const matchesRawVersion = rawVersions.some(v => v.toLowerCase().includes(query));
      
      if (!matchesDisplay && !matchesPackFormat && !matchesRawVersion) {
        return false;
      }
    }
    
    // 过滤预览版
    if (!showPreviewVersions) {
      const hasPreviewMarker = displayVersion.includes('《预览版》') || displayVersion.includes('(预览版)');
      const hasReleaseWithPreview = displayVersion.includes('含') && displayVersion.includes('个预览版');
      if (hasPreviewMarker && !hasReleaseWithPreview) {
        return false;
      }
    }
    
    return true;
  });

  return (
    <>
      <div className="overlay" onClick={onClose}></div>
      <div
        className="version-converter-modal"
        onDragEnter={handleConverterDragEnter}
        onDragOver={handleConverterDragOver}
        onDragLeave={handleConverterDragLeave}
        onDrop={handleConverterDrop}
      >
        {/* 拖拽遮罩层 */}
        {isDraggingOnConverter && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <Icon name="folder" size={32} />
              <p>拖放文件夹或 ZIP 文件以选择资源包</p>
            </div>
          </div>
        )}

        <div className="modal-header">
          <h2>转换版本</h2>
          <button className="close-btn" onClick={onClose}>
            <Icon name="close" size={24} />
          </button>
        </div>

        <div className="modal-content">
          {!selectedPath ? (
            <div className="import-section">
              <p className="section-title">选择要转换的资源包</p>
              <div className="import-buttons">
                <button className="import-btn" onClick={handleSelectZip} disabled={loading}>
                  <Icon name="new-file" size={24} />
                  <span>导入 ZIP 文件</span>
                </button>
                <button className="import-btn" onClick={handleSelectFolder} disabled={loading}>
                  <Icon name="folder" size={24} />
                  <span>导入文件夹</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="pack-info-section">
              <div className="info-card">
                <h3>资源包信息</h3>
                <div className="info-item">
                  <span className="info-label">路径:</span>
                  <span className="info-value" title={selectedPath}>{selectedPath}</span>
                </div>
                {description && (
                  <div className="info-item">
                    <span className="info-label">描述:</span>
                    <span className="info-value minecraft-text" dangerouslySetInnerHTML={{ __html: formatMinecraftTextHtml(description, currentTheme) }}></span>
                  </div>
                )}
                {packMetadata?.pack_format && (
                  <div className="info-item version-item">
                    <div className="version-row">
                      <div className="version-label-with-icon">
                        <span className="version-label">版本</span>
                        {(allVersionsData.previews.length > 0 || allVersionsData.releases.length > 1) && (
                          <button
                            className="expand-versions-btn"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              logger.debug('[VersionConverter] 按钮被点击，当前状态:', showAllVersions);
                              logger.debug('[VersionConverter] allVersionsData:', allVersionsData);
                              setShowAllVersions(!showAllVersions);
                            }}
                            title="查看完整支持列表"
                            type="button"
                          >
                            <Icon name="info" size={20} />
                          </button>
                        )}
                      </div>
                      <span className="version-divider">|</span>
                      <span className="version-label">pack_format</span>
                    </div>
                    <div className="version-row">
                      <div
                        className="info-value version-display"
                        dangerouslySetInnerHTML={{ __html: currentVersionHtml }}
                      />
                      <span className="version-divider">|</span>
                      <span className="info-value">{packMetadata.pack_format}</span>
                    </div>
                    {showAllVersions && (
                      <div className="all-versions-list">
                        {allVersionsData.releases.length > 0 && (
                          <div className="version-group">
                            <span className="version-group-label">正式版:</span>
                            <div className="version-chips">
                              {allVersionsData.releases.map((v, i) => (
                                <span key={i} className="version-chip release">{v}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {allVersionsData.previews.length > 0 && (
                          <div className="version-group">
                            <span className="version-group-label">预览版:</span>
                            <div className="version-chips">
                              {allVersionsData.previews.map((v, i) => (
                                <span key={i} className="version-chip preview">{v}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {supportedVersionRange && packMetadata && (
                  <div className="info-item version-item">
                    <div className="version-row">
                      <span className="version-label">支持版本</span>
                      <span className="version-divider">|</span>
                      <span className="version-label">supported_format</span>
                    </div>
                    <div className="version-row">
                      <div
                        className="info-value version-display"
                        dangerouslySetInnerHTML={{ __html: supportedVersionHtml || supportedVersionRange }}
                      />
                      <span className="version-divider">|</span>
                      <span className="info-value">{JSON.stringify(packMetadata.supported_format || packMetadata.supported_formats)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="conversion-section">
                <h3>转换设置</h3>
                
                <div className="setting-item">
                  <label className="setting-label" style={{ marginBottom: '0.5rem' }}>目标版本</label>
                  
                  {/* 搜索框和切换开关 */}
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
                      <input
                        type="text"
                        className="output-path-input"
                        placeholder="搜索版本..."
                        value={versionSearchQuery}
                        onChange={(e) => setVersionSearchQuery(e.target.value)}
                        disabled={converting}
                        style={{ paddingRight: '2.5rem', margin: 0, width: '100%' }}
                      />
                      {versionSearchQuery && (
                        <button
                          onClick={() => setVersionSearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '0.5rem',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            padding: '0.25rem'
                          }}
                        >
                          <Icon name="close" size={16} />
                        </button>
                      )}
                    </div>
                    
                    <label className="toggle-switch-label" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        className="toggle-switch-input"
                        checked={showPreviewVersions}
                        onChange={(e) => setShowPreviewVersions(e.target.checked)}
                      />
                      <span className="toggle-switch-slider"></span>
                      <span className="toggle-switch-text">显示预览版</span>
                    </label>
                  </div>
                  
                  <div className="custom-select-container" ref={dropdownRef}>
                    <div
                      className={`custom-select-trigger ${showVersionDropdown ? 'open' : ''} ${converting ? 'disabled' : ''}`}
                      onClick={() => !converting && setShowVersionDropdown(!showVersionDropdown)}
                    >
                      <span className={selectedTargetVersion ? 'selected-value' : 'placeholder'}>
                        {selectedTargetVersion
                          ? (() => {
                              const v = availableVersions.find(v => v[1] === selectedTargetVersion);
                              return v ? (
                                <span className="selected-content">
                                  <span className="selected-version">{v[1]}</span>
                                  <span className="selected-format">pack_format: {v[0]}</span>
                                </span>
                              ) : selectedTargetVersion;
                            })()
                          : '-- 请选择目标版本 --'
                        }
                      </span>
                      <Icon name="chevron-down" size={20} className={`arrow-icon ${showVersionDropdown ? 'open' : ''}`} />
                    </div>
                    
                    {showVersionDropdown && (
                      <div className="custom-select-options">
                        {filteredVersions.length > 0 ? (
                          filteredVersions.map(([packFormat, displayVersion, rawVersions]) => (
                            <div
                              key={packFormat}
                              className={`custom-option ${displayVersion === selectedTargetVersion ? 'selected' : ''}`}
                              onClick={() => {
                                setSelectedTargetVersion(displayVersion);
                                setShowVersionDropdown(false);
                              }}
                            >
                              <div className="option-content">
                                <span className="version-name">{displayVersion}</span>
                                <span className="pack-format-badge">format: {packFormat}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="no-options">未找到匹配的版本</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="setting-item">
                  <label className="setting-label">输出路径</label>
                  <div className="output-path-container">
                    <input
                      type="text"
                      className="output-path-input"
                      value={outputPath}
                      readOnly
                      placeholder="点击右侧按钮选择输出文件夹"
                    />
                    <button
                      className="select-path-btn"
                      onClick={handleSelectOutputPath}
                      disabled={converting}
                    >
                      <Icon name="folder" size={20} />
                      浏览
                    </button>
                  </div>
                  {sameDirectoryWarning && (
                    <div className="warning-message" style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      backgroundColor: 'rgba(255, 193, 7, 0.15)',
                      border: '1px solid rgba(255, 193, 7, 0.5)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      whiteSpace: 'pre-line'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <Icon name="warning" size={20} color="#ffc107" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>{sameDirectoryWarning}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="setting-item">
                  <label className="setting-label">输出文件名</label>
                  <input
                    type="text"
                    className="output-filename-input"
                    value={outputFileName}
                    onChange={(e) => setOutputFileName(e.target.value)}
                    placeholder="例如: my_pack.zip 或 my_pack（文件夹）"
                    disabled={converting}
                  />
                  <div className="filename-hint">
                    提示：以 .zip 结尾将输出为压缩包，否则输出为文件夹
                  </div>
                </div>
                
                <button
                  className="convert-btn"
                  onClick={handleConvert}
                  disabled={!selectedTargetVersion || !outputPath || converting}
                >
                  {converting ? '转换中...' : '开始转换'}
                </button>

                {conversionSuccess && (
                  <div className="success-message">
                    转换成功！
                  </div>
                )}
              </div>

              <button className="reset-btn" onClick={() => {
                setSelectedPath('');
                setPackMetadata(null);
                setCurrentVersion('未知版本');
                setSupportedVersionRange('');
                setDescription('');
                setSelectedTargetVersion('');
                setOutputPath('');
                setConversionSuccess(false);
                setError(null);
              }}>
                重新选择
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-message">
              <div className="spinner"></div>
              <span>正在分析资源包...</span>
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <Icon name="report-issue" size={20} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </>
  );
};

export default VersionConverterModal;