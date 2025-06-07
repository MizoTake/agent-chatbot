import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { logger } from '../utils/logger';

export interface BotConfig {
  defaults?: {
    timeout?: number;
    maxOutputSize?: string;
    logLevel?: string;
    logFormat?: string;
  };
  repositories?: {
    allowlist?: string[];
    blocklist?: string[];
    maxSize?: string;
    defaultBranch?: string;
  };
  security?: {
    enableRBAC?: boolean;
    enableAuditLog?: boolean;
    maxReposPerChannel?: number;
  };
  features?: {
    enablePlugins?: boolean;
    enableMetrics?: boolean;
    enableCache?: boolean;
  };
  commands?: {
    enableAliases?: boolean;
    customAliases?: Record<string, string>;
  };
}

export class ConfigLoader {
  private static readonly CONFIG_FILES = [
    'claude-bot.yml',
    'claude-bot.yaml',
    'claude-bot.json',
    '.claude-bot.yml',
    '.claude-bot.yaml',
    '.claude-bot.json'
  ];

  private static config: BotConfig = {};

  /**
   * 設定ファイルを読み込む
   */
  static async load(configPath?: string): Promise<BotConfig> {
    // キャッシュされた設定を返す
    if (this.config && !configPath) {
      return this.config;
    }

    try {
      let configFile: string | undefined = configPath;

      // 設定ファイルのパスが指定されていない場合、デフォルトのファイルを探す
      if (!configFile) {
        configFile = this.findConfigFile();
      }

      if (!configFile) {
        logger.debug('No configuration file found, using defaults');
        this.config = {};
        return this.config;
      }

      // ファイルを読み込む
      const content = await fs.promises.readFile(configFile, 'utf-8');
      const ext = path.extname(configFile).toLowerCase();

      // パースする
      if (ext === '.json') {
        this.config = JSON.parse(content);
      } else if (ext === '.yml' || ext === '.yaml') {
        this.config = yaml.load(content) as BotConfig;
      } else {
        throw new Error(`Unsupported config file format: ${ext}`);
      }

      logger.info('Configuration loaded', { file: configFile });
      if (this.config) {
        this.validateConfig(this.config);
      }
      
      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', error);
      this.config = {};
      return this.config;
    }
  }

  /**
   * 設定ファイルを探す
   */
  private static findConfigFile(): string | undefined {
    const cwd = process.cwd();
    
    for (const filename of this.CONFIG_FILES) {
      const filepath = path.join(cwd, filename);
      if (fs.existsSync(filepath)) {
        return filepath;
      }
    }

    // configディレクトリも確認
    const configDir = path.join(cwd, 'config');
    if (fs.existsSync(configDir)) {
      for (const filename of this.CONFIG_FILES) {
        const filepath = path.join(configDir, filename);
        if (fs.existsSync(filepath)) {
          return filepath;
        }
      }
    }

    return undefined;
  }

  /**
   * 設定の検証
   */
  private static validateConfig(config: BotConfig): void {
    // タイムアウトの検証
    if (config.defaults?.timeout !== undefined) {
      if (config.defaults.timeout < 0) {
        logger.warn('Invalid timeout value, must be >= 0', { value: config.defaults.timeout });
        delete config.defaults.timeout;
      }
    }

    // maxOutputSizeの検証とパース
    if (config.defaults?.maxOutputSize) {
      const parsed = this.parseSize(config.defaults.maxOutputSize);
      if (parsed === null) {
        logger.warn('Invalid maxOutputSize format', { value: config.defaults.maxOutputSize });
        delete config.defaults.maxOutputSize;
      }
    }

    // リポジトリ設定の検証
    if (config.repositories?.maxSize) {
      const parsed = this.parseSize(config.repositories.maxSize);
      if (parsed === null) {
        logger.warn('Invalid repository maxSize format', { value: config.repositories.maxSize });
        delete config.repositories.maxSize;
      }
    }
  }

  /**
   * サイズ文字列をバイト数に変換
   */
  static parseSize(size: string): number | null {
    const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024
    };

    return Math.floor(value * (units[unit] || 1));
  }

  /**
   * 設定値を取得（環境変数で上書き可能）
   */
  static get<T>(path: string, defaultValue?: T): T {
    const config = this.config || {};
    const keys = path.split('.');
    let value: any = config;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) break;
    }

    // 環境変数での上書きをチェック
    const envKey = `CLAUDE_BOT_${path.toUpperCase().replace(/\./g, '_')}`;
    const envValue = process.env[envKey];
    
    if (envValue !== undefined) {
      // 型に応じて変換
      if (typeof defaultValue === 'boolean') {
        return (envValue.toLowerCase() === 'true') as T;
      } else if (typeof defaultValue === 'number') {
        return parseFloat(envValue) as T;
      }
      return envValue as T;
    }

    return (value !== undefined ? value : defaultValue) as T;
  }

  /**
   * 設定をリロード
   */
  static async reload(): Promise<void> {
    this.config = {};
    await this.load();
  }
}