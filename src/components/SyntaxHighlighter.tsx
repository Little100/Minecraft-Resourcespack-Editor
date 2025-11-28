import React, { useMemo } from 'react';
import './SyntaxHighlighter.css';

interface SyntaxHighlighterProps {
  code: string;
  language: 'json';
  scrollTop?: number;
  scrollLeft?: number;
}

interface Token {
  type: 'string' | 'number' | 'boolean' | 'null' | 'key' | 'punctuation' | 'error' | 'text';
  value: string;
  line: number;
  column: number;
}

const tokenizeJSON = (code: string): Token[] => {
  const tokens: Token[] = [];
  let line = 0;
  let column = 0;
  let i = 0;

  const addToken = (type: Token['type'], value: string) => {
    tokens.push({ type, value, line, column });
    column += value.length;
  };

  while (i < code.length) {
    const char = code[i];

    // 换行
    if (char === '\n') {
      addToken('text', char);
      line++;
      column = 0;
      i++;
      continue;
    }

    // 空白字符
    if (/\s/.test(char)) {
      addToken('text', char);
      i++;
      continue;
    }

    // 字符串
    if (char === '"') {
      let str = '"';
      i++;
      let escaped = false;
      let closed = false;

      while (i < code.length) {
        const c = code[i];
        str += c;

        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          closed = true;
          i++;
          break;
        } else if (c === '\n') {
          break;
        }
        i++;
      }

      let j = i;
      while (j < code.length && /\s/.test(code[j])) j++;
      const isKey = code[j] === ':';

      addToken(closed ? (isKey ? 'key' : 'string') : 'error', str);
      continue;
    }

    // 数字
    if (/[0-9-]/.test(char)) {
      let num = '';
      let valid = true;

      while (i < code.length && /[0-9.eE+\-]/.test(code[i])) {
        num += code[i];
        i++;
      }

      // 验证数字格式
      if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(num)) {
        valid = false;
      }

      addToken(valid ? 'number' : 'error', num);
      continue;
    }

    if (/[a-z]/.test(char)) {
      let word = '';
      while (i < code.length && /[a-z]/.test(code[i])) {
        word += code[i];
        i++;
      }

      if (word === 'true' || word === 'false') {
        addToken('boolean', word);
      } else if (word === 'null') {
        addToken('null', word);
      } else {
        addToken('error', word);
      }
      continue;
    }

    // 标点符号
    if ('{}[]:,'.includes(char)) {
      addToken('punctuation', char);
      i++;
      continue;
    }

    // 其他字符视为错误 
    addToken('error', char);
    i++;
  }

  return tokens;
};

export default function SyntaxHighlighter({ code, language, scrollTop = 0, scrollLeft = 0 }: SyntaxHighlighterProps) {
  const MAX_TOKENS = 100000;
  
  const tokens = useMemo(() => {
    if (language !== 'json') {
      return null;
    }
    
    try {
      const startTime = performance.now();
      const result = tokenizeJSON(code);
      const duration = performance.now() - startTime;
      console.log(`[性能-语法高亮]  计算tokens完成, 耗时: ${duration.toFixed(2)}ms, tokens数量: ${result.length}`);
      
      if (result.length > MAX_TOKENS) {
        console.warn(`[性能-语法高亮] Token数量(${result.length})超过限制(${MAX_TOKENS}),已禁用语法高亮以提升性能`);
        console.warn(`[性能-语法高亮]  提示: 渲染${result.length}个DOM元素会导致严重卡顿,建议编辑较小的文件或使用纯文本模式`);
        return null;
      }
      
      return result;
    } catch (error) {
      console.error('[性能-语法高亮]  错误:', error);
      return null;
    }
  }, [code, language]);

  // 缓存渲染的token元素
  const tokenElements = useMemo(() => {
    if (!tokens) return null;
    
    console.log(`[性能-语法高亮]  渲染${tokens.length}个token元素`);
    return tokens.map((token, index) => (
      <span key={index} className={`token-${token.type}`}>
        {token.value}
      </span>
    ));
  }, [tokens]);

  if (language !== 'json' || !tokens) {
    return <pre>{code}</pre>;
  }

  return (
    <div
      className="syntax-highlighter"
      style={{
        transform: `translate(-${scrollLeft}px, -${scrollTop}px)`,
        willChange: 'transform'
      }}
    >
      {tokenElements}
    </div>
  );
}