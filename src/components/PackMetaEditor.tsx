import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import "./PackMetaEditor.css";
import SyntaxHighlighter from "./SyntaxHighlighter";
import PackMetaVisualEditor from "./PackMetaVisualEditor";
import { writeFileContent } from "../utils/tauri-api";
import { getCompletions, validateJson } from "../utils/json-schema-helper";
import { getVersionsByPackFormat } from "../utils/version-map";

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
  const [completions, setCompletions] = useState<Array<{label: string; insertText: string; detail?: string; kind: string}>>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0 });
  const [schemaErrors, setSchemaErrors] = useState<string[]>([]);
  const [showVisualEditor, setShowVisualEditor] = useState(false);
  const [packFormatVersions, setPackFormatVersions] = useState<Record<number, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const completionMenuRef = useRef<HTMLDivElement>(null);
  const originalContent = useRef(content);

  // 加载版本信息
  useEffect(() => {
    const loadVersions = async () => {
      if (!parsedData?.pack) {
        console.log('[版本映射] 没有 pack 数据，跳过加载');
        return;
      }
      
      const pack = parsedData.pack;
      const formats: number[] = [];
      
      // 优先使用
      if (pack.pack_format) {
        formats.push(pack.pack_format);
        console.log('[版本映射] 检测到 pack_format:', pack.pack_format);
      }
      
      if (pack.min_format) {
        const minFormat = Array.isArray(pack.min_format) ? pack.min_format[0] : pack.min_format;
        if (!formats.includes(minFormat)) {
          formats.push(minFormat);
        }
        console.log('[版本映射] 检测到 min_format:', minFormat);
      }
      
      if (pack.max_format) {
        const maxFormat = Array.isArray(pack.max_format) ? pack.max_format[0] : pack.max_format;
        if (!formats.includes(maxFormat)) {
          formats.push(maxFormat);
        }
        console.log('[版本映射] 检测到 max_format:', maxFormat);
      }
      
      if (formats.length === 0) {
        console.log('[版本映射] 没有找到任何格式版本号');
        return;
      }

      console.log('[版本映射] 需要加载的格式:', formats);
      
      // 加载所有需要的格式
      for (const format of formats) {
        if (packFormatVersions[format]) {
          console.log('[版本映射] 格式', format, '已缓存:', packFormatVersions[format]);
          continue;
        }

        console.log('[版本映射] 开始加载格式', format, '的版本信息...');
        try {
          const versions = await getVersionsByPackFormat(format);
          console.log('[版本映射] 格式', format, '获取到的版本列表:', versions);
          
          if (versions && versions.length > 0) {
            // 区分正式版和预览版
            const releasePattern = /^\d+\.\d+(\.\d+)?$/;
            const releases = versions.filter(v => releasePattern.test(v));
            const allVersions = versions;
            
            const firstRelease = releases.length > 0 ? releases[releases.length - 1] : null;
            const lastRelease = releases.length > 0 ? releases[0] : null;
            const firstAll = allVersions[allVersions.length - 1];
            const lastAll = allVersions[0];
            
            let releaseRange = '';
            let fullRange = '';
            
            if (firstRelease && lastRelease) {
              releaseRange = firstRelease === lastRelease ? firstRelease : `${firstRelease} - ${lastRelease}`;
            }
            
            fullRange = firstAll === lastAll ? firstAll : `${firstAll} - ${lastAll}`;
            
            console.log('[版本映射] 格式', format, '正式版范围:', releaseRange, '完整范围:', fullRange);
            setPackFormatVersions(prev => ({
              ...prev,
              [format]: JSON.stringify({ release: releaseRange, full: fullRange })
            }));
          } else {
            console.log('[版本映射] 格式', format, '版本列表为空');
            setPackFormatVersions(prev => ({
              ...prev,
              [format]: JSON.stringify({ release: '', full: '未知版本' })
            }));
          }
        } catch (error) {
          console.error('[版本映射] 格式', format, '加载失败:', error);
          setPackFormatVersions(prev => ({
            ...prev,
            [format]: JSON.stringify({ release: '', full: '加载失败' })
          }));
        }
      }
    };
    
    loadVersions();
  }, [parsedData, packFormatVersions]);

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
      if (completionMenuRef.current && !completionMenuRef.current.contains(event.target as Node)) {
        setShowCompletions(false);
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
      
      const validation = validateJson(parsed, 'pack.mcmeta', jsonText);
      setSchemaErrors(validation.errors);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析错误');
      setParsedData(null);
      setSchemaErrors([]);
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
    
    // 自动触发补全
    const textarea = e.currentTarget;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = newText.substring(0, cursorPos);
    
    console.log('[补全] 输入变化:', {
      lastChar: newText[cursorPos - 1],
      beforeCursor: beforeCursor.slice(-30),
      cursorPos
    });
    
    const shouldTrigger = /[\{,]\s*[a-zA-Z_][a-zA-Z0-9_]*$/.test(beforeCursor);
    
    console.log('[补全] 是否触发:', shouldTrigger);
    
    if (shouldTrigger) {
      console.log('[补全] 立即触发补全');
      requestAnimationFrame(() => {
        triggerCompletion(newText, cursorPos);
      });
    } else {
      setShowCompletions(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
  };

  // 触发补全
  const triggerCompletion = (currentText?: string, currentCursorPos?: number) => {
    console.log('[补全] triggerCompletion 被调用');
    
    const textarea = textareaRef.current;
    if (!textarea) {
      console.log('[补全] textarea 不存在，退出');
      return;
    }

    const actualText = currentText !== undefined ? currentText : text;
    const cursorPos = currentCursorPos !== undefined ? currentCursorPos : textarea.selectionStart;
    
    console.log('[补全] 使用文本:', actualText);
    console.log('[补全] 光标位置:', cursorPos);
    console.log('[补全] 调用 getCompletions');
    
    const items = getCompletions(actualText, cursorPos, 'pack.mcmeta');
    console.log('[补全] getCompletions 返回:', items);
    
    if (items.length === 0) {
      console.log('[补全] 没有补全项');
      setShowCompletions(false);
      return;
    }

    const beforeCursor = actualText.substring(0, cursorPos);
    const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    const currentInput = match ? match[0] : '';
    
    console.log('[补全] 当前输入:', currentInput);
    
    let filteredItems = items;
    if (currentInput) {
      // 只保留以当前输入开头的补全项
      filteredItems = items.filter(item =>
        item.label.toLowerCase().startsWith(currentInput.toLowerCase())
      );
      
      console.log('[补全] startsWith 过滤后:', filteredItems.length);
    }
    
    // 没有匹配项隐藏
    if (filteredItems.length === 0) {
      console.log('[补全] 没有匹配项，隐藏补全');
      setShowCompletions(false);
      return;
    }

    console.log('[补全] 最终补全项数量:', filteredItems.length);
    
    setCompletions(filteredItems);
    setCompletionIndex(0);
    
    // 计算补全位置
    const textBeforeCursor = actualText.substring(0, cursorPos);
    const lines = textBeforeCursor.split('\n');
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length;
    
    const lineHeight = fontSize * 1.5;
    const charWidth = fontSize * 0.6;
    
    const textareaRect = textarea.getBoundingClientRect();
    
    const cursorX = currentCol * charWidth;
    const cursorY = (currentLine - 1) * lineHeight;
    
    const padding = 16;
    let x = textareaRect.left + padding + cursorX - scrollLeft;
    let y = textareaRect.top + padding + cursorY + lineHeight - scrollTop;
    
    const menuWidth = 300;
    const menuHeight = 400;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    
    if (y + menuHeight > window.innerHeight) {
      y = textareaRect.top + padding + cursorY - scrollTop - menuHeight;
    }
    
    console.log('[补全] 菜单位置:', {
      x,
      y,
      textareaRect,
      cursorX,
      cursorY,
      scrollTop,
      scrollLeft
    });
    
    setCompletionPos({ x: Math.max(0, x), y: Math.max(0, y) });
    setShowCompletions(true);
    console.log('[补全] 设置 showCompletions = true');
  };

  // 插入补全项
  const insertCompletion = (item: typeof completions[0]) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const beforeCursor = text.substring(0, cursorPos);
    const afterCursor = text.substring(cursorPos);
    
    // 查找当前正在输入的标识符
    const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    let replaceStart = cursorPos;
    
    if (match) {
      replaceStart = cursorPos - match[0].length;
    }
    
    const newText = text.substring(0, replaceStart) + item.insertText + afterCursor;
    let newCursorPos = replaceStart + item.insertText.length;
    
    if (item.insertText.match(/"[^"]*":\s*""/)) {
      const colonPos = item.insertText.lastIndexOf('""');
      newCursorPos = replaceStart + colonPos + 1;
    } else if (item.insertText.includes('\n')) {
      const lines = item.insertText.split('\n');
      const offset = lines[0].length + 1 + (lines[1]?.match(/^\s*/)?.[0].length || 0);
      newCursorPos = replaceStart + offset;
    }
    
    setText(newText);
    tryParseJSON(newText);
    setIsDirty(newText !== originalContent.current);
    addToHistory(newText);
    if (onChange) {
      onChange(newText);
    }
    
    setShowCompletions(false);
    
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = newCursorPos;
    }, 0);
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

    // 处理补全菜单
    if (showCompletions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCompletionIndex((prev) => (prev + 1) % completions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCompletionIndex((prev) => (prev - 1 + completions.length) % completions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertCompletion(completions[completionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCompletions(false);
        return;
      }
    }

    // Ctrl+Space 触发补全
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      triggerCompletion(text, textarea.selectionStart);
      return;
    }

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

    const renderDescription = (desc: any) => {
      if (typeof desc === 'string') {
        return <div className="minecraft-text">{parseMinecraftText(desc)}</div>;
      }
      return <pre className="json-value">{JSON.stringify(desc, null, 2)}</pre>;
    };

    // 获取资源包名称
    const getPackName = () => {
      const pathParts = filePath.split('/');
      // 找到资源包根目录名
      const packIndex = pathParts.findIndex(part => part === 'pack.mcmeta');
      if (packIndex > 0) {
        return pathParts[packIndex - 1];
      }
      return '资源包';
    };

    // 获取版本范围
    const getVersionRange = (formatValue: number | number[] | undefined): { release: string; full: string } => {
      if (!formatValue) return { release: '', full: '' };
      
      const format = Array.isArray(formatValue) ? formatValue[0] : formatValue;
      const cached = packFormatVersions[format];
      
      if (!cached) {
        return { release: '', full: '加载中...' };
      }
      
      try {
        return JSON.parse(cached);
      } catch {
        // 兼容旧格式
        return { release: cached, full: cached };
      }
    };

    return (
      <div className="preview-content">
        {/* Pack Info */}
        <div className="preview-section">
          <h4>基础信息 ({getPackName()})</h4>
          {parsedData.pack ? (
            <div className="info-grid">
              {parsedData.pack.pack_format && (
                <div className="info-item">
                  <span className="info-label">格式版本 (pack_format):</span>
                  <div className="info-value" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{parsedData.pack.pack_format}</span>
                    {(() => {
                      const versionInfo = getVersionRange(parsedData.pack.pack_format);
                      return (
                        <>
                          {versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(34, 197, 94, 0.15)',
                              color: '#22c55e',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.release}
                            </span>
                          )}
                          {versionInfo.full && versionInfo.full !== versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#3b82f6',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.full}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
              
              {parsedData.pack.supported_formats && (
                <div className="info-item">
                  <span className="info-label">支持格式:</span>
                  <span className="info-value">
                    {typeof parsedData.pack.supported_formats === 'object' && !Array.isArray(parsedData.pack.supported_formats)
                      ? `${parsedData.pack.supported_formats.min_inclusive} - ${parsedData.pack.supported_formats.max_inclusive}`
                      : Array.isArray(parsedData.pack.supported_formats)
                        ? parsedData.pack.supported_formats.join(', ')
                        : JSON.stringify(parsedData.pack.supported_formats)}
                  </span>
                </div>
              )}

              {parsedData.pack.min_format && (
                <div className="info-item">
                  <span className="info-label">最小格式 (min_format):</span>
                  <div className="info-value" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{JSON.stringify(parsedData.pack.min_format)}</span>
                    {(() => {
                      const versionInfo = getVersionRange(parsedData.pack.min_format);
                      return (
                        <>
                          {versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(34, 197, 94, 0.15)',
                              color: '#22c55e',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.release}
                            </span>
                          )}
                          {versionInfo.full && versionInfo.full !== versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#3b82f6',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.full}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {parsedData.pack.max_format && (
                <div className="info-item">
                  <span className="info-label">最大格式 (max_format):</span>
                  <div className="info-value" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{JSON.stringify(parsedData.pack.max_format)}</span>
                    {(() => {
                      const versionInfo = getVersionRange(parsedData.pack.max_format);
                      return (
                        <>
                          {versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(34, 197, 94, 0.15)',
                              color: '#22c55e',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.release}
                            </span>
                          )}
                          {versionInfo.full && versionInfo.full !== versionInfo.release && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#3b82f6',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}>
                              {versionInfo.full}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="info-item">
                <span className="info-label">描述:</span>
                <div className="info-value-wrapper">
                  {renderDescription(parsedData.pack.description)}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-section">未定义 pack 字段</div>
          )}
        </div>

        {/* Language */}
        {parsedData.language && Object.keys(parsedData.language).length > 0 && (
          <div className="preview-section">
            <h4>语言 (Language)</h4>
            <div className="language-grid">
              {Object.entries(parsedData.language).map(([code, lang]: [string, any]) => (
                <div key={code} className="language-card">
                  <div className="lang-header">
                    <span className="lang-code">{code}</span>
                    {lang.bidirectional && <span className="lang-badge">RTL</span>}
                  </div>
                  <div className="lang-name">{lang.name}</div>
                  <div className="lang-region">{lang.region}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter */}
        {parsedData.filter && parsedData.filter.block && parsedData.filter.block.length > 0 && (
          <div className="preview-section">
            <h4>过滤器 (Filter)</h4>
            <div className="filter-list">
              {parsedData.filter.block.map((item: any, index: number) => (
                <div key={index} className="filter-item">
                  <span className="filter-namespace">{item.namespace || '*'}</span>
                  <span className="filter-separator">/</span>
                  <span className="filter-path">{item.path || '*'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overlays */}
        {parsedData.overlays && parsedData.overlays.entries && parsedData.overlays.entries.length > 0 && (
          <div className="preview-section">
            <h4>覆盖层 (Overlays)</h4>
            <div className="overlay-list">
              {parsedData.overlays.entries.map((entry: any, index: number) => (
                <div key={index} className="overlay-item">
                  <div className="overlay-formats">
                    <span className="label">格式:</span>
                    <span className="value">
                      {entry.formats
                        ? (typeof entry.formats === 'object' && !Array.isArray(entry.formats)
                            ? `${entry.formats.min_inclusive}-${entry.formats.max_inclusive}`
                            : Array.isArray(entry.formats) ? entry.formats.join(', ') : entry.formats)
                        : (entry.min_format ? `>= ${JSON.stringify(entry.min_format)}` : 'Unknown')}
                    </span>
                  </div>
                  <div className="overlay-dir">
                    <span className="label">目录:</span>
                    <code className="value">{entry.directory}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="preview-section">
          <h4>完整数据 (JSON)</h4>
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
            className="editor-btn"
            onClick={() => setShowVisualEditor(true)}
            title="可视化编辑"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
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
              lineHeight: '1.5',
              transform: `translateY(-${scrollTop}px)`,
              willChange: 'transform',
              height: `${lineCount * fontSize * 1.5 + 32}px`,
              minHeight: '100%'
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
      {/* 可视化编辑器对话框 */}
      {showVisualEditor && createPortal(
        <>
          <div className="modal-overlay" onClick={() => setShowVisualEditor(false)} />
          <div className="visual-editor-dialog">
            <div className="dialog-header">
              <h3>可视化编辑 pack.mcmeta</h3>
              <button className="dialog-close" onClick={() => setShowVisualEditor(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <PackMetaVisualEditor
              initialData={parsedData}
              onApply={(newData) => {
                const formatted = JSON.stringify(newData, null, 2);
                setText(formatted);
                tryParseJSON(formatted);
                setIsDirty(formatted !== originalContent.current);
                addToHistory(formatted);
                if (onChange) {
                  onChange(formatted);
                }
                setShowVisualEditor(false);
              }}
              onCancel={() => setShowVisualEditor(false)}
            />
          </div>
        </>,
        document.body
      )}

      {/* 补全菜单 */}
      {showCompletions && createPortal(
        <div
          ref={completionMenuRef}
          className="completion-menu"
          style={{
            position: 'fixed',
            left: `${completionPos.x}px`,
            top: `${completionPos.y}px`,
            zIndex: 10000
          }}
        >
          <div className="completion-header">
            <span>建议</span>
            <span className="completion-hint">↑↓ 导航 · Enter 选择 · Esc 关闭</span>
          </div>
          <div className="completion-list">
            {completions.map((item, index) => (
              <div
                key={index}
                className={`completion-item ${index === completionIndex ? 'selected' : ''}`}
                onClick={() => insertCompletion(item)}
                onMouseEnter={() => setCompletionIndex(index)}
              >
                <div className="completion-main">
                  <span className={`completion-icon ${item.kind}`}>
                    {item.kind === 'property' ? 'P' : item.kind === 'value' ? 'V' : 'S'}
                  </span>
                  <span className="completion-label">{item.label}</span>
                </div>
                {item.detail && (
                  <div className="completion-detail">{item.detail}</div>
                )}
              </div>
            ))}
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