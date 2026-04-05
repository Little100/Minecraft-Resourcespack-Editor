export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'json':
    case 'mcmeta':
      return 'json';
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'xml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'properties':
    case 'lang':
      return 'ini';
    case 'glsl':
    case 'fsh':
    case 'vsh':
      return 'glsl';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'bat':
    case 'cmd':
      return 'bat';
    case 'txt':
      return 'plaintext';
    default:
      return 'plaintext';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (Math.round((bytes / Math.pow(k, i)) * 100) / 100) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0 B/s';
  return formatBytes(bytesPerSecond) + '/s';
}

export function formatETA(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
