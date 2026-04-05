export const MINECRAFT_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  'a': '#55FF55',
  'b': '#55FFFF',
  'c': '#FF5555',
  'd': '#FF55FF',
  'e': '#FFFF55',
  'f': '#FFFFFF',
};

export const MINECRAFT_FORMATS: Record<string, string> = {
  'k': 'obfuscated',
  'l': 'bold',
  'm': 'strikethrough',
  'n': 'underline',
  'o': 'italic',
  'r': 'reset',
};

export interface MinecraftTextSegment {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

export function parseMinecraftText(text: string): MinecraftTextSegment[] {
  const segments: MinecraftTextSegment[] = [];
  let currentColor: string | undefined;
  let currentBold = false;
  let currentItalic = false;
  let currentUnderline = false;
  let currentStrikethrough = false;
  let currentObfuscated = false;
  let currentText = '';

  const pushSegment = () => {
    if (currentText) {
      const segment: MinecraftTextSegment = { text: currentText };
      if (currentColor) segment.color = currentColor;
      if (currentBold) segment.bold = true;
      if (currentItalic) segment.italic = true;
      if (currentUnderline) segment.underline = true;
      if (currentStrikethrough) segment.strikethrough = true;
      if (currentObfuscated) segment.obfuscated = true;
      segments.push(segment);
      currentText = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    if ((text[i] === '§' || text[i] === '&') && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();

      if (MINECRAFT_COLORS[code]) {
        pushSegment();
        currentColor = MINECRAFT_COLORS[code];
        i += 2;
        continue;
      }

      if (MINECRAFT_FORMATS[code]) {
        pushSegment();
        switch (code) {
          case 'k': currentObfuscated = true; break;
          case 'l': currentBold = true; break;
          case 'm': currentStrikethrough = true; break;
          case 'n': currentUnderline = true; break;
          case 'o': currentItalic = true; break;
          case 'r':
            currentColor = undefined;
            currentBold = false;
            currentItalic = false;
            currentUnderline = false;
            currentStrikethrough = false;
            currentObfuscated = false;
            break;
        }
        i += 2;
        continue;
      }
    }

    currentText += text[i];
    i++;
  }

  pushSegment();
  return segments;
}

export function stripMinecraftCodes(text: string): string {
  return text.replace(/[§&][0-9a-fk-or]/gi, '');
}
