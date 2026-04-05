import packMetaSchema from './scheme/pack.mcmeta.json';
import { logger } from './logger';

interface SchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  oneOf?: SchemaProperty[];
  examples?: any[];
  default?: any;
}

interface CompletionItem {
  label: string;
  insertText: string;
  detail?: string;
  documentation?: string;
  kind: 'property' | 'value' | 'snippet';
}

function getSchemaAtPath(schema: any, path: string[]): SchemaProperty | null {
  let current = schema;
  
  for (const key of path) {
    if (current.properties && current.properties[key]) {
      current = current.properties[key];
    } else if (current.items) {
      current = current.items;
    } else if (current.oneOf) {
      const objectBranch = current.oneOf.find((branch: any) => branch.type === 'object');
      if (objectBranch) {
        current = objectBranch;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  
  return current;
}

export function getJsonPath(text: string, cursorPos: number): string[] {
  const beforeCursor = text.substring(0, cursorPos);

  interface ScopeFrame {
    type: 'object' | 'array';
    index: number;
    pendingKey: string;
  }

  const stack: ScopeFrame[] = [];
  const path: string[] = [];

  let i = 0;
  function readString(): string {
    i++;
    let result = '';
    while (i < beforeCursor.length) {
      const ch = beforeCursor[i];
      if (ch === '\\') {
        result += beforeCursor[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return result;
      }
      result += ch;
      i++;
    }
    return result;
  }

  function peekNonWs(): string | undefined {
    let j = i;
    while (j < beforeCursor.length && /\s/.test(beforeCursor[j])) j++;
    return beforeCursor[j];
  }

  while (i < beforeCursor.length) {
    const ch = beforeCursor[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      const strVal = readString();
      const top = stack[stack.length - 1];
      if (top && top.type === 'object' && peekNonWs() === ':') {
        top.pendingKey = strVal;
      }
      continue;
    }

    if (ch === '{') {
      const top = stack[stack.length - 1];
      if (top) {
        if (top.type === 'object' && top.pendingKey) {
          path.push(top.pendingKey);
          top.pendingKey = '';
        } else if (top.type === 'array') {
          path.push(`[${top.index}]`);
        }
      }
      stack.push({ type: 'object', index: 0, pendingKey: '' });
      i++;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      if (path.length > 0) path.pop();
      i++;
      continue;
    }

    if (ch === '[') {
      const top = stack[stack.length - 1];
      if (top) {
        if (top.type === 'object' && top.pendingKey) {
          path.push(top.pendingKey);
          top.pendingKey = '';
        } else if (top.type === 'array') {
          path.push(`[${top.index}]`);
        }
      }
      stack.push({ type: 'array', index: 0, pendingKey: '' });
      i++;
      continue;
    }

    if (ch === ']') {
      stack.pop();
      if (path.length > 0) path.pop();
      i++;
      continue;
    }

    if (ch === ',') {
      const top = stack[stack.length - 1];
      if (top && top.type === 'array') {
        top.index++;
      }
      if (top && top.type === 'object') {
        top.pendingKey = '';
      }
      i++;
      continue;
    }

    if (ch === ':') { i++; continue; }

    i++;
  }

  return path;
}

export function getCompletions(text: string, cursorPos: number, schemaPath: string = 'pack.mcmeta'): CompletionItem[] {
  logger.debug('[Schema] getCompletions 被调用');
  logger.debug('[Schema] text 长度:', text.length);
  logger.debug('[Schema] cursorPos:', cursorPos);
  logger.debug('[Schema] schemaPath:', schemaPath);
  
  const completions: CompletionItem[] = [];
  
  if (schemaPath !== 'pack.mcmeta') {
    logger.debug('[Schema] 不是 pack.mcmeta，返回空');
    return completions;
  }
  
  const path = getJsonPath(text, cursorPos);
  logger.debug('[Schema] JSON 路径:', path);
  
  const schema = getSchemaAtPath(packMetaSchema, path);
  logger.debug('[Schema] 获取到的 schema:', schema ? '存在' : '不存在');
  
  if (!schema) {
    logger.debug('[Schema] schema 为空，返回空');
    return completions;
  }
  
  if (schema.properties) {
    logger.debug('[Schema] 找到 properties，数量:', Object.keys(schema.properties).length);
    for (const [key, prop] of Object.entries(schema.properties)) {
      const property = prop as SchemaProperty;
      let insertText = `"${key}": `;
      
      if (property.type === 'string') {
        insertText += '""';
      } else if (property.type === 'integer' || property.type === 'number') {
        insertText += (property.default ?? property.examples?.[0] ?? '0');
      } else if (property.type === 'boolean') {
        insertText += (property.default ?? 'false');
      } else if (property.type === 'object') {
        insertText += '{\n  \n}';
      } else if (property.type === 'array') {
        insertText += '[\n  \n]';
      } else {
        insertText += 'null';
      }
      
      completions.push({
        label: key,
        insertText,
        detail: property.description,
        documentation: property.examples ? `示例: ${JSON.stringify(property.examples[0])}` : undefined,
        kind: 'property'
      });
    }
  }
  
  if (schema.enum) {
    for (const value of schema.enum) {
      completions.push({
        label: value,
        insertText: `"${value}"`,
        detail: '枚举值',
        kind: 'value'
      });
    }
  }
  
  if (schema.oneOf) {
    for (const option of schema.oneOf) {
      const opt = option as SchemaProperty;
      if (opt.type === 'string') {
        completions.push({
          label: '字符串类型',
          insertText: '""',
          detail: opt.description,
          kind: 'snippet'
        });
      } else if (opt.type === 'object') {
        const props = Object.keys(opt.properties || {}).slice(0, 3).join(', ');
        completions.push({
          label: '对象类型',
          insertText: '{\n  \n}',
          detail: `${opt.description}${props ? ` (${props}...)` : ''}`,
          kind: 'snippet'
        });
      }
    }
  }
  
  logger.debug('[Schema] 返回补全项数量:', completions.length);
  return completions;
}

function detectDuplicateKeysInText(jsonText: string): string[] {
  const errors: string[] = [];

  const keysStack: Set<string>[] = [];
  let i = 0;
  let line = 1;

  function readString(): string {
    i++;
    let result = '';
    while (i < jsonText.length) {
      const ch = jsonText[i];
      if (ch === '\n') line++;
      if (ch === '\\') {
        result += jsonText[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return result;
      }
      result += ch;
      i++;
    }
    return result;
  }

  function peekNonWs(): string | undefined {
    let j = i;
    while (j < jsonText.length && /\s/.test(jsonText[j])) j++;
    return jsonText[j];
  }

  while (i < jsonText.length) {
    const ch = jsonText[i];

    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      const keyLine = line;
      const strVal = readString();
      if (keysStack.length > 0 && peekNonWs() === ':') {
        const currentKeys = keysStack[keysStack.length - 1];
        if (currentKeys.has(strVal)) {
          errors.push(`第 ${keyLine} 行: 检测到重复的键 "${strVal}"`);
        } else {
          currentKeys.add(strVal);
        }
      }
      continue;
    }

    if (ch === '{') {
      keysStack.push(new Set<string>());
      i++;
      continue;
    }

    if (ch === '}') {
      keysStack.pop();
      i++;
      continue;
    }

    i++;
  }

  return errors;
}

export function validateJson(json: any, schemaPath: string = 'pack.mcmeta', jsonText?: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (schemaPath !== 'pack.mcmeta') {
    return { valid: true, errors };
  }
  
  // 检测重复键
  if (jsonText) {
    const duplicateErrors = detectDuplicateKeysInText(jsonText);
    errors.push(...duplicateErrors);
  }
  
  // 基础验证
  if (!json || typeof json !== 'object') {
    errors.push('根对象必须是一个 JSON 对象');
    return { valid: false, errors };
  }
  
  if (!json.pack) {
    errors.push('缺少必需的 "pack" 字段');
    return { valid: false, errors };
  }
  
  if (!json.pack.pack_format) {
    errors.push('缺少必需的 "pack.pack_format" 字段');
  }
  
  if (typeof json.pack.pack_format !== 'number') {
    errors.push('"pack.pack_format" 必须是一个数字');
  }
  
  if (!json.pack.description) {
    errors.push('缺少必需的 "pack.description" 字段');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function formatJson(json: any): string {
  return JSON.stringify(json, null, 2);
}