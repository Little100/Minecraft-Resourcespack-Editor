import { useEffect, useRef, useMemo } from 'react';

interface CanvasSyntaxHighlighterProps {
  code: string;
  language: 'json';
  scrollTop: number;
  scrollLeft: number;
  fontSize: number;
  lineHeight: number;
}

interface Token {
  type: 'string' | 'number' | 'boolean' | 'null' | 'key' | 'punctuation' | 'error' | 'text';
  value: string;
  line: number;
  column: number;
}

const TOKEN_COLORS: Record<string, string> = {
  string: '#ce9178',
  number: '#b5cea8',
  boolean: '#569cd6',
  null: '#569cd6',
  key: '#9cdcfe',
  punctuation: '#d4d4d4',
  error: '#f48771',
  text: '#d4d4d4',
};

const TOKEN_COLORS_LIGHT: Record<string, string> = {
  string: '#a31515',
  number: '#098658',
  boolean: '#0000ff',
  null: '#0000ff',
  key: '#0451a5',
  punctuation: '#333333',
  error: '#cd3131',
  text: '#333333',
};

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

    if (char === '\n') {
      addToken('text', char);
      line++;
      column = 0;
      i++;
      continue;
    }

    if (/\s/.test(char)) {
      addToken('text', char);
      i++;
      continue;
    }

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

    if (/[0-9-]/.test(char)) {
      let num = '';
      while (i < code.length && /[0-9.eE+\-]/.test(code[i])) {
        num += code[i];
        i++;
      }
      const valid = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(num);
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

    if ('{}[]:,'.includes(char)) {
      addToken('punctuation', char);
      i++;
      continue;
    }

    addToken('error', char);
    i++;
  }

  return tokens;
};

export default function CanvasSyntaxHighlighter({
  code,
  language,
  scrollTop,
  scrollLeft,
  fontSize,
  lineHeight
}: CanvasSyntaxHighlighterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // 计算tokens
  const tokens = useMemo(() => {
    if (language !== 'json') return null;
    
    const startTime = performance.now();
    const result = tokenizeJSON(code);
    const duration = performance.now() - startTime;
    console.log(`[Canvas-语法高亮] ✅ Token计算完成, 耗时: ${duration.toFixed(2)}ms, tokens: ${result.length}`);
    return result;
  }, [code, language]);

  // 检测主题
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = isDark ? TOKEN_COLORS : TOKEN_COLORS_LIGHT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tokens) return;

    const render = () => {
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      // 设置尺寸
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      // 清空画布
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.font = `${fontSize}px Consolas, Monaco, "Courier New", monospace`;
      ctx.textBaseline = 'top';

      const paddingTop = 16;
      const paddingLeft = 16;

      // 计算行高
      const lineHeightPx = fontSize * lineHeight;

      // 计算可见区域
      const startLine = Math.max(0, Math.floor((scrollTop) / lineHeightPx));
      const endLine = Math.ceil((scrollTop + rect.height) / lineHeightPx) + 1;

      // 绘制缩进引导线
      const indentGuideColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
      const lines = code.split('\n');
      const spaceWidth = ctx.measureText(' ').width;
      
      for (let lineNum = startLine; lineNum <= Math.min(endLine, lines.length - 1); lineNum++) {
        const line = lines[lineNum];
        const y = lineNum * lineHeightPx + paddingTop - scrollTop;
        
        // 计算缩进级别
        let indentLevel = 0;
        for (let i = 0; i < line.length; i += 2) {
          if (line[i] === ' ' && line[i + 1] === ' ') {
            indentLevel++;
          } else {
            break;
          }
        }
        
        // 绘制缩进引导线
        ctx.strokeStyle = indentGuideColor;
        ctx.lineWidth = 1;
        for (let i = 1; i <= indentLevel; i++) {
          const x = paddingLeft + (i * 2 * spaceWidth) - scrollLeft;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + lineHeightPx);
          ctx.stroke();
        }
      }

      // 遍历所有tokens并渲染
      let currentLine = 0;
      let currentX = 0;

      for (const token of tokens) {
        // 跳过不可见的行
        if (token.line < startLine) {
          if (token.value === '\n') {
            currentLine++;
            currentX = 0;
          } else {
            currentX += ctx.measureText(token.value).width;
          }
          continue;
        }

        // 超出范围停止渲染
        if (token.line > endLine) break;

        if (token.value === '\n') {
          currentLine++;
          currentX = 0;
          continue;
        }

        // 计算渲染位置
        const y = token.line * lineHeightPx + paddingTop - scrollTop;
        const x = paddingLeft + currentX - scrollLeft;

        // 绘制token
        ctx.fillStyle = colors[token.type] || colors.text;
        ctx.fillText(token.value, x, y);

        // 更新x坐标
        currentX += ctx.measureText(token.value).width;
      }
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [tokens, scrollTop, scrollLeft, fontSize, lineHeight, colors]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
  }, [fontSize]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (language !== 'json' || !tokens) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
}