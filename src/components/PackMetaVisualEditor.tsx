import { useState, useEffect } from 'react';
import { getAllPackFormatsWithReleases, getVersionRange, getVersionsWithType } from '../utils/version-map';

interface PackMetaVisualEditorProps {
  initialData: any;
  onApply: (data: any) => void;
  onCancel: () => void;
}

const MINECRAFT_COLORS: { [key: string]: string } = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
  'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF',
};

const parseMinecraftText = (text: string): React.ReactElement[] => {
  if (typeof text !== 'string') {
    return [<span key="0">{String(text)}</span>];
  }

  const parts: React.ReactElement[] = [];
  let currentIndex = 0;
  let currentColor = '#FFFFFF';
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrikethrough = false;

  const regex = /§([0-9a-fklmnor])/gi;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index);
      parts.push(
        <span
          key={currentIndex++}
          style={{
            color: currentColor,
            fontWeight: isBold ? 'bold' : 'normal',
            fontStyle: isItalic ? 'italic' : 'normal',
            textDecoration: `${isUnderline ? 'underline' : ''} ${isStrikethrough ? 'line-through' : ''}`.trim() || 'none',
          }}
        >
          {textBefore}
        </span>
      );
    }

    const code = match[1].toLowerCase();
    
    if (MINECRAFT_COLORS[code]) {
      currentColor = MINECRAFT_COLORS[code];
    } else if (code === 'l') {
      isBold = true;
    } else if (code === 'o') {
      isItalic = true;
    } else if (code === 'n') {
      isUnderline = true;
    } else if (code === 'm') {
      isStrikethrough = true;
    } else if (code === 'r') {
      currentColor = '#FFFFFF';
      isBold = false;
      isItalic = false;
      isUnderline = false;
      isStrikethrough = false;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    parts.push(
      <span
        key={currentIndex++}
        style={{
          color: currentColor,
          fontWeight: isBold ? 'bold' : 'normal',
          fontStyle: isItalic ? 'italic' : 'normal',
          textDecoration: `${isUnderline ? 'underline' : ''} ${isStrikethrough ? 'line-through' : ''}`.trim() || 'none',
        }}
      >
        {remainingText}
      </span>
    );
  }

  return parts.length > 0 ? parts : [<span key="0">{text}</span>];
};

// 颜色列表
const COLOR_OPTIONS = [
  { code: '0', color: '#000000', name: '黑色' },
  { code: '1', color: '#0000AA', name: '深蓝' },
  { code: '2', color: '#00AA00', name: '深绿' },
  { code: '3', color: '#00AAAA', name: '深青' },
  { code: '4', color: '#AA0000', name: '深红' },
  { code: '5', color: '#AA00AA', name: '深紫' },
  { code: '6', color: '#FFAA00', name: '金色' },
  { code: '7', color: '#AAAAAA', name: '灰色' },
  { code: '8', color: '#555555', name: '深灰' },
  { code: '9', color: '#5555FF', name: '蓝色' },
  { code: 'a', color: '#55FF55', name: '绿色' },
  { code: 'b', color: '#55FFFF', name: '青色' },
  { code: 'c', color: '#FF5555', name: '红色' },
  { code: 'd', color: '#FF55FF', name: '紫色' },
  { code: 'e', color: '#FFFF55', name: '黄色' },
  { code: 'f', color: '#FFFFFF', name: '白色' },
];

// 格式
const FORMAT_OPTIONS = [
  { code: 'l', name: '粗体', icon: 'l' },
  { code: 'o', name: '斜体', icon: 'o' },
  { code: 'n', name: '下划线', icon: 'n' },
  { code: 'm', name: '删除线', icon: 'm' },
  { code: 'r', name: '重置', icon: 'r' },
];

type VersionMode = 'legacy' | 'supported' | 'new';

