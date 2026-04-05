import React from 'react';

export const MINECRAFT_COLORS: Record<string, { name: string; color: string }> = {
  '0': { name: '黑色', color: '#000000' },
  '1': { name: '深蓝', color: '#0000AA' },
  '2': { name: '深绿', color: '#00AA00' },
  '3': { name: '深青', color: '#00AAAA' },
  '4': { name: '深红', color: '#AA0000' },
  '5': { name: '深紫', color: '#AA00AA' },
  '6': { name: '金色', color: '#FFAA00' },
  '7': { name: '灰色', color: '#AAAAAA' },
  '8': { name: '深灰', color: '#555555' },
  '9': { name: '蓝色', color: '#5555FF' },
  'a': { name: '绿色', color: '#55FF55' },
  'b': { name: '青色', color: '#55FFFF' },
  'c': { name: '红色', color: '#FF5555' },
  'd': { name: '粉红', color: '#FF55FF' },
  'e': { name: '黄色', color: '#FFFF55' },
  'f': { name: '白色', color: '#FFFFFF' },
};

export const FORMAT_CODES: Record<string, string> = {
  'l': 'bold',
  'o': 'italic',
  'n': 'underline',
  'm': 'strikethrough',
  'k': 'obfuscated',
  'r': 'reset',
};

export function parseMinecraftText(text: string): React.ReactElement[] {
  if (typeof text !== 'string') {
    return [React.createElement('span', { key: '0' }, String(text))];
  }

  const parts: React.ReactElement[] = [];
  let currentColor = '#FFFFFF';
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrikethrough = false;
  let buffer = '';
  let partIndex = 0;

  const flushBuffer = () => {
    if (buffer) {
      const style: React.CSSProperties = {
        color: currentColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        textDecoration: [
          isUnderline ? 'underline' : '',
          isStrikethrough ? 'line-through' : '',
        ].filter(Boolean).join(' ') || 'none',
      };
      parts.push(
        React.createElement('span', { key: partIndex++, style }, buffer)
      );
      buffer = '';
    }
  };

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      
      if (MINECRAFT_COLORS[code]) {
        flushBuffer();
        currentColor = MINECRAFT_COLORS[code].color;
        isBold = false;
        isItalic = false;
        isUnderline = false;
        isStrikethrough = false;
        i++;
      } else if (FORMAT_CODES[code]) {
        flushBuffer();
        switch (code) {
          case 'l': isBold = true; break;
          case 'o': isItalic = true; break;
          case 'n': isUnderline = true; break;
          case 'm': isStrikethrough = true; break;
          case 'r':
            currentColor = '#FFFFFF';
            isBold = false;
            isItalic = false;
            isUnderline = false;
            isStrikethrough = false;
            break;
        }
        i++;
      } else {
        buffer += text[i];
      }
    } else {
      buffer += text[i];
    }
  }

  flushBuffer();

  if (parts.length === 0) {
    return [React.createElement('span', { key: '0' }, text)];
  }

  return parts;
}

export const MINECRAFT_COLORS_LIGHT: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#CC8800', '7': '#555555',
  '8': '#333333', '9': '#3333DD', 'a': '#00CC00', 'b': '#00AAAA',
  'c': '#DD3333', 'd': '#DD33DD', 'e': '#CCAA00', 'f': '#333333',
};

export function formatMinecraftTextHtml(text: string, theme?: 'dark' | 'light'): string {
  if (typeof text !== 'string') return String(text);
  
  const isDark = theme !== 'light';
  const defaultColor = isDark ? '#AAAAAA' : '#333333';
  
  let result = '';
  let currentColor = defaultColor;
  let isBold = false;
  let isItalic = false;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (MINECRAFT_COLORS[code]) {
        currentColor = isDark
          ? MINECRAFT_COLORS[code].color
          : (MINECRAFT_COLORS_LIGHT[code] || MINECRAFT_COLORS[code].color);
        isBold = false;
        isItalic = false;
        i++;
      } else if (code === 'l') { isBold = true; i++; }
      else if (code === 'o') { isItalic = true; i++; }
      else if (code === 'r') {
        currentColor = defaultColor;
        isBold = false;
        isItalic = false;
        i++;
      } else {
        result += escapeHtml(text[i]);
      }
    } else {
      const style = `color:${currentColor}${isBold ? ';font-weight:bold' : ''}${isItalic ? ';font-style:italic' : ''}`;
      result += `<span style="${style}">${escapeHtml(text[i])}</span>`;
    }
  }

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getColorCodeList(): Array<{ code: string; name: string; color: string }> {
  return Object.entries(MINECRAFT_COLORS).map(([code, info]) => ({
    code,
    ...info,
  }));
}
