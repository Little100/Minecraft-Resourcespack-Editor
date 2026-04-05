import { useMemo } from 'react';
import {
  parseMinecraftText,
  stripMinecraftCodes,
  MINECRAFT_COLORS,
  MINECRAFT_FORMATS,
  type MinecraftTextSegment,
} from '../utils/minecraft-colors';

export interface UseMinecraftTextReturn {
  parseMinecraftText: (text: string) => MinecraftTextSegment[];
  stripMinecraftCodes: (text: string) => string;
  MINECRAFT_COLORS: Record<string, string>;
  MINECRAFT_FORMATS: Record<string, string>;
}

export function useMinecraftText(): UseMinecraftTextReturn {
  return useMemo(
    () => ({
      parseMinecraftText,
      stripMinecraftCodes,
      MINECRAFT_COLORS,
      MINECRAFT_FORMATS,
    }),
    []
  );
}
