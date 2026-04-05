import { useCallback } from 'react';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function useFormatSize(): (bytes: number) => string {
  return useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (bytes < 0) return '-' + formatBytes(-bytes);
    return formatBytes(bytes);
  }, []);
}

function formatBytes(bytes: number): string {
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const unitIndex = Math.min(i, UNITS.length - 1);
  const value = bytes / Math.pow(k, unitIndex);

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unitIndex]}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '-' + formatBytes(-bytes);
  return formatBytes(bytes);
}
