import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import "./TextEditor.css";
import CanvasSyntaxHighlighter from "./CanvasSyntaxHighlighter";
import { writeFileContent } from "../utils/tauri-api";

interface TextEditorProps {
  content: string;
  filePath: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  initialLine?: number;
}

interface ContextMenu {
  x: number;
  y: number;
  hasSelection: boolean;
}

export default function TextEditor({ content, filePath, onChange, onSave, readOnly = false, initialLine }: TextEditorProps) {
  const [text, setText] = useState(content);
  const [lineCount, setLineCount] = useState(1);
  const [isDirty, setIsDirty] = useState(false);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [persistedHistory, setPersistedHistory] = useState<any[]>([]);
  const [fontSize, setFontSize] = useState(13);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const originalContent = useRef(content);
  
  // 检测文件类型
  const isJSON = filePath.toLowerCase().endsWith('.json') || filePath.toLowerCase().endsWith('.mcmeta');

  useEffect(() => {
    setText(content);
    setLineCount(content.split('\n').length);
    originalContent.current = content;
    setHistory([content]);
    setHistoryIndex(0);
    setIsDirty(false);
  }, [filePath]);

  // 跳转到指定行
  useEffect(() => {
    if (textareaRef.current && initialLine && initialLine > 0) {
      const textarea = textareaRef.current;
      const lines = text.split('\n');
      
      // 确保行号在有效范围内
      const targetLine = Math.min(initialLine, lines.length);
      
      // 计算目标行的字符偏移量
      let charOffset = 0;
      for (let i = 0; i < targetLine - 1; i++) {
        charOffset += lines[i].length + 1;
      }
      
      // 设置光标位置到目标行的开头
      textarea.focus();
      textarea.setSelectionRange(charOffset, charOffset);
      
      const lineHeight = fontSize * 1.5;
      const targetScrollTop = (targetLine - 1) * lineHeight - (textarea.clientHeight / 2) + (lineHeight / 2);
      textarea.scrollTop = Math.max(0, targetScrollTop);
      
      // 设置高亮效果
      setHighlightedLine(targetLine);
      
      const timer = setTimeout(() => {
        setHighlightedLine(null);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [initialLine, text, fontSize]);

  // 加载历史记录
  useEffect(() => {
    loadHistoryFromBackend();
  }, [filePath]);

  // 关闭右键菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 处理Ctrl+滚轮缩放
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

  const addToHistory = (newText: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newText);
    // 限制历史记录数量
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
    setLineCount(newText.split('\n').length);
    setIsDirty(newText !== originalContent.current);
    addToHistory(newText);
    if (onChange) {
      onChange(newText);
    }
  };

  // 保存历史记录到后端
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
    setLineCount(entry.content.split('\n').length);
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
        // 直接保存文件到磁盘
        await writeFileContent(filePath, text);
        
        // 更新原始内容引用
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
      setLineCount(newText.split('\n').length);
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
      setLineCount(newText.split('\n').length);
      setHistoryIndex(newIndex);
      setIsDirty(newText !== originalContent.current);
      if (onChange) {
        onChange(newText);
      }
    }
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;

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

    // 处理 Tab 键
    if (e.key === 'Tab') {
      e.preventDefault();
      
      const beforeCursor = value.substring(0, selectionStart);
      const afterCursor = value.substring(selectionEnd);
      
      if (e.shiftKey) {
        // Shift+Tab: 减少缩进
        const lines = beforeCursor.split('\n');
        const currentLine = lines[lines.length - 1];
        
        if (currentLine.startsWith('  ')) {
          lines[lines.length - 1] = currentLine.substring(2);
          const newText = lines.join('\n') + afterCursor;
          setText(newText);
          setIsDirty(newText !== originalContent.current);
          addToHistory(newText);
          if (onChange) onChange(newText);
          
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = selectionStart - 2;
          }, 0);
        }
      } else {
        // Tab: 增加缩进
        const newText = beforeCursor + '  ' + afterCursor;
        setText(newText);
        setIsDirty(newText !== originalContent.current);
        addToHistory(newText);
        if (onChange) onChange(newText);
        
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
        }, 0);
      }
      return;
    }
    
    // 处理 Enter 键 - 自动缩进
    if (e.key === 'Enter') {
      e.preventDefault();
      
      const beforeCursor = value.substring(0, selectionStart);
      const afterCursor = value.substring(selectionEnd);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      
      // 计算当前行的缩进
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : '';
      
      // 检查当前行是否以 { [ ( 结尾，如果是则增加缩进
      const trimmedLine = currentLine.trim();
      let extraIndent = '';
      if (trimmedLine.endsWith('{') || trimmedLine.endsWith('[') || trimmedLine.endsWith('(')) {
        extraIndent = '  ';
      }
      
      // 检查光标后是否紧跟 } ] )，如果是则在中间插入空行
      const nextChar = afterCursor.charAt(0);
      let newText;
      let cursorOffset;
      
      if ((nextChar === '}' || nextChar === ']' || nextChar === ')') && extraIndent) {
        // 在括号之间插入两行
        newText = beforeCursor + '\n' + currentIndent + extraIndent + '\n' + currentIndent + afterCursor;
        cursorOffset = selectionStart + 1 + currentIndent.length + extraIndent.length;
      } else {
        // 正常换行并保持缩进
        newText = beforeCursor + '\n' + currentIndent + extraIndent + afterCursor;
        cursorOffset = selectionStart + 1 + currentIndent.length + extraIndent.length;
      }
      
      setText(newText);
      setLineCount(newText.split('\n').length);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) onChange(newText);
      
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = cursorOffset;
      }, 0);
      return;
    }
  };

  // 处理滚动同步
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const startTime = performance.now();
    
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
    
    const duration = performance.now() - startTime;
    if (duration > 16) {
      console.log(`[性能-滚动] ️ 滚动处理耗时: ${duration.toFixed(2)}ms`);
    }
  };

  // 格式化JSON
  const formatJSON = () => {
    if (!isJSON) return;
    
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setLineCount(formatted.split('\n').length);
      originalContent.current = formatted;
      setIsDirty(false);
      addToHistory(formatted);
      if (onChange) {
        onChange(formatted);
      }
    } catch (err) {
      alert('JSON格式错误，无法格式化');
    }
  };

  // 处理右键菜单
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

  // 复制选中文本
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

  // 剪切选中文本
  const handleCut = async () => {
    if (readOnly) return;
    
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selectedText = text.substring(selectionStart, selectionEnd);
    
    try {
      await navigator.clipboard.writeText(selectedText);
      const newText = text.substring(0, selectionStart) + text.substring(selectionEnd);
      setText(newText);
      setLineCount(newText.split('\n').length);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) {
        onChange(newText);
      }
      setContextMenu(null);
      
      // 恢复光标位置
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart;
        textarea.focus();
      }, 0);
    } catch (err) {
      console.error('剪切失败:', err);
    }
  };

  // 粘贴文本
  const handlePaste = async () => {
    if (readOnly) return;
    
    const textarea = textareaRef.current;
    if (!textarea) return;

    try {
      const clipboardText = await navigator.clipboard.readText();
      const { selectionStart, selectionEnd } = textarea;
      const newText = text.substring(0, selectionStart) + clipboardText + text.substring(selectionEnd);
      
      setText(newText);
      setLineCount(newText.split('\n').length);
      setIsDirty(newText !== originalContent.current);
      addToHistory(newText);
      if (onChange) {
        onChange(newText);
      }
      setContextMenu(null);
      
      // 恢复光标位置
      setTimeout(() => {
        const newPosition = selectionStart + clipboardText.length;
        textarea.selectionStart = textarea.selectionEnd = newPosition;
        textarea.focus();
      }, 0);
    } catch (err) {
      console.error('粘贴失败:', err);
    }
  };

  // 生成行号
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="text-editor">
      <div className="editor-header-info">
        <span className="file-path">
          {isDirty && <span className="dirty-indicator">● </span>}
          {filePath}
        </span>
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
          {readOnly && <span className="readonly-badge">只读</span>}
        </div>
      </div>
      <div className="editor-container" ref={editorContainerRef}>
        <div
          className="line-numbers"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: '1.5',
            transform: `translateY(-${scrollTop}px)`,
            willChange: 'transform',
            height: `${lineCount * fontSize * 1.5 + 32}px`,
            minHeight: '100%'
          }}
        >
          {lineNumbers.map((num) => (
            <div
              key={num}
              className={`line-number ${highlightedLine === num ? 'highlighted' : ''}`}
              style={{
                height: `${fontSize * 1.5}px`,
                lineHeight: `${fontSize * 1.5}px`
              }}
            >
              {num}
            </div>
          ))}
        </div>
        <div className="editor-content-wrapper" style={{ fontSize: `${fontSize}px` }}>
          {isJSON && (
            <CanvasSyntaxHighlighter
              code={text}
              language="json"
              scrollTop={scrollTop}
              scrollLeft={scrollLeft}
              fontSize={fontSize}
              lineHeight={1.5}
            />
          )}
          <textarea
            ref={textareaRef}
            className={`editor-textarea ${isJSON ? 'with-highlight' : ''}`}
            name="text-editor"
            id="text-editor"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onContextMenu={handleContextMenu}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            autoComplete="off"
          />
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
          {isJSON && (
            <div className="context-menu-item" onClick={formatJSON}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 7 4 4 20 4 20 7"></polyline>
                <line x1="9" y1="20" x2="15" y2="20"></line>
                <line x1="12" y1="4" x2="12" y2="20"></line>
              </svg>
              <span>格式化</span>
            </div>
          )}
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
              {!readOnly && (
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
              )}
            </>
          )}
          {!readOnly && (
            <div className="context-menu-item" onClick={handlePaste}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
              <span>粘贴</span>
              <span className="menu-shortcut">Ctrl+V</span>
            </div>
          )}
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
                      {/* 添加文本内容预览 */}
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