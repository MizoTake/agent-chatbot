/**
 * ユーザーフレンドリーなエラーメッセージとその解決方法
 */

export interface ErrorInfo {
  message: string;
  solution?: string;
  helpUrl?: string;
}

export class ErrorMessages {
  private static readonly errors: Map<string, ErrorInfo> = new Map([
    ['CLAUDE_NOT_FOUND', {
      message: 'Claude CLIが見つかりません',
      solution: '以下の手順でClaude CLIをインストールしてください:\n1. https://claude.ai/download からダウンロード\n2. インストール後、`claude --version`で確認',
      helpUrl: 'https://claude.ai/download'
    }],
    
    ['AUTH_REQUIRED', {
      message: 'Claude CLIの認証が必要です',
      solution: '`claude login`コマンドを実行して認証してください'
    }],
    
    ['REPO_CLONE_FAILED', {
      message: 'リポジトリのクローンに失敗しました',
      solution: '以下を確認してください:\n• リポジトリURLが正しいか\n• ネットワーク接続が正常か\n• プライベートリポジトリの場合、アクセス権限があるか'
    }],
    
    ['REPO_NOT_FOUND', {
      message: 'このチャンネルにリポジトリが設定されていません',
      solution: '`/claude-repo <リポジトリURL>`でリポジトリを設定してください'
    }],
    
    ['PERMISSION_DENIED', {
      message: 'ファイルまたはディレクトリへのアクセス権限がありません',
      solution: 'ボットの実行ユーザーに適切な権限を付与してください'
    }],
    
    ['DISK_SPACE_LOW', {
      message: 'ディスク容量が不足しています',
      solution: '不要なリポジトリを削除するか、ディスク容量を増やしてください'
    }],
    
    ['NETWORK_ERROR', {
      message: 'ネットワークエラーが発生しました',
      solution: 'インターネット接続を確認し、再度お試しください'
    }],
    
    ['TIMEOUT', {
      message: '処理がタイムアウトしました',
      solution: 'しばらく待ってから再度お試しください。問題が続く場合は、より小さなタスクに分割してください'
    }],
    
    ['INVALID_COMMAND', {
      message: '無効なコマンドです',
      solution: '`/claude-help`でヘルプを確認してください'
    }],
    
    ['RATE_LIMIT', {
      message: 'レート制限に達しました',
      solution: 'しばらく待ってから再度お試しください'
    }]
  ]);

  /**
   * エラーコードからユーザーフレンドリーなメッセージを取得
   */
  static getErrorInfo(errorCode: string): ErrorInfo {
    return this.errors.get(errorCode) || {
      message: 'エラーが発生しました',
      solution: '問題が続く場合は、管理者にお問い合わせください'
    };
  }

  /**
   * エラーオブジェクトから適切なエラー情報を推測
   */
  static fromError(error: Error | any): ErrorInfo {
    const errorString = error.toString().toLowerCase();
    
    if (errorString.includes('command not found') || errorString.includes('enoent')) {
      return this.getErrorInfo('CLAUDE_NOT_FOUND');
    }
    
    if (errorString.includes('permission denied') || errorString.includes('eacces')) {
      return this.getErrorInfo('PERMISSION_DENIED');
    }
    
    if (errorString.includes('authentication') || errorString.includes('unauthorized')) {
      return this.getErrorInfo('AUTH_REQUIRED');
    }
    
    if (errorString.includes('timeout')) {
      return this.getErrorInfo('TIMEOUT');
    }
    
    if (errorString.includes('network') || errorString.includes('enotfound')) {
      return this.getErrorInfo('NETWORK_ERROR');
    }
    
    if (errorString.includes('no space') || errorString.includes('enospc')) {
      return this.getErrorInfo('DISK_SPACE_LOW');
    }
    
    return {
      message: 'エラーが発生しました',
      solution: `詳細: ${error.message || error}`
    };
  }

  /**
   * エラー情報をフォーマットされた文字列として取得
   */
  static format(errorInfo: ErrorInfo): string {
    let formatted = `❌ ${errorInfo.message}`;
    
    if (errorInfo.solution) {
      formatted += `\n\n💡 解決方法:\n${errorInfo.solution}`;
    }
    
    if (errorInfo.helpUrl) {
      formatted += `\n\n📚 詳細: ${errorInfo.helpUrl}`;
    }
    
    return formatted;
  }
}