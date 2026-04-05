import {
  Button,
  Icon,
  Dialog,
  DialogBody,
  DialogFooter,
  ConfirmDialog,
  ToastProvider,
  useToast,
  useLocalStorage,
  useTheme,
  useClickOutside,
  useKeyboardShortcut,
  useFormatSize,
  useMinecraftText,
  cn,
  MINECRAFT_COLORS,
  MINECRAFT_FORMATS,
  parseMinecraftText,
  stripMinecraftCodes,
  getIconNames,
} from './index';

declare global {
  interface Window {
    mpe?: {
      ui?: MpeUIApi;
      [key: string]: unknown;
    };
  }
}

export interface MpeUIApi {
  Button: typeof Button;
  Icon: typeof Icon;
  Dialog: typeof Dialog;
  DialogBody: typeof DialogBody;
  DialogFooter: typeof DialogFooter;
  ConfirmDialog: typeof ConfirmDialog;
  ToastProvider: typeof ToastProvider;
  hooks: {
    useToast: typeof useToast;
    useLocalStorage: typeof useLocalStorage;
    useTheme: typeof useTheme;
    useClickOutside: typeof useClickOutside;
    useKeyboardShortcut: typeof useKeyboardShortcut;
    useFormatSize: typeof useFormatSize;
    useMinecraftText: typeof useMinecraftText;
  };
  utils: {
    cn: typeof cn;
    MINECRAFT_COLORS: typeof MINECRAFT_COLORS;
    MINECRAFT_FORMATS: typeof MINECRAFT_FORMATS;
    parseMinecraftText: typeof parseMinecraftText;
    stripMinecraftCodes: typeof stripMinecraftCodes;
    getIconNames: typeof getIconNames;
  };
}

export function registerMpeUI(): void {
  if (!window.mpe) {
    window.mpe = {};
  }

  const uiApi: MpeUIApi = {
    Button,
    Icon,
    Dialog,
    DialogBody,
    DialogFooter,
    ConfirmDialog,
    ToastProvider,
    hooks: {
      useToast,
      useLocalStorage,
      useTheme,
      useClickOutside,
      useKeyboardShortcut,
      useFormatSize,
      useMinecraftText,
    },
    utils: {
      cn,
      MINECRAFT_COLORS,
      MINECRAFT_FORMATS,
      parseMinecraftText,
      stripMinecraftCodes,
      getIconNames,
    },
  };

  window.mpe.ui = uiApi;
}

export function createGuardedUIApi(
  permissions: Set<string>,
  pluginName: string
): Partial<MpeUIApi> {
  const permissionMap: Record<string, string> = {
    Button: 'ui.button',
    Icon: 'ui.icon',
    Dialog: 'ui.dialog',
    DialogBody: 'ui.dialog',
    DialogFooter: 'ui.dialog',
    ConfirmDialog: 'ui.dialog',
    ToastProvider: 'ui.toast',
  };

  const handler: ProxyHandler<MpeUIApi> = {
    get(target, prop: string) {
      const requiredPerm = permissionMap[prop];
      if (requiredPerm && !permissions.has(requiredPerm) && !permissions.has('ui.*')) {
        console.warn(
          `[WARN] Plugin "${pluginName}" attempted to use ${prop} without permission "${requiredPerm}"`
        );
        return undefined;
      }
      return target[prop as keyof MpeUIApi];
    },
  };

  return new Proxy(window.mpe?.ui as MpeUIApi, handler);
}
