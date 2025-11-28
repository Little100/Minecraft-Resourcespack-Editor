import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import "./PackMetaEditor.css";
import SyntaxHighlighter from "./SyntaxHighlighter";
import { writeFileContent } from "../utils/tauri-api";

interface PackMetaEditorProps {
  content: string;
  filePath: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
}

// 颜色代码映射
const MINECRAFT_COLORS: { [key: string]: string } = {
  '0': '#000000', // 黑色
  '1': '#0000AA', // 深蓝色
  '2': '#00AA00', // 深绿色
  '3': '#00AAAA', // 深青色
  '4': '#AA0000', // 深红色
  '5': '#AA00AA', // 深紫色
  '6': '#FFAA00', // 金色
  '7': '#AAAAAA', // 灰色
  '8': '#555555', // 深灰色
  '9': '#5555FF', // 蓝色
  'a': '#55FF55', // 绿色
  'b': '#55FFFF', // 青色
  'c': '#FF5555', // 红色
  'd': '#FF55FF', // 紫色
  'e': '#FFFF55', // 黄色
  'f': '#FFFFFF', // 白色
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
    } else if (code === 'k') {}

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

interface ContextMenu {
  x: number;
  y: number;
  hasSelection: boolean;
}

export default function PackMetaEditor({ content, filePath, onChange, onSave }: PackMetaEditorProps) {
  const [text, setText] = useState(content);
  const [viewMode, setViewMode] = useState<'split' | 'source' | 'preview'>('split');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<any>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [persistedHistory, setPersistedHistory] = useState<any[]>([]);
  const [fontSize, setFontSize] = useState(13);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const originalContent = useRef(content);

  useEffect(() => {
    setText(content);
    tryParseJSON(content);
    originalContent.current = content;
    setHistory([content]);
    setHistoryIndex(0);
    setIsDirty(false);
  }, [filePath]);

  useEffect(() => {
    loadHistoryFromBackend();
  }, [filePath]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setFontSize(prev => {
          const delta = e.deltaY > 0 ? -1 : 1;
          const newSize = prev + delta;
          return Math.max(8, Math.min(32, newSize));
        });
      }
    };

    const container = editorContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, []);

  const tryParseJSON = (jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      setParsedData(parsed);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析错误');
      setParsedData(null);
    }
  };

  const addToHistory = (newText: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newText);
    if (newHistory.length > 100) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    setHistory(newHistory);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    tryParseJSON(newText);
    setIsDirty(newText !== originalContent.current);
    addToHistory(newText);
    if (onChange) {
      onChange(newText);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
  };

  const saveHistoryToBackend = async () => {
    const historyEnabled = localStorage.getItem('historyEnabled') === 'true';
    if (!historyEnabled) return;
    
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const maxCount = parseInt(localStorage.getItem('maxHistoryCount') || '30');
      
      await invoke('save_file_history', {
        packDir,
        filePath: filePath,
        content: text,
        fileType: 'text',
        maxCount
      });
    } catch (error) {
      console.error('保存历史记录失败:', error);
    }
  };

  // 从后端加载历史记录
  const loadHistoryFromBackend = async () => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      const entries = await invoke<any[]>('load_file_history', {
        packDir,
        filePath: filePath
      });
      setPersistedHistory(entries);
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
  };

  // 显示历史记录对话框
  const showHistoryDialog = () => {
    loadHistoryFromBackend();
    setShowHistoryList(true);
  };

  // 恢复历史记录
  const restoreFromHistory = (entry: any) => {
    setText(entry.content);
    tryParseJSON(entry.content);
    const isDifferent = entry.content !== originalContent.current;
    setIsDirty(isDifferent);
    addToHistory(entry.content);
    if (onChange) {
      onChange(entry.content);
    }
    setShowHistoryList(false);
  };

  // 删除历史记录
  const deleteHistoryEntry = async (entry: any) => {
    try {
      const packDir = await invoke<string>('get_current_pack_path');
      await invoke('delete_file_history', {
        packDir,
        filePath: filePath,
        timestamp: entry.timestamp
      });
      // 重新加载历史记录
      await loadHistoryFromBackend();
    } catch (error) {
      console.error('删除历史记录失败:', error);
      alert('删除失败');
    }
  };

  const handleSave = async () => {
    if (isDirty) {
      try {
        await writeFileContent(filePath, text);
        
        originalContent.current = text;
        setIsDirty(false);
        
        if (onSave) {
          onSave();
        }
        
        // 保存历史记录
        await saveHistoryToBackend();
      } catch (error) {
        console.error('保存文件失败:', error);
        alert(`保存文件失败: ${error}`);
      }
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newText = history[newIndex];
      setText(newText);
      tryParseJSON(newText);
      setHistoryIndex(newIndex);
      setIsDirty(newText !== originalContent.current);
      if (onChange) {
        onChange(newText);
      }
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const newText = history[newIndex];
      setText(newText);
      tryParseJSON(newText);
      setHistoryIndex(newIndex);
      setIsDirty(newText !== originalContent.current);
      if (onChange) {
        onChange(newText);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;

    // Ctrl+S 保存
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    // Ctrl+Z 撤销
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }

    // Ctrl+Y 或 Ctrl+Shift+Z 重做
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Tab键处理
    if (e.key === 'Tab') {
      e.preventDefault();
      const beforeCursor = value.substring(0, selectionStart);
      const afterCursor = value.substring(selectionEnd);
      
      if (e.shiftKey) {
        const lines = beforeCursor.split('\n');
        const currentLine = lines[lines.length - 1];
        if (currentLine.startsWith('  ')) {
          lines[lines.length - 1] = currentLine.substring(2);
          const newText = lines.join('\n') + afterCursor;
          setText(newText);
          tryParseJSON(newText);
          setIsDirty(newText !== originalContent.current);
          addToHistory(newText);
          if (onChange) onChange(newText);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = selectionStart - 2;
          }, 0);
        }
      } else {
        const newText = beforeCursor + '  ' + afterCursor;
        setText(newText);
        tryParseJSON(newText);
        setIsDirty(newText !== originalContent.current);
        addToHistory(newText);
        if (onChange) onChange(newText);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
        }, 0);
      }
      return;
    }

    // Enter键自动缩进
    if (e.key === 'Enter') {
      e.preventDefault();
      const beforeCursor = value.substring(0, selectionStart);
      const afterCursor = value.substring(selectionEnd);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : '';
      
      const trimmedLine = currentLine.trim();
      let extraIndent = '';
      if (trimmedLine.endsWith('{') || trimmedLine.endsWith('[') || trimmedLine.endsWith('(')) {
        extraIndent = '  ';
      }
      
      const nextChar = afterCursor.charAt(0);
      let newText;
      let cursorOffset;
      
      if ((nextChar === '}' || nextChar === ']' || nextChar === ')') && extraIndent) {
        newText = beforeCursor + '\n' + currentIndent + extraIndent + '\n' + currentIndent + afterCursor;
        cursorOffset = selectionStart + 1 + currentIndent.length + extraIndent.length;
      } else {
        newText = beforeCursor + '\n' + currentIndent + extraIndent + afterCursor;
        cursorOffset = selectionStart + 1 + currentIndent.length + extraIndent.length;
      }
      
      setText(newText);
      tryParseJSON(newText);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) onChange(newText);
      
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = cursorOffset;
      }, 0);
      return;
    }
  };
  const formatJSON = () => {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      tryParseJSON(formatted);
      setIsDirty(true);
      addToHistory(formatted);
      if (onChange) {
        onChange(formatted);
      }
    } catch (err) {
      alert('JSON格式错误，无法格式化');
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;

    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200;
    const menuHeight = 150;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 10;
    }

    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 10;
    }

    setContextMenu({
      x,
      y,
      hasSelection
    });
  };

  const handleCopy = async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectedText = text.substring(textarea.selectionStart, textarea.selectionEnd);
    try {
      await navigator.clipboard.writeText(selectedText);
      setContextMenu(null);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  const handleCut = async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selectedText = text.substring(selectionStart, selectionEnd);
    
    try {
      await navigator.clipboard.writeText(selectedText);
      const newText = text.substring(0, selectionStart) + text.substring(selectionEnd);
      setText(newText);
      tryParseJSON(newText);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) {
        onChange(newText);
      }
      setContextMenu(null);
      
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart;
        textarea.focus();
      }, 0);
    } catch (err) {
      console.error('剪切失败:', err);
    }
  };

  const handlePaste = async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    try {
      const clipboardText = await navigator.clipboard.readText();
      const { selectionStart, selectionEnd } = textarea;
      const newText = text.substring(0, selectionStart) + clipboardText + text.substring(selectionEnd);
      
      setText(newText);
      tryParseJSON(newText);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) {
        onChange(newText);
      }
      setContextMenu(null);
      
      setTimeout(() => {
        const newPosition = selectionStart + clipboardText.length;
        textarea.selectionStart = textarea.selectionEnd = newPosition;
        textarea.focus();
      }, 0);
    } catch (err) {
      console.error('粘贴失败:', err);
    }
  };

  const renderPreview = () => {
    if (parseError) {
      return (
        <div className="preview-error">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>JSON 解析错误</p>
          <span className="error-message">{parseError}</span>
        </div>
      );
    }

    if (!parsedData) {
      return <div className="preview-empty">暂无预览</div>;
    }

    return (
      <div className="preview-content">
        <div className="preview-section">
          <h4>材质包信息</h4>
          {parsedData.pack && (
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">格式版本:</span>
                <span className="info-value">{parsedData.pack.pack_format}</span>
              </div>
              <div className="info-item">
                <span className="info-label">描述:</span>
                <div className="info-value minecraft-text">
                  {parseMinecraftText(parsedData.pack.description)}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="preview-section">
          <h4>完整数据</h4>
          <pre className="json-preview">{JSON.stringify(parsedData, null, 2)}</pre>
        </div>
      </div>
    );
  };

  const lineCount = text.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="packmeta-editor">
      <div className="packmeta-header">
        <div className="header-left">
          {isDirty && <span className="dirty-indicator">●</span>}
          <div className="view-controls">
            <button
              className={`view-btn ${viewMode === 'source' ? 'active' : ''}`}
              onClick={() => setViewMode('source')}
              title="仅源代码"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </button>
            <button
              className={`view-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="分栏视图"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="12" y1="3" x2="12" y2="21"></line>
              </svg>
            </button>
            <button
              className={`view-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
              title="仅预览"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button className="format-btn" onClick={formatJSON} title="格式化JSON">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 7 4 4 20 4 20 7"></polyline>
                <line x1="9" y1="20" x2="15" y2="20"></line>
                <line x1="12" y1="4" x2="12" y2="20"></line>
              </svg>
            </button>
          </div>
        </div>
        <div className="editor-actions">
          <button
            className="editor-btn"
            onClick={handleUndo}
            disabled={historyIndex === 0}
            title="撤销 (Ctrl+Z)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6"/>
              <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
            </svg>
          </button>
          <button
            className="editor-btn"
            onClick={handleRedo}
            disabled={historyIndex === history.length - 1}
            title="重做 (Ctrl+Y)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6"/>
              <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/>
            </svg>
          </button>
          <button
            className="editor-btn"
            onClick={showHistoryDialog}
            title="历史记录"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
          <button
            className="editor-btn save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            title="保存 (Ctrl+S)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={`packmeta-content view-${viewMode}`}>
        <div className="source-panel">
          <div className="editor-container" ref={editorContainerRef}>
            <div className="line-numbers" style={{
              fontSize: `${fontSize}px`,
              lineHeight: '1.5'
            }}>
              {lineNumbers.map((num) => (
                <div key={num} className="line-number" style={{
                  height: `${fontSize * 1.5}px`,
                  lineHeight: `${fontSize * 1.5}px`
                }}>
                  {num}
                </div>
              ))}
            </div>
            <div className="editor-content-wrapper" style={{ fontSize: `${fontSize}px` }}>
              <div className="indent-guides-container" style={{
                transform: `translate(-${scrollLeft}px, -${scrollTop}px)`,
                fontSize: `${fontSize}px`
              }}>
                {(() => {
                  const lines = text.split('\n');
                  const guides: React.ReactNode[] = [];
                  
                  const charWidth = fontSize * 0.6;
                  const lineHeight = fontSize * 1.5;
                  
                  lines.forEach((line, lineIndex) => {
                    if (line.trim().length === 0) return;
                    
                    const indentMatch = line.match(/^(\s*)/);
                    const indentLength = indentMatch ? indentMatch[1].length : 0;
                    const indentLevel = Math.floor(indentLength / 2);
                    
                    for (let i = 0; i < indentLevel; i++) {
                      guides.push(
                        <div
                          key={`${lineIndex}-${i}`}
                          className="indent-guide"
                          style={{
                            left: `${12 + i * 2 * charWidth}px`,
                            top: `${lineIndex * lineHeight}px`,
                            height: `${lineHeight}px`,
                            display: 'block'
                          }}
                        />
                      );
                    }
                  });
                  
                  return guides;
                })()}
              </div>
              <SyntaxHighlighter
                code={text}
                language="json"
                scrollTop={scrollTop}
                scrollLeft={scrollLeft}
              />
              <textarea
                ref={textareaRef}
                className="editor-textarea"
                name="pack-meta-editor"
                id="pack-meta-editor"
                value={text}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                onContextMenu={handleContextMenu}
                spellCheck={false}
                wrap="off"
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        <div className="preview-panel">
          {renderPreview()}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <div className="context-menu-item" onClick={formatJSON}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 7 4 4 20 4 20 7"></polyline>
              <line x1="9" y1="20" x2="15" y2="20"></line>
              <line x1="12" y1="4" x2="12" y2="20"></line>
            </svg>
            <span>格式化</span>
          </div>
          {contextMenu.hasSelection && (
            <>
              <div className="context-menu-item" onClick={handleCopy}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>复制</span>
                <span className="menu-shortcut">Ctrl+C</span>
              </div>
              <div className="context-menu-item" onClick={handleCut}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="6" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                  <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                  <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                </svg>
                <span>剪切</span>
                <span className="menu-shortcut">Ctrl+X</span>
              </div>
            </>
          )}
          <div className="context-menu-item" onClick={handlePaste}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            <span>粘贴</span>
            <span className="menu-shortcut">Ctrl+V</span>
          </div>
        </div>,
        document.body
      )}
      {/* 历史记录列表对话框 */}
      {showHistoryList && (
        <>
          <div className="modal-overlay" onClick={() => setShowHistoryList(false)} />
          <div className="history-list-dialog">
            <div className="dialog-header">
              <h3>历史记录</h3>
              <button className="dialog-close" onClick={() => setShowHistoryList(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="dialog-content">
              {persistedHistory.length === 0 ? (
                <div className="empty-history">
                  <p>暂无历史记录</p>
                </div>
              ) : (
                <div className="history-list">
                  {persistedHistory.map((entry, index) => (
                    <div key={index} className="history-item">
                      <div className="history-main">
                        <div className="history-info">
                          <span className="history-index">#{persistedHistory.length - index}</span>
                          <span className="history-time">
                            {new Date(entry.timestamp).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="history-actions">
                          <button
                            className="btn-restore"
                            onClick={() => restoreFromHistory(entry)}
                          >
                            恢复
                          </button>
                          <button
                            className="btn-delete"
                            onClick={() => deleteHistoryEntry(entry)}
                            title="删除此历史记录"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* 添加JSON内容预览 */}
                      <div className="history-preview">
                        <pre className="preview-code">
                          {entry.content.length > 300
                            ? entry.content.substring(0, 300) + '...'
                            : entry.content}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}