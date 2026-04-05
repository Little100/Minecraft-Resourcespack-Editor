import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import Editor, { OnMount, loader, Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import "./TextEditor.css";
import "./MonacoEditor.css";
import SoundCreatorDialog from "./SoundCreatorDialog";
import AudioHoverPlayer from "./AudioHoverPlayer";
import { readFileContent, writeFileContent } from "../utils/tauri-api";
import { Icon, useToast } from '@mpe/ui';
import { logger } from '../utils/logger';
import { useThemeDetector } from '../hooks/useThemeDetector';
import { getLanguageFromPath } from '../utils/shared';

let monacoInitPromise: Promise<Monaco> | null = null;
const initMonaco = () => {
  if (!monacoInitPromise) {
    monacoInitPromise = loader.init();
  }
  return monacoInitPromise;
};

initMonaco();

interface TextEditorProps {
  content: string;
  filePath: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  initialLine?: number;
  onDownloadSounds?: () => void;
  onRefreshFileTree?: () => void;
}

interface AudioHover {
  audioPath: string;
  position: { x: number; y: number };
}

export default function TextEditor({ 
  content, 
  filePath, 
  onChange, 
  onSave, 
  readOnly = false, 
  initialLine, 
  onDownloadSounds, 
  onRefreshFileTree 
}: TextEditorProps) {
  const toast = useToast();
  const [text, setText] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [persistedHistory, setPersistedHistory] = useState<any[]>([]);
  const [fontSize, setFontSize] = useState(13);
  const [showSoundCreator, setShowSoundCreator] = useState(false);
  const [audioHover, setAudioHover] = useState<AudioHover | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const originalContent = useRef(content);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  // F-BUG-05: 使用 ref 跟踪最新的处理函数，避免 addCommand 闭包捕获过期值
  const handleSaveRef = useRef<() => void>(() => {});
  const handleUndoRef = useRef<() => void>(() => {});
  const handleRedoRef = useRef<() => void>(() => {});

  const isSoundsJson = filePath.includes('sounds.json');
  const isDark = useThemeDetector() === 'dark';
  const language = getLanguageFromPath(filePath);

  useEffect(() => {
    setText(content);
    originalContent.current = content;
    setHistory([content]);
    setHistoryIndex(0);
    setIsDirty(false);
    setIsEditorReady(false);
  }, [filePath]);

  useEffect(() => {
    if (editorRef.current && isEditorReady) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== content) {
        const position = editorRef.current.getPosition();
        model.setValue(content);
        if (position) {
          editorRef.current.setPosition(position);
        }
        setText(content);
        originalContent.current = content;
        setIsDirty(false);
      }
    }
  }, [content, isEditorReady]);

  // 加载历史记录
  useEffect(() => {
    loadHistoryFromBackend();
  }, [filePath]);

  // 监听主题
  // F-BUG-09: 移除空的 MutationObserver，使用 useThemeDetector hook 替代

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

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        fontSize,
        wordWrap: wordWrap ? 'on' : 'off',
        readOnly
      });
    }
  }, [fontSize, wordWrap, readOnly]);

  const addToHistory = useCallback((newText: string) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(newText);
      if (newHistory.length > 100) {
        newHistory.shift();
        return newHistory;
      }
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [historyIndex]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);

    setTimeout(() => {
      editor.layout();
      
      editor.setScrollTop(0);
      editor.setScrollLeft(0);
      
      editor.setPosition({ lineNumber: 1, column: 1 });
      
      editor.revealPositionNearTop({ lineNumber: 1, column: 1 }, 0);
    }, 0);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      handleUndoRef.current();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      handleRedoRef.current();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => {
      handleRedoRef.current();
    });

    // 跳转到指定行
    if (initialLine && initialLine > 0) {
      setTimeout(() => {
        editor.revealLineInCenter(initialLine);
        editor.setPosition({ lineNumber: initialLine, column: 1 });
        
        // 高亮当前行
        decorationsRef.current = editor.createDecorationsCollection([
          {
            range: new monaco.Range(initialLine, 1, initialLine, 1),
            options: {
              isWholeLine: true,
              className: 'monaco-highlighted-line',
              glyphMarginClassName: 'monaco-highlighted-glyph'
            }
          }
        ]);

        setTimeout(() => {
          if (decorationsRef.current) {
            decorationsRef.current.clear();
          }
        }, 2000);
      }, 100);
    }

    if (language === 'json') {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas: [],
        enableSchemaRequest: false
      });
    }
  }, [initialLine, language]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setText(value);
      setIsDirty(value !== originalContent.current);
      addToHistory(value);
      if (onChange) {
        onChange(value);
      }
    }
  }, [onChange, addToHistory]);

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
      logger.error('保存历史记录失败:', error);
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
      logger.error('加载历史记录失败:', error);
    }
  };

  // 显示历史记录对话框
  const showHistoryDialog = () => {
    loadHistoryFromBackend();
    setShowHistoryList(true);
  };

  // 恢复历史记录
  const restoreFromHistory = (entry: any) => {
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        model.setValue(entry.content);
      }
    }
    setText(entry.content);
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
      await loadHistoryFromBackend();
    } catch (error) {
      logger.error('删除历史记录失败:', error);
      toast({ message: '删除失败', type: 'error' });
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

        await saveHistoryToBackend();
      } catch (error) {
        logger.error('保存文件失败:', error);
        toast({ message: `保存文件失败: ${error}`, type: 'error' });
      }
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newText = history[newIndex];
      
      if (editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          const position = editorRef.current.getPosition();
          model.setValue(newText);
          if (position) {
            editorRef.current.setPosition(position);
          }
        }
      }
      
      setText(newText);
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
      
      if (editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          const position = editorRef.current.getPosition();
          model.setValue(newText);
          if (position) {
            editorRef.current.setPosition(position);
          }
        }
      }
      
      setText(newText);
      setHistoryIndex(newIndex);
      setIsDirty(newText !== originalContent.current);
      if (onChange) {
        onChange(newText);
      }
    }
  };

  // F-BUG-05: 同步 ref 到最新处理函数
  handleSaveRef.current = handleSave;
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  // 格式化JSON
  const formatJSON = () => {
    if (language !== 'json') return;

    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      
      if (editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          model.setValue(formatted);
        }
      }
      
      setText(formatted);
      originalContent.current = formatted;
      setIsDirty(false);
      addToHistory(formatted);
      if (onChange) {
        onChange(formatted);
      }
    } catch (err) {
      toast({ message: 'JSON格式错误，无法格式化', type: 'error' });
    }
  };

  const [audioPathPositions, setAudioPathPositions] = useState<Array<{
    path: string;
    line: number;
    endCol: number;
  }>>([]);

  useEffect(() => {
    if (!isSoundsJson) return;

    try {
      const parsed = JSON.parse(text);
      const positions: Array<{ path: string; line: number; endCol: number }> = [];
      const lines = text.split('\n');

      Object.keys(parsed).forEach(eventKey => {
        const event = parsed[eventKey];
        if (event.sounds && Array.isArray(event.sounds)) {
          event.sounds.forEach((sound: any) => {
            const soundPath = typeof sound === 'string' ? sound : sound.name;
            if (soundPath) {
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const searchStr = `"${soundPath}"`;
                const index = line.indexOf(searchStr);
                if (index !== -1) {
                  positions.push({
                    path: soundPath,
                    line: i,
                    endCol: index + searchStr.length
                  });
                }
              }
            }
          });
        }
      });

      setAudioPathPositions(positions);
    } catch (e) {
      setAudioPathPositions([]);
    }
  }, [text, isSoundsJson]);

  const handlePlayIconClick = (audioPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAudioHover({
      audioPath,
      position: {
        x: e.clientX + 20,
        y: e.clientY - 50
      }
    });
  };

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
            <Icon name="undo" size={16} />
          </button>
          <button
            className="editor-btn"
            onClick={handleRedo}
            disabled={historyIndex === history.length - 1}
            title="重做 (Ctrl+Y)"
          >
            <Icon name="redo" size={16} />
          </button>
          <button
            className="editor-btn"
            onClick={showHistoryDialog}
            title="历史记录"
          >
            <Icon name="clock" size={16} />
          </button>
          {language === 'json' && (
            <button
              className="editor-btn"
              onClick={formatJSON}
              title="格式化JSON"
            >
              <Icon name="type" size={16} />
            </button>
          )}
          {isSoundsJson && onDownloadSounds && (
            <button
              className="editor-btn"
              onClick={onDownloadSounds}
              title="下载声音资源"
            >
              <Icon name="download" size={16} />
            </button>
          )}
          {isSoundsJson && (
            <button
              className="editor-btn"
              onClick={() => setShowSoundCreator(true)}
              title="创建音效"
            >
              <Icon name="plus-circle" size={16} />
            </button>
          )}
          <button
            className={`editor-btn ${wordWrap ? 'active' : ''}`}
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? "关闭自动换行" : "开启自动换行"}
          >
            <Icon name="word-wrap" size={16} />
          </button>
          <button
            className="editor-btn save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            title="保存 (Ctrl+S)"
          >
            <Icon name="save" size={16} />
          </button>
          {readOnly && <span className="readonly-badge">只读</span>}
        </div>
      </div>
      
      <div className="editor-container" ref={editorContainerRef}>
        <Editor
          height="100%"
          language={language}
          value={text}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
          options={{
            fontSize,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            minimap: {
              enabled: true,
              maxColumn: 80,
              renderCharacters: false
            },
            scrollBeyondLastLine: false,
            wordWrap: wordWrap ? 'on' : 'off',
            wrappingIndent: 'same',
            readOnly,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            bracketPairColorization: {
              enabled: true,
              independentColorPoolPerBracketType: true
            },
            guides: {
              indentation: true,
              highlightActiveIndentation: true,
              bracketPairs: 'active',
              bracketPairsHorizontal: 'active'
            },
            matchBrackets: 'always',
            folding: true,
            foldingStrategy: 'indentation',
            showFoldingControls: 'mouseover',
            lineNumbers: (lineNumber: number) => String(lineNumber - 1),
            glyphMargin: false,
            lineDecorationsWidth: 10,
            lineNumbersMinChars: 4,
            renderLineHighlight: 'line',
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            contextmenu: true,
            mouseWheelZoom: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            largeFileOptimizations: true,
            quickSuggestions: language === 'json' ? false : true,
            suggestOnTriggerCharacters: language !== 'json',
            acceptSuggestionOnEnter: 'off',
            wordBasedSuggestions: 'off',
            parameterHints: {
              enabled: false
            },
            'semanticHighlighting.enabled': true,
            stickyScroll: {
              enabled: false
            }
          }}
          loading={null}
        />
      </div>

      {/* 历史记录列表对话框 */}
      {showHistoryList && (
        <>
          <div className="modal-overlay" onClick={() => setShowHistoryList(false)} />
          <div className="history-list-dialog">
            <div className="dialog-header">
              <h3>历史记录</h3>
              <button className="dialog-close" onClick={() => setShowHistoryList(false)}>
                <Icon name="close" size={16} />
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
                            <Icon name="delete" size={14} />
                          </button>
                        </div>
                      </div>
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

      {/* 创建音效对话框 */}
      {showSoundCreator && (
        <>
          <div className="modal-overlay" onClick={() => setShowSoundCreator(false)} />
          <SoundCreatorDialog
            onClose={() => setShowSoundCreator(false)}
            onSave={async (data) => {
              logger.debug('保存音效数据:', data);
              setShowSoundCreator(false);
              
              try {
                const newContent = await readFileContent(filePath);
                if (editorRef.current) {
                  const model = editorRef.current.getModel();
                  if (model) {
                    model.setValue(newContent);
                  }
                }
                setText(newContent);
                originalContent.current = newContent;
                setIsDirty(false);
                if (onChange) {
                  onChange(newContent);
                }
              } catch (error) {
                logger.error('重新加载文件失败:', error);
              }
              
              if (onRefreshFileTree) {
                onRefreshFileTree();
              }
            }}
          />
        </>
      )}

      {/* 音频悬浮播放器 */}
      {audioHover && createPortal(
        <AudioHoverPlayer
          audioPath={audioHover.audioPath}
          position={audioHover.position}
          onClose={() => setAudioHover(null)}
        />,
        document.body
      )}
    </div>
  );
}