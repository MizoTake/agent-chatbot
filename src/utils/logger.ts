/**
 * 構造化ログユーティリティ
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

export interface LogContext {
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private name: string;
  private minLevel: LogLevel;
  private enableJson: boolean;

  constructor(name: string, options: { minLevel?: LogLevel; enableJson?: boolean } = {}) {
    this.name = name;
    this.minLevel = options.minLevel || this.getLogLevelFromEnv();
    this.enableJson = options.enableJson ?? this.isJsonEnabled();
  }

  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    switch (envLevel) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      case 'fatal': return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }

  private isJsonEnabled(): boolean {
    return process.env.LOG_FORMAT === 'json';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const minIndex = levels.indexOf(this.minLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= minIndex;
  }

  private formatError(error: any): LogEntry['error'] {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    return {
      name: 'UnknownError',
      message: String(error)
    };
  }

  private createLogEntry(level: LogLevel, message: string, context?: LogContext, error?: any): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        logger: this.name,
        ...context
      }
    };

    if (error) {
      entry.error = this.formatError(error);
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    if (this.enableJson) {
      console.log(JSON.stringify(entry));
    } else {
      // 人間が読みやすい形式
      const timestamp = entry.timestamp.substring(11, 23); // HH:MM:SS.sss
      const level = entry.level.toUpperCase().padEnd(5);
      const logger = `[${entry.context?.logger || 'app'}]`;
      
      let message = `${timestamp} ${level} ${logger} ${entry.message}`;
      
      // コンテキスト情報を追加
      const contextKeys = Object.keys(entry.context || {}).filter(k => k !== 'logger');
      if (contextKeys.length > 0) {
        const contextStr = contextKeys.map(k => `${k}=${JSON.stringify(entry.context![k])}`).join(' ');
        message += ` | ${contextStr}`;
      }
      
      // エラー情報を追加
      if (entry.error) {
        message += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
        if (entry.error.stack && this.minLevel === LogLevel.DEBUG) {
          message += `\n${entry.error.stack}`;
        }
      }

      // レベルに応じて適切なコンソールメソッドを使用
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(message);
          break;
        case LogLevel.INFO:
          console.log(message);
          break;
        case LogLevel.WARN:
          console.warn(message);
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(message);
          break;
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.output(this.createLogEntry(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.output(this.createLogEntry(LogLevel.INFO, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.output(this.createLogEntry(LogLevel.WARN, message, context));
    }
  }

  error(message: string, error?: any, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.output(this.createLogEntry(LogLevel.ERROR, message, context, error));
    }
  }

  fatal(message: string, error?: any, context?: LogContext): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      this.output(this.createLogEntry(LogLevel.FATAL, message, context, error));
    }
  }

  /**
   * 子ロガーを作成（コンテキストを継承）
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger(`${this.name}:${context.component || 'child'}`, {
      minLevel: this.minLevel,
      enableJson: this.enableJson
    });
    return childLogger;
  }

  /**
   * タイマーを開始してログ出力
   */
  time(label: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`${label} completed`, { duration_ms: duration });
    };
  }
}

// デフォルトロガーのエクスポート
export const logger = new Logger('claude-chatbot');

// 便利なヘルパー関数
export function createLogger(name: string): Logger {
  return new Logger(name);
}