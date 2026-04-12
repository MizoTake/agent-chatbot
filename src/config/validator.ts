/**
 * 環境変数の検証とサニタイズ
 */

import * as path from 'path';

interface EnvironmentVariables {
  DISCORD_BOT_TOKEN?: string;
  PORT?: string;
  DEBUG?: string;
}

export class ConfigValidator {
  /**
   * トークンの基本的な検証
   */
  private static validateToken(token: string, prefix?: string): boolean {
    // 空文字でないこと
    if (!token || token.trim().length === 0) {
      return false;
    }
    
    // プレフィックスのチェック（オプション）
    if (prefix && !token.startsWith(prefix)) {
      return false;
    }
    
    // 異常な長さでないこと
    if (token.length < 10 || token.length > 200) {
      return false;
    }
    
    // 基本的な文字チェック（英数字、ハイフン、アンダースコア、ピリオドのみ）
    if (!/^[a-zA-Z0-9\-_.]+$/.test(token)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * ポート番号の検証
   */
  private static validatePort(port: string): boolean {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
  }
  
  /**
   * 環境変数の検証とサニタイズ
   */
  static validateEnvironment(): {
    valid: boolean;
    errors: string[];
    sanitized: EnvironmentVariables;
  } {
    const errors: string[] = [];
    const sanitized: EnvironmentVariables = {};

    if (process.env.DISCORD_BOT_TOKEN) {
      if (!this.validateToken(process.env.DISCORD_BOT_TOKEN)) {
        errors.push('DISCORD_BOT_TOKEN is invalid');
      } else {
        sanitized.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN.trim();
      }
    }
    
    // ポート設定の検証
    if (process.env.PORT) {
      if (!this.validatePort(process.env.PORT)) {
        errors.push('PORT must be a valid port number (1-65535)');
      } else {
        sanitized.PORT = process.env.PORT.trim();
      }
    }
    
    // デバッグ設定の検証
    if (process.env.DEBUG) {
      const debugValue = process.env.DEBUG.trim().toLowerCase();
      if (debugValue === 'true' || debugValue === '1' || debugValue === 'on') {
        sanitized.DEBUG = 'true';
      }
    }
    
    if (!sanitized.DISCORD_BOT_TOKEN) {
      errors.push('DISCORD_BOT_TOKEN is required');
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
  
  /**
   * パスの検証（パストラバーサル攻撃対策）
   */
  static validatePath(inputPath: string, basePath: string): boolean {
    const resolvedPath = path.resolve(basePath, inputPath);
    const resolvedBase = path.resolve(basePath);
    const relativePath = path.relative(resolvedBase, resolvedPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }
  
  /**
   * チャンネルIDの検証
   */
  static validateChannelId(channelId: string): boolean {
    // 基本的な長さチェック
    if (!channelId || channelId.length < 5 || channelId.length > 50) {
      return false;
    }
    
    // 安全な文字のみ（英数字、ハイフン、アンダースコア）
    return /^[a-zA-Z0-9\-_]+$/.test(channelId);
  }
  
  /**
   * リポジトリURLの検証
   */
  static validateRepositoryUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      
      // HTTPSまたはSSH（git@）のみ許可
      if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol)) {
        // git@github.com:user/repo.git 形式をチェック
        if (!/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._\-\/]+\.git$/.test(url)) {
          return false;
        }
      }
      
      return true;
    } catch {
      // git@形式の可能性をチェック
      return /^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._\-\/]+\.git$/.test(url);
    }
  }
}
