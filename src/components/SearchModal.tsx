import { useState, useRef, useEffect, useCallback } from 'react';
import './SearchModal.css';
import type { SearchResponse, SearchResult as ApiSearchResult } from '../utils/tauri-api';

interface SearchModalProps {
  onClose: () => void;
  onResultClick: (filePath: string, lineNumber?: number) => void;
  onSearch: (query: string, caseSensitive: boolean, useRegex: boolean) => Promise<void>;
  searchResults: SearchResponse | null;
  isSearching: boolean;
}

export default function SearchModal({
  onClose,
  onResultClick,
  onSearch,
  searchResults,
  isSearching
}: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedResult, setSelectedResult] = useState<number>(-1);
  const [fileNameExpanded, setFileNameExpanded] = useState(true);
  const [contentExpanded, setContentExpanded] = useState(true);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<number | null>(null);

  // 搜索防抖
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    
    // 清除之前的定时器
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // 设置新的定时器
    searchTimeoutRef.current = setTimeout(() => {
      onSearch(query, caseSensitive, useRegex);
    }, 300);
  }, [caseSensitive, useRegex, onSearch]);

  // 当搜索选项改变时重新搜索
  useEffect(() => {
    if (searchQuery.trim()) {
      onSearch(searchQuery, caseSensitive, useRegex);
    }
  }, [caseSensitive, useRegex]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const fileNameResults = searchResults?.filename_matches || [];
  const contentResults = searchResults?.content_matches || [];
  const hasResults = fileNameResults.length > 0 || contentResults.length > 0;

  // 自动聚焦搜索框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const totalResults = fileNameResults.length + contentResults.length;
        if (totalResults > 0) {
          setSelectedResult(prev => (prev + 1) % totalResults);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const totalResults = fileNameResults.length + contentResults.length;
        if (totalResults > 0) {
          setSelectedResult(prev => (prev - 1 + totalResults) % totalResults);
        }
      } else if (e.key === 'Enter' && selectedResult >= 0) {
        e.preventDefault();
        const allResults = [...fileNameResults, ...contentResults];
        const result = allResults[selectedResult];
        if (result) {
          onResultClick(result.file_path, result.line_number);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedResult, onResultClick, fileNameResults, contentResults]);

  const handleResultClick = (result: ApiSearchResult) => {
    onResultClick(result.file_path, result.line_number);
  };

  // 高亮文本
  const highlightText = (text: string, start?: number, end?: number) => {
    if (start === undefined || end === undefined) {
      return <>{text}</>;
    }
    
    const before = text.substring(0, start);
    const match = text.substring(start, end);
    const after = text.substring(end);
    
    return (
      <>
        {before}
        <mark className="search-highlight">{match}</mark>
        {after}
      </>
    );
  };

  return (
    <div className="search-modal-overlay">
      <div className="search-modal" ref={modalRef}>
        {/* 搜索输入区域 */}
        <div className="search-header">
          <div className="search-input-wrapper">
            <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path>
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="搜索文件名或内容..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <button className="search-close-btn" onClick={onClose} title="关闭 (Esc)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* 搜索选项 */}
          <div className="search-options">
            <button
              className={`search-option-btn ${caseSensitive ? 'active' : ''}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="大小写敏感"
            >
              <span className="option-icon">Aa</span>
            </button>
            <button
              className={`search-option-btn ${useRegex ? 'active' : ''}`}
              onClick={() => setUseRegex(!useRegex)}
              title="使用正则表达式"
            >
              <span className="option-icon">.*</span>
            </button>
          </div>
        </div>

        {/* 搜索结果区域 */}
        <div className="search-results">
          {/* 加载状态 */}
          {isSearching && (
            <div className="search-loading">
              <div className="spinner"></div>
              <p>搜索中...</p>
            </div>
          )}

          {/* 无结果提示 */}
          {!isSearching && searchQuery && !hasResults && (
            <div className="no-results">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <p>未找到匹配结果</p>
              <span>尝试使用不同的搜索词</span>
            </div>
          )}

          {/* 空状态 */}
          {!isSearching && !searchQuery && !hasResults && (
            <div className="search-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <p>开始搜索</p>
              <span>输入文件名或内容进行搜索</span>
            </div>
          )}

          {/* 文件名匹配模块 */}
          {!isSearching && hasResults && fileNameResults.length > 0 && (
            <div className="results-module">
              <div
                className="results-module-header"
                onClick={() => setFileNameExpanded(!fileNameExpanded)}
              >
                <span className="collapse-icon">{fileNameExpanded ? '▼' : '▶'}</span>
                <span className="module-title">文件名匹配</span>
                <span className="module-count">{fileNameResults.length}</span>
              </div>
              {fileNameExpanded && (
                <div className="results-module-content">
                  {fileNameResults.map((result, index) => {
                    const fileName = result.file_path.split('/').pop() || result.file_path;
                    return (
                      <div
                        key={`file-${index}`}
                        className={`result-item ${selectedResult === index ? 'selected' : ''}`}
                        onClick={() => handleResultClick(result)}
                      >
                        <div className="result-path">
                          {highlightText(fileName, result.match_start, result.match_end)}
                        </div>
                        <div className="result-full-path">{result.file_path}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 文件内容匹配模块 */}
          {!isSearching && hasResults && contentResults.length > 0 && (
            <div className="results-module">
              <div
                className="results-module-header"
                onClick={() => setContentExpanded(!contentExpanded)}
              >
                <span className="collapse-icon">{contentExpanded ? '▼' : '▶'}</span>
                <span className="module-title">文件内容匹配</span>
                <span className="module-count">{contentResults.length}</span>
              </div>
              {contentExpanded && (
                <div className="results-module-content">
                  {contentResults.map((result, index) => {
                    const globalIndex = fileNameResults.length + index;
                    return (
                      <div
                        key={`content-${index}`}
                        className={`result-item ${selectedResult === globalIndex ? 'selected' : ''}`}
                        onClick={() => handleResultClick(result)}
                      >
                        <div className="result-path">{result.file_path}</div>
                        {result.line_content && (
                          <div className="result-content">
                            <span className="line-number">行 {result.line_number}</span>
                            <span className="line-text">
                              {highlightText(result.line_content, result.match_start, result.match_end)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="search-footer">
          <div className="search-tips">
            <span className="tip-item">
              <kbd>↑</kbd><kbd>↓</kbd> 导航
            </span>
            <span className="tip-item">
              <kbd>Enter</kbd> 打开
            </span>
            <span className="tip-item">
              <kbd>Esc</kbd> 关闭
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}