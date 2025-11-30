import packMetaSchema from './scheme/pack.mcmeta.json';

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
  const path: string[] = [];
  
  let depth = 0;
  let inString = false;
  let currentKey = '';
  let collectingKey = false;
  
  for (let i = 0; i < beforeCursor.length; i++) {
    const char = beforeCursor[i];
    const prevChar = i > 0 ? beforeCursor[i - 1] : '';
    
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
      if (inString) {
        collectingKey = true;
        currentKey = '';
      } else if (collectingKey && beforeCursor[i + 1] === ':') {
        collectingKey = false;
      }
    } else if (inString && collectingKey) {
      currentKey += char;
    } else if (!inString) {
      if (char === '{') {
        depth++;
        if (currentKey && !collectingKey) {
          path.push(currentKey);
          currentKey = '';
        }
      } else if (char === '}') {
        depth--;
        if (path.length > 0) {
          path.pop();
        }
      } else if (char === ':' && currentKey) {}
    }
  }
  
  return path;
}

export function getCompletions(text: string, cursorPos: number, schemaPath: string = 'pack.mcmeta'): CompletionItem[] {
  console.log('[Schema] getCompletions 被调用');
  console.log('[Schema] text 长度:', text.length);
  console.log('[Schema] cursorPos:', cursorPos);
  console.log('[Schema] schemaPath:', schemaPath);
  
  const completions: CompletionItem[] = [];
  
  if (schemaPath !== 'pack.mcmeta') {
    console.log('[Schema] 不是 pack.mcmeta，返回空');
    return completions;
  }
  
  const path = getJsonPath(text, cursorPos);
  console.log('[Schema] JSON 路径:', path);
  
  const schema = getSchemaAtPath(packMetaSchema, path);
  console.log('[Schema] 获取到的 schema:', schema ? '存在' : '不存在');
  
  if (!schema) {
    console.log('[Schema] schema 为空，返回空');
    return completions;
  }
  
  if (schema.properties) {
    console.log('[Schema] 找到 properties，数量:', Object.keys(schema.properties).length);
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
  
  console.log('[Schema] 返回补全项数量:', completions.length);
  return completions;
}

function checkDuplicateKeys(obj: any, path: string = ''): string[] {
  const errors: string[] = [];
  
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return errors;
  }
  
  // 递归检查嵌套对象
  for (const key in obj) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      errors.push(...checkDuplicateKeys(obj[key], currentPath));
    }
  }
  
  return errors;
}

function detectDuplicateKeysInText(jsonText: string): string[] {
  const errors: string[] = [];
  const keyPositions: Map<string, string[]> = new Map();
  
  try {
    const keyRegex = /"([^"]+)"\s*:/g;
    let match;
    const pathStack: string[] = [];
    let braceDepth = 0;
    
    // 简单的路径跟踪
    for (let i = 0; i < jsonText.length; i++) {
      const char = jsonText[i];
      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        if (pathStack.length > 0) {
          pathStack.pop();
        }
      }
    }
    
    const lines = jsonText.split('\n');
    const keysPerObject: Map<number, Set<string>> = new Map();
    
    lines.forEach((line, lineIndex) => {
      const match = line.match(/"([^"]+)"\s*:/);
      if (match) {
        const key = match[1];
        const depth = (line.match(/^\s*/)?.[0].length || 0) / 2;
        
        if (!keysPerObject.has(depth)) {
          keysPerObject.set(depth, new Set());
        }
        
        const keysAtDepth = keysPerObject.get(depth)!;
        if (keysAtDepth.has(key)) {
          errors.push(`第 ${lineIndex + 1} 行: 检测到重复的键 "${key}"`);
        } else {
          keysAtDepth.add(key);
        }
      }
      
      if (line.trim() === '}') {
        const depth = (line.match(/^\s*/)?.[0].length || 0) / 2;
        keysPerObject.delete(depth + 1);
      }
    });
    
  } catch (error) {}
  
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