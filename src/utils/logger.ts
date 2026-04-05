type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private enabled: boolean = false;
  private minLevel: LogLevel = 'info';
  private prefix: string = '';

  constructor(prefix: string = '') {
    this.prefix = prefix;
    this.enabled = localStorage.getItem('debugMode') === 'true';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    if (level === 'error' || level === 'warn') return true;
    return this.enabled && LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatPrefix(): string {
    return this.prefix ? `[${this.prefix}]` : '';
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatPrefix(), ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatPrefix(), ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatPrefix(), ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatPrefix(), ...args);
    }
  }

  child(subPrefix: string): Logger {
    const child = new Logger(
      this.prefix ? `${this.prefix}:${subPrefix}` : subPrefix
    );
    child.enabled = this.enabled;
    child.minLevel = this.minLevel;
    return child;
  }
}

export const logger = new Logger('MPE');

export const logPerf = logger.child('性能');
export const logPlugin = logger.child('插件');
export const logCache = logger.child('缓存');
export const logWorker = logger.child('Worker');
export const logSchema = logger.child('Schema');
export const logGPU = logger.child('GPU');
export const logEditor = logger.child('编辑器');
export const logServer = logger.child('服务器');

export default Logger;
