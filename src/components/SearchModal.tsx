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
  const [isFocused, setIsFocused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
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
  const hasSearched = searchResults !== null;

  // 初始化
  useEffect(() => {
    // 清空搜索框
    setSearchQuery('');
    setIsFocused(false);
    setSelectedResult(-1);
    
    // 聚焦搜索框
    inputRef.current?.focus();
  }, []);

  // 根据搜索查询控制聚焦状态
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsFocused(true);
    } else {
      setIsFocused(false);
    }
  }, [searchQuery]);

  // 处理关闭动画
  const handleClose = () => {
    setIsClosing(true);
    // 清空搜索状态
    setSearchQuery('');
    setIsFocused(false);
    setSelectedResult(-1);
    
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
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
    <div className={`search-modal-overlay ${isClosing ? 'closing' : ''}`}>
      <div className={`search-modal ${isFocused ? 'focused' : ''} ${isClosing ? 'closing' : ''}`} ref={modalRef}>
        {/* 搜索框容器 - 灵动岛效果 */}
        <div className={`search-bar-container ${isFocused ? 'focused' : ''}`}>
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
            
            {/* 搜索选项 - 在搜索框内 */}
            <div className="search-options-inline">
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

            {/* 结果计数 */}
            {hasResults && searchResults && (
              <div className="search-result-count">
                {searchResults.total_count} 个结果
              </div>
            )}

            <button className="search-close-btn" onClick={handleClose} title="关闭 (Esc)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* 布局 */}
        <div className={`search-results-container ${isFocused && hasSearched ? 'visible' : ''}`}>
          {/* 左侧文件名 */}
          <div className="results-panel left-panel">
            <div className="panel-header">
              <h3>文件名匹配</h3>
              <span className="panel-count">{fileNameResults.length}</span>
            </div>
            <div className="panel-content">
              {isSearching ? (
                <div className="panel-loading">
                  <div className="spinner"></div>
                </div>
              ) : fileNameResults.length > 0 ? (
                fileNameResults.map((result, index) => {
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
                      {result.translation && (
                        <div className="result-translation">
                          {result.translation}
                        </div>
                      )}
                      <div className="result-full-path">{result.file_path}</div>
                    </div>
                  );
                })
              ) : hasSearched ? (
                <div className="panel-empty">
                  <p>无文件名匹配</p>
                </div>
              ) : (
                <div className="panel-empty">
                  <p>输入搜索词</p>
                </div>
              )}
            </div>
          </div>

          {/* 右侧文件内容 */}
          <div className="results-panel right-panel">
            <div className="panel-header">
              <h3>文件内容匹配</h3>
              <span className="panel-count">{contentResults.length}</span>
            </div>
            <div className="panel-content">
              {isSearching ? (
                <div className="panel-loading">
                  <div className="spinner"></div>
                </div>
              ) : contentResults.length > 0 ? (
                contentResults.map((result, index) => {
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
                })
              ) : hasSearched ? (
                <div className="panel-empty">
                  <p>无内容匹配</p>
                </div>
              ) : (
                <div className="panel-empty">
                  <p>输入搜索词</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}