export default function PackMetaVisualEditor({ initialData, onApply, onCancel }: PackMetaVisualEditorProps) {
  // 版本控制
  const [versionMode, setVersionMode] = useState<VersionMode>('legacy');
  
  // 传统
  const [packFormat, setPackFormat] = useState<number>(initialData?.pack?.pack_format || 34);
  
  // 多版本兼容
  const [supportedMin, setSupportedMin] = useState<number>(13);
  const [supportedMax, setSupportedMax] = useState<number>(34);
  const [supportedList, setSupportedList] = useState<string>('13,14,15');
  const [supportedMode, setSupportedMode] = useState<'range' | 'list'>('range');
  
  // 新版
  const [minFormatMajor, setMinFormatMajor] = useState<number>(69);
  const [minFormatMinor, setMinFormatMinor] = useState<number>(0);
  const [maxFormatMajor, setMaxFormatMajor] = useState<number>(69);
  const [maxFormatMinor, setMaxFormatMinor] = useState<number>(10);
  const [newModeHasPackFormat, setNewModeHasPackFormat] = useState<boolean>(false);
  
  const [description, setDescription] = useState<string>(
    typeof initialData?.pack?.description === 'string'
      ? initialData.pack.description
      : (typeof initialData?.pack?.description === 'object' && initialData?.pack?.description !== null
          ? JSON.stringify(initialData.pack.description)
          : '')
  );
  const [versionRange, setVersionRange] = useState<string>('加载中...');
  const [allFormats, setAllFormats] = useState<Array<[number, string]>>([]);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [allVersionsList, setAllVersionsList] = useState<{ releases: string[]; previews: string[]; all: string[] }>({
    releases: [],
    previews: [],
    all: []
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showModeHelp, setShowModeHelp] = useState(false);
  const textareaRef = useState<HTMLTextAreaElement | null>(null);
  
  // 语言配置
  const [languages, setLanguages] = useState<{ [key: string]: { name: string; region: string; bidirectional: boolean } }>({});
  
  // 过滤器配置
  const [filterRules, setFilterRules] = useState<Array<{ namespace: string; path: string }>>([]);
  
  // 覆盖层配置
  const [overlays, setOverlays] = useState<Array<any>>([]);

  useEffect(() => {
    loadVersionData();
    parseInitialData();
  }, []);

  useEffect(() => {
    if (versionMode === 'legacy') {
      updateVersionRange();
    }
  }, [packFormat, versionMode]);

  const parseInitialData = () => {
    if (!initialData) return;
    
    // 检测版本模式
    if (initialData.pack) {
      if (initialData.pack.min_format) {
        setVersionMode('new');
        const minFmt = Array.isArray(initialData.pack.min_format) ? initialData.pack.min_format : [69, 0];
        setMinFormatMajor(minFmt[0] || 69);
        setMinFormatMinor(minFmt[1] || 0);
        
        if (initialData.pack.max_format) {
          const maxFmt = Array.isArray(initialData.pack.max_format) ? initialData.pack.max_format : [69, 10];
          setMaxFormatMajor(maxFmt[0] || 69);
          setMaxFormatMinor(maxFmt[1] || 10);
        }
        
        if (initialData.pack.pack_format) {
          setNewModeHasPackFormat(true);
        }
      } else if (initialData.pack.supported_formats) {
        setVersionMode('supported');
        const sf = initialData.pack.supported_formats;
        
        if (Array.isArray(sf)) {
          setSupportedMode('list');
          setSupportedList(sf.join(','));
        } else if (sf.min_inclusive !== undefined && sf.max_inclusive !== undefined) {
          setSupportedMode('range');
          setSupportedMin(sf.min_inclusive);
          setSupportedMax(sf.max_inclusive);
        }
      } else {
        setVersionMode('legacy');
      }
    }
    
    // 解析语言
    if (initialData.language) {
      setLanguages(initialData.language);
    }
    
    // 解析过滤器
    if (initialData.filter?.block) {
      setFilterRules(initialData.filter.block);
    }
    
    // 解析覆盖层
    if (initialData.overlays?.entries) {
      setOverlays(initialData.overlays.entries);
    }
  };

  const loadVersionData = async () => {
    try {
      const formats = await getAllPackFormatsWithReleases();
      setAllFormats(formats);
    } catch (error) {
      console.error('加载版本数据失败:', error);
    }
  };

  const updateVersionRange = async () => {
    try {
      const range = await getVersionRange(packFormat);
      setVersionRange(range);
      
      const versions = await getVersionsWithType(packFormat);
      setAllVersionsList(versions);
    } catch (error) {
      console.error('获取版本范围失败:', error);
      setVersionRange('未知');
    }
  };

  const handleApply = () => {
    const newData: any = {
      pack: {
        description: description
      }
    };
    
    // 根据版本模式设置不同的字段
    if (versionMode === 'legacy') {
      newData.pack.pack_format = packFormat;
    } else if (versionMode === 'supported') {
      newData.pack.pack_format = packFormat;
      
      if (supportedMode === 'range') {
        newData.pack.supported_formats = {
          min_inclusive: supportedMin,
          max_inclusive: supportedMax
        };
      } else {
        const formats = supportedList.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
        newData.pack.supported_formats = formats;
      }
    } else if (versionMode === 'new') {
      newData.pack.min_format = [minFormatMajor, minFormatMinor];
      newData.pack.max_format = [maxFormatMajor, maxFormatMinor];
      if (newModeHasPackFormat) {
        newData.pack.pack_format = packFormat;
      }
    }
    
    // 添加语言配置
    if (Object.keys(languages).length > 0) {
      newData.language = languages;
    }
    
    // 添加过滤器
    if (filterRules.length > 0) {
      newData.filter = {
        block: filterRules
      };
    }
    
    // 添加覆盖层
    if (overlays.length > 0) {
      newData.overlays = {
        entries: overlays
      };
    }
    
    onApply(newData);
  };
  
  // 语言管理函数
  const addLanguage = () => {
    const code = prompt('输入语言代码（如 zh_cn, en_us, zh_meme）:');
    if (!code) return;
    
    if (languages[code]) {
      alert('该语言代码已存在！');
      return;
    }
    
    setLanguages({
      ...languages,
      [code]: {
        name: '新语言',
        region: '地区',
        bidirectional: false
      }
    });
  };

  const updateLanguage = (code: string, field: 'name' | 'region' | 'bidirectional', value: string | boolean) => {
    setLanguages({
      ...languages,
      [code]: {
        ...languages[code],
        [field]: value
      }
    });
  };

  const deleteLanguage = (code: string) => {
    const newLangs = { ...languages };
    delete newLangs[code];
    setLanguages(newLangs);
  };

  // 过滤器管理函数
  const addFilterRule = () => {
    setFilterRules([...filterRules, { namespace: 'minecraft', path: '' }]);
  };

  const updateFilterRule = (index: number, field: 'namespace' | 'path', value: string) => {
    const newRules = [...filterRules];
    newRules[index] = { ...newRules[index], [field]: value };
    setFilterRules(newRules);
  };

  const deleteFilterRule = (index: number) => {
    setFilterRules(filterRules.filter((_, i) => i !== index));
  };

  // 覆盖层管理函数
  const addOverlay = () => {
    setOverlays([...overlays, { directory: 'overlay_new', formats: packFormat }]);
  };

  const updateOverlay = (index: number, field: string, value: any) => {
    const newOverlays = [...overlays];
    newOverlays[index] = { ...newOverlays[index], [field]: value };
    setOverlays(newOverlays);
  };

  const deleteOverlay = (index: number) => {
    setOverlays(overlays.filter((_, i) => i !== index));
  };

  const insertColorCode = (code: string) => {
    const textarea = textareaRef[0];
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = description.substring(0, start) + `§${code}` + description.substring(end);
    setDescription(newText);

    // 设置光标位置
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }, 0);
  };

  const insertFormatCode = (code: string) => {
    insertColorCode(code);
  };

  return (
    <div className="visual-editor-content">
      <div className="editor-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 className="editor-section-title" style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>版本控制</h4>
          <button
            type="button"
            onClick={() => setShowModeHelp(!showModeHelp)}
            style={{
              padding: '0.25rem 0.5rem',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.75rem',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.color = 'var(--accent-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {showModeHelp ? '隐藏' : '显示'}说明
          </button>
        </div>

        {/* 说明文档 */}
        <div className={`version-list-panel ${showModeHelp ? 'open' : ''}`} style={{
          marginBottom: showModeHelp ? '1rem' : '0',
          padding: showModeHelp ? '1rem' : '0 1rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px'
        }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <p style={{ margin: '0 0 0.75rem 0', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              版本控制模式说明
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>传统模式</strong>：使用单一的 <code style={{ background: 'var(--bg-primary)', padding: '0.125rem 0.25rem', borderRadius: '3px' }}>pack_format</code>，适用于所有 Minecraft 版本
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>多版本兼容模式</strong>：使用 <code style={{ background: 'var(--bg-primary)', padding: '0.125rem 0.25rem', borderRadius: '3px' }}>supported_formats</code>，让资源包支持多个格式版本（1.20-1.21.5）
                <br />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  注意：使用此模式会禁用 1.21.9+ 的新版格式控制
                </span>
              </li>
              <li>
                <strong>新版模式</strong>：使用 <code style={{ background: 'var(--bg-primary)', padding: '0.125rem 0.25rem', borderRadius: '3px' }}>min_format</code> 和 <code style={{ background: 'var(--bg-primary)', padding: '0.125rem 0.25rem', borderRadius: '3px' }}>max_format</code>，支持次版本号控制（仅 1.21.9+）
                <br />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 16v-4"></path>
                    <path d="M12 8h.01"></path>
                  </svg>
                  格式：[主版本, 次版本]，如 [69, 0] = 1.21.9
                </span>
              </li>
            </ul>
          </div>
        </div>
        
        {/* 版本模式选择 */}
        <div className="editor-field">
          <label className="editor-field-label">选择版本控制模式</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.75rem',
              background: versionMode === 'legacy' ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              border: `1px solid ${versionMode === 'legacy' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="radio"
                name="versionMode"
                value="legacy"
                checked={versionMode === 'legacy'}
                onChange={(e) => setVersionMode(e.target.value as VersionMode)}
                style={{ marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>传统模式</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>使用 pack_format（适用于所有版本）</div>
              </div>
            </label>
            
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.75rem',
              background: versionMode === 'supported' ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              border: `1px solid ${versionMode === 'supported' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="radio"
                name="versionMode"
                value="supported"
                checked={versionMode === 'supported'}
                onChange={(e) => setVersionMode(e.target.value as VersionMode)}
                style={{ marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>多版本兼容模式</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>使用 supported_formats（1.20-1.21.5）</div>
              </div>
            </label>
            
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.75rem',
              background: versionMode === 'new' ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              border: `1px solid ${versionMode === 'new' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="radio"
                name="versionMode"
                value="new"
                checked={versionMode === 'new'}
                onChange={(e) => setVersionMode(e.target.value as VersionMode)}
                style={{ marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>新版模式</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>使用 min/max_format（1.21.9+）</div>
              </div>
            </label>
          </div>
        </div>

        {/* 传统模式配置 */}
        {versionMode === 'legacy' && (
          <div className="editor-field">
            <label className="editor-field-label">格式版本 (pack_format)</label>
            <select
              className="editor-field-input"
              value={packFormat}
              onChange={(e) => setPackFormat(parseInt(e.target.value))}
              style={{ marginBottom: '0.75rem' }}
            >
              {allFormats.map(([format, range]) => (
                <option key={format} value={format}>
                  格式 {format} - {range}
                </option>
              ))}
            </select>
            
            <div className="version-range-display">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                兼容版本: {allVersionsList.all.length > 0
                  ? (allVersionsList.all.length === 1
                      ? allVersionsList.all[0]
                      : `${allVersionsList.all[allVersionsList.all.length - 1]} - ${allVersionsList.all[0]}`)
                  : versionRange}
                {allVersionsList.all.length > 0 && (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>
                    (共 {allVersionsList.all.length} 个版本)
                  </span>
                )}
              </span>
              {allVersionsList.all.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllVersions(!showAllVersions)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.color = 'var(--accent-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {showAllVersions ? '隐藏' : '查看'}所有版本
                </button>
              )}
            </div>
          </div>
          
          <div className={`version-list-panel ${showAllVersions ? 'open' : ''}`} style={{
            marginTop: showAllVersions ? '0.75rem' : '0',
            padding: showAllVersions ? '1rem' : '0 1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px'
          }}>
            {allVersionsList.releases.length > 0 && (
              <div style={{ marginBottom: allVersionsList.previews.length > 0 ? '1rem' : '0' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  正式版 ({allVersionsList.releases.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '120px', overflow: 'auto' }}>
                  {allVersionsList.releases.map(v => (
                    <span key={v} style={{
                      padding: '0.25rem 0.5rem',
                      background: 'var(--bg-primary)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      whiteSpace: 'nowrap',
                      border: '1px solid var(--border-color)'
                    }}>
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {allVersionsList.previews.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  预览版 ({allVersionsList.previews.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '120px', overflow: 'auto' }}>
                  {allVersionsList.previews.map(v => (
                    <span key={v} style={{
                      padding: '0.25rem 0.5rem',
                      background: 'var(--bg-primary)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      opacity: 0.7,
                      whiteSpace: 'nowrap',
                      border: '1px solid var(--border-color)'
                    }}>
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        {/* 多版本兼容模式配置 */}
        {versionMode === 'supported' && (
          <div className="editor-field">
            <label className="editor-field-label">主格式版本</label>
            <select
              className="editor-field-input"
              value={packFormat}
              onChange={(e) => setPackFormat(parseInt(e.target.value))}
              style={{ marginBottom: '1rem' }}
            >
              {allFormats.map(([format, range]) => (
                <option key={format} value={format}>
                  格式 {format} - {range}
                </option>
              ))}
            </select>
            
            <label className="editor-field-label">支持的格式版本</label>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={supportedMode === 'range'}
                  onChange={() => setSupportedMode('range')}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>范围模式</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={supportedMode === 'list'}
                  onChange={() => setSupportedMode('list')}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>列表模式</span>
              </label>
            </div>
            
            {supportedMode === 'range' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    最小版本
                  </label>
                  <select
                    className="editor-field-input"
                    value={supportedMin}
                    onChange={(e) => setSupportedMin(parseInt(e.target.value))}
                  >
                    {allFormats.map(([format]) => (
                      <option key={format} value={format}>
                        格式 {format}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    最大版本
                  </label>
                  <select
                    className="editor-field-input"
                    value={supportedMax}
                    onChange={(e) => setSupportedMax(parseInt(e.target.value))}
                  >
                    {allFormats.map(([format]) => (
                      <option key={format} value={format}>
                        格式 {format}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  className="editor-field-input"
                  placeholder="输入版本号，用逗号分隔，如: 13,14,15"
                  value={supportedList}
                  onChange={(e) => setSupportedList(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                  示例：13,14,15 或 9,10,11,12
                </div>
              </div>
            )}
            
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '6px',
              fontSize: '0.75rem',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '0.125rem' }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <span>警告：使用 supported_formats 会禁用 1.21.9+ 的新版 min/max_format 系统</span>
            </div>
          </div>
        )}

        {/* 新版模式配置 */}
        {versionMode === 'new' && (
          <div className="editor-field">
            <label className="editor-field-label">最小格式版本 (min_format)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  主版本
                </label>
                <select
                  className="editor-field-input"
                  value={minFormatMajor}
                  onChange={(e) => setMinFormatMajor(parseInt(e.target.value))}
                >
                  {allFormats.map(([format]) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  次版本
                </label>
                <input
                  type="number"
                  className="editor-field-input"
                  value={minFormatMinor}
                  onChange={(e) => setMinFormatMinor(parseInt(e.target.value) || 0)}
                  min="0"
                  placeholder="0"
                />
              </div>
            </div>
            
            <label className="editor-field-label">最大格式版本 (max_format)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  主版本
                </label>
                <select
                  className="editor-field-input"
                  value={maxFormatMajor}
                  onChange={(e) => setMaxFormatMajor(parseInt(e.target.value))}
                >
                  {allFormats.map(([format]) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  次版本
                </label>
                <input
                  type="number"
                  className="editor-field-input"
                  value={maxFormatMinor}
                  onChange={(e) => setMaxFormatMinor(parseInt(e.target.value) || 0)}
                  min="0"
                  placeholder="0"
                />
              </div>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newModeHasPackFormat}
                  onChange={(e) => setNewModeHasPackFormat(e.target.checked)}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>同时包含 pack_format（可选，用于向后兼容）</span>
              </label>
            </div>
            
            {newModeHasPackFormat && (
              <div>
                <label className="editor-field-label">pack_format（可选）</label>
                <select
                  className="editor-field-input"
                  value={packFormat}
                  onChange={(e) => setPackFormat(parseInt(e.target.value))}
                >
                  {allFormats.map(([format, range]) => (
                    <option key={format} value={format}>
                      格式 {format} - {range}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '6px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.5'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4"></path>
                  <path d="M12 8h.01"></path>
                </svg>
                格式说明
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li>[69, 0] = Minecraft 1.21.9</li>
                <li>[70, 0] = Minecraft 1.21.10</li>
                <li>次版本号用于在不改变主版本的情况下进行小幅更新</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="editor-section">
        <h4 className="editor-section-title">资源包描述</h4>
        
        <div className="editor-field">
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className="color-picker-toggle"
              onClick={() => setShowColorPicker(!showColorPicker)}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
              </svg>
              {showColorPicker ? '隐藏' : '显示'}颜色和格式选择器
            </button>
          </div>

          <div className={`color-picker-panel ${showColorPicker ? 'open' : ''}`} style={{
            padding: showColorPicker ? '1rem' : '0 1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            marginBottom: showColorPicker ? '0.75rem' : '0'
          }}>
            <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  颜色
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {COLOR_OPTIONS.map(({ code, color, name }) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => insertColorCode(code)}
                      title={`${name} (§${code})`}
                      style={{
                        width: '36px',
                        height: '36px',
                        background: color,
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: color === '#000000' ? 'inset 0 0 0 1px rgba(255,255,255,0.2)' : 'none'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.1)';
                        e.currentTarget.style.borderColor = 'var(--accent-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}
                    />
                  ))}
              </div>
            </div>

            <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  格式
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {FORMAT_OPTIONS.map(({ code, name, icon }) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => insertFormatCode(code)}
                      title={`${name} (§${code})`}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        transition: 'all 0.2s',
                        fontFamily: 'monospace'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-tertiary)';
                        e.currentTarget.style.borderColor = 'var(--accent-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--bg-primary)';
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}
                    >
                      &{icon}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          <textarea
            ref={(el) => { textareaRef[0] = el; }}
            className="editor-field-input editor-field-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="输入资源包描述..."
          />
          <div className="description-preview">
            <div className="description-preview-label">预览</div>
            <div style={{
              padding: '1rem',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '4px',
              minHeight: '60px',
              display: 'flex',
              alignItems: 'center',
              fontFamily: "'Minecraft', 'Consolas', 'Monaco', 'Courier New', monospace",
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              <div className="minecraft-text">
                {parseMinecraftText(description)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 语言配置 */}
      <div className="editor-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 className="editor-section-title" style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>语言配置</h4>
          <button
            type="button"
            onClick={addLanguage}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent-primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            添加语言
          </button>
        </div>

        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.6' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '0.125rem' }}>
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <span>在客户端动态注册新的语言选项，需同时在 assets/minecraft/lang/ 提供对应的语言文件</span>
          </p>
        </div>

        {Object.keys(languages).length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            border: '1px dashed var(--border-color)'
          }}>
            暂无语言配置，点击"添加语言"按钮开始配置
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {Object.entries(languages).map(([code, lang]) => (
              <div key={code} style={{
                padding: '1rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{code}</div>
                  <button
                    type="button"
                    onClick={() => deleteLanguage(code)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem'
                    }}
                  >
                    删除
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      显示名称
                    </label>
                    <input
                      type="text"
                      className="editor-field-input"
                      value={lang.name}
                      onChange={(e) => updateLanguage(code, 'name', e.target.value)}
                      placeholder="简体中文"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      地区
                    </label>
                    <input
                      type="text"
                      className="editor-field-input"
                      value={lang.region}
                      onChange={(e) => updateLanguage(code, 'region', e.target.value)}
                      placeholder="中国"
                    />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={lang.bidirectional}
                    onChange={(e) => updateLanguage(code, 'bidirectional', e.target.checked)}
                  />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>双向文本（如阿拉伯语、希伯来语）</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 资源过滤器 */}
      <div className="editor-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 className="editor-section-title" style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>资源过滤器</h4>
          <button
            type="button"
            onClick={addFilterRule}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent-primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            添加规则
          </button>
        </div>

        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.6' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '0.125rem' }}>
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <span>选择性隐藏下层包的文件（1.19+），仅对加载顺序靠前的包生效。路径支持正则表达式</span>
          </p>
        </div>

        {filterRules.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            border: '1px dashed var(--border-color)'
          }}>
            暂无过滤规则，点击"添加规则"按钮开始配置
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filterRules.map((rule, index) => (
              <div key={index} style={{
                padding: '1rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>规则 #{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => deleteFilterRule(index)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem'
                    }}
                  >
                    删除
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      命名空间
                    </label>
                    <input
                      type="text"
                      className="editor-field-input"
                      value={rule.namespace}
                      onChange={(e) => updateFilterRule(index, 'namespace', e.target.value)}
                      placeholder="minecraft"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      路径（支持正则）
                    </label>
                    <input
                      type="text"
                      className="editor-field-input"
                      value={rule.path}
                      onChange={(e) => updateFilterRule(index, 'path', e.target.value)}
                      placeholder="recipes/.*"
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 覆盖层配置 */}
      <div className="editor-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 className="editor-section-title" style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>覆盖层配置</h4>
          <button
            type="button"
            onClick={addOverlay}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent-primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            添加覆盖层
          </button>
        </div>

        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.6' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '0.125rem' }}>
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <span>为特定版本条件提供增量资源，覆盖基础包内容，避免重复文件</span>
          </p>
        </div>

        {overlays.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            border: '1px dashed var(--border-color)'
          }}>
            暂无覆盖层配置，点击"添加覆盖层"按钮开始配置
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {overlays.map((overlay, index) => (
              <div key={index} style={{
                padding: '1rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>覆盖层 #{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => deleteOverlay(index)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.75rem'
                    }}
                  >
                    删除
                  </button>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    目录名
                  </label>
                  <input
                    type="text"
                    className="editor-field-input"
                    value={overlay.directory}
                    onChange={(e) => updateOverlay(index, 'directory', e.target.value)}
                    placeholder="overlay_1_21_10"
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    适用格式版本
                  </label>
                  <select
                    className="editor-field-input"
                    value={typeof overlay.formats === 'number' ? overlay.formats : packFormat}
                    onChange={(e) => updateOverlay(index, 'formats', parseInt(e.target.value))}
                  >
                    {allFormats.map(([format, range]) => (
                      <option key={format} value={format}>
                        格式 {format} - {range}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="editor-actions-footer">
        <button className="editor-action-btn cancel" onClick={onCancel}>
          取消
        </button>
        <button className="editor-action-btn apply" onClick={handleApply}>
          应用更改
        </button>
      </div>
    </div>
  );
}