import { spawn } from 'child_process';
import * as path from 'path';
import { withRetry, isRetryableError } from './utils/retry';
import { createLogger } from './utils/logger';

const logger = createLogger('ClaudeCLIClient');

interface ClaudeResponse {
  response: string;
  error?: string;
  timedOut?: boolean;
}

interface BackgroundCallback {
  (response: ClaudeResponse): void;
}

interface StreamCallback {
  (chunk: string, isError: boolean): void;
}

interface ClaudeOptions {
  workingDirectory?: string;
  onBackgroundComplete?: BackgroundCallback;
  onStream?: StreamCallback;
  maxOutputSize?: number;
  skipPermissions?: boolean;
}

export class ClaudeCLIClient {
  private claudeCommand: string;
  private timeout: number;
  private maxOutputSize: number;
  private activeProcesses: Set<any>;

  constructor(
    claudeCommand: string = 'claude', 
    timeout?: number, // タイムアウトなし
    maxOutputSize: number = 10 * 1024 * 1024 // 10MB
  ) {
    this.claudeCommand = claudeCommand;
    this.timeout = timeout || 0; // 0 = タイムアウトなし
    this.maxOutputSize = maxOutputSize;
    this.activeProcesses = new Set();
  }

  /**
   * シェル引数を安全にエスケープする
   * @deprecated shell: falseを使用するため不要
   */
  private escapeShellArg(arg: string): string {
    // シングルクォートで囲み、内部のシングルクォートをエスケープ
    return "'" + arg.replace(/'/g, "'\\''") + "'";
  }

  /**
   * 出力を処理して整形する
   */
  private processOutput(output: string): string {
    // 末尾の空白を削除
    let processed = output.trim();
    
    // ANSIエスケープシーケンスを削除（ターミナルカラーなど）
    processed = processed.replace(/\x1b\[[0-9;]*m/g, '');
    
    // 制御文字を削除（ただし改行は保持）
    processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // 連続する改行を2つまでに制限
    processed = processed.replace(/\n{3,}/g, '\n\n');
    
    return processed;
  }

  /**
   * エラーメッセージをフォーマットする
   */
  private formatError(stderr: string, code: number | null, isBackground: boolean = false): string {
    // stderrを処理
    const processedError = this.processOutput(stderr);
    
    if (processedError) {
      // 既知のエラーパターンをチェックしてより分かりやすいメッセージに変換
      if (processedError.includes('Permission denied')) {
        return `権限エラー: ファイルまたはディレクトリへのアクセス権がありません\n${processedError}`;
      }
      if (processedError.includes('No such file or directory')) {
        return `ファイル/ディレクトリが見つかりません\n${processedError}`;
      }
      if (processedError.includes('timeout')) {
        return `タイムアウト: 処理が長時間かかっています\n${processedError}`;
      }
      
      return processedError;
    }
    
    // stderrが空の場合はエラーコードに基づいたメッセージを返す
    const prefix = isBackground ? 'バックグラウンド処理' : 'プロセス';
    return `${prefix}がエラーコード ${code} で終了しました`;
  }

  async sendPrompt(prompt: string, options: ClaudeOptions = {}): Promise<ClaudeResponse> {
    // リトライ可能な操作として実行
    try {
      return await withRetry(
        () => this.executeClaude(prompt, options),
        {
          maxAttempts: 3,
          initialDelay: 2000,
          shouldRetry: (error) => {
            // タイムアウトはリトライしない（長時間の処理の可能性）
            if (error.timedOut) return false;
            // Claude CLIが見つからない場合はリトライしない
            if (error.message?.includes('Claude CLIが見つかりません')) return false;
            // その他のエラーはリトライ可能か判定
            return isRetryableError(error);
          },
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Claude command`, { 
              attempt, 
              error: error.message 
            });
          }
        }
      );
    } catch (retryError: any) {
      // リトライエラーの場合は最後のエラーを返す
      if (retryError.name === 'RetryError') {
        return {
          response: '',
          error: retryError.lastError?.message || retryError.message,
          timedOut: retryError.lastError?.timedOut
        };
      }
      return {
        response: '',
        error: retryError.message || '予期しないエラーが発生しました'
      };
    }
  }

  private async executeClaude(prompt: string, options: ClaudeOptions): Promise<ClaudeResponse> {
    const { 
      workingDirectory, 
      onBackgroundComplete, 
      onStream,
      maxOutputSize = this.maxOutputSize,
      skipPermissions = false
    } = options;
    
    return new Promise((resolve, reject) => {
      logger.debug('Executing Claude command', {
        workingDirectory: workingDirectory || 'current',
        timeout: this.timeout,
        maxOutputSize,
        skipPermissions
      });

      // コマンドライン引数を配列として構築（shell: falseの場合エスケープ不要）
      let command = this.claudeCommand;
      let args: string[] = [];
      
      // Check if we need to run as a different user when using skip permissions
      const forceAllowRoot = process.env.CLAUDE_FORCE_ALLOW_ROOT === 'true';
      const runAsUser = process.env.CLAUDE_RUN_AS_USER;
      
      if (skipPermissions && process.getuid && process.getuid() === 0 && !forceAllowRoot) {
        // If root and skip permissions is requested, use sudo to run as different user
        if (runAsUser) {
          command = 'sudo';
          args = ['-u', runAsUser, this.claudeCommand];
        } else {
          // Default to agent-chatbot user with full path
          command = 'sudo';
          args = ['-u', 'agent-chatbot', '/var/lib/agent-chatbot/.npm/bin/claude'];
        }
      }
      
      // --dangerously-skip-permissionsフラグを追加（必要な場合）
      if (skipPermissions) {
        args.push('--dangerously-skip-permissions');
      }
      
      args.push('--print', prompt);
      
      // セキュリティ向上のためshell: falseを使用
      const spawnOptions: any = {
        cwd: workingDirectory ? path.resolve(workingDirectory) : undefined, // パスを絶対パスに変換
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false, // シェルインジェクションを防ぐ
        env: { 
          ...process.env, 
          LANG: 'ja_JP.UTF-8', 
          LC_ALL: 'ja_JP.UTF-8',
          // Force non-root execution for --dangerously-skip-permissions
          ...(skipPermissions && process.env.CLAUDE_FORCE_ALLOW_ROOT !== 'true' ? { 
            USER: 'agent-chatbot',
            HOME: '/tmp/agent-chatbot'
          } : {})
        } // UTF-8エンコーディングを強制
      };
      
      // Don't try to drop privileges if using sudo
      // (The sudo command will handle the user switch)
      
      const claudeProcess = spawn(command, args, spawnOptions);

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let timeoutId: NodeJS.Timeout;
      let outputSize = 0;
      let outputTruncated = false;

      // タイムアウト処理 - timeoutが設定されている場合のみ
      if (this.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            // プロセスは継続させ、プロセスグループから切り離す
            claudeProcess.unref();
            
            // タイムアウトをメトリクスに記録
            logger.warn('Claude process timed out', {
              timeout_ms: this.timeout,
              workingDirectory
            });
            
            // タイムアウトは特殊ケースとしてresolve
            resolve({
              response: '',
              error: 'タイムアウト: 応答時間の制限に達しました。Claudeは引き続きバックグラウンドで処理を続けています。',
              timedOut: true
            });
          }
        }, this.timeout);
      }

      // プロセスをアクティブリストに追加
      this.activeProcesses.add(claudeProcess);

      claudeProcess.stdout?.on('data', (data) => {
        const str = data.toString('utf8');
        outputSize += Buffer.byteLength(str, 'utf8');
        
        // 出力サイズチェック
        if (outputSize > maxOutputSize) {
          if (!outputTruncated) {
            stdout += '\n\n[出力が最大サイズを超えたため切り詰められました]';
            outputTruncated = true;
          }
          return;
        }
        
        stdout += str;
        
        // ストリーミングコールバック
        if (onStream && !isResolved) {
          onStream(str, false);
        }
        
        // リアルタイムデバッグ出力（必要に応じて）
        logger.debug('Claude stdout received', {
          length: str.length,
          outputSize,
          truncated: outputTruncated
        });
      });

      claudeProcess.stderr?.on('data', (data) => {
        const str = data.toString('utf8');
        stderr += str;
        
        // ストリーミングコールバック（エラー）
        if (onStream && !isResolved) {
          onStream(str, true);
        }
        
        // リアルタイムデバッグ出力（必要に応じて）
        logger.debug('Claude stderr received', {
          length: str.length,
          preview: str.substring(0, 100)
        });
      });

      claudeProcess.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.activeProcesses.delete(claudeProcess);

        if (!isResolved) {
          isResolved = true;

          if (code === 0) {
            resolve({
              response: this.processOutput(stdout)
            });
          } else {
            // エラーコードをチェック
            if (stderr.includes('command not found') || stderr.includes('not found')) {
              reject(new Error('Claude CLIが見つかりません。Claudeがインストールされているか確認してください。'));
            } else if (stdout.includes('Welcome to Claude Code!')) {
              reject(new Error('Claude CLIがインタラクティブモードで起動しています。--print フラグが正しく適用されていることを確認してください。'));
            } else {
              // リトライ可能なエラーとしてreject
              const errorMessage = this.formatError(stderr, code);
              const error = new Error(errorMessage);
              (error as any).code = code;
              (error as any).stderr = stderr;
              reject(error);
            }
          }
        } else if (onBackgroundComplete) {
          // タイムアウト後に処理が完了した場合、コールバックを呼ぶ
          if (code === 0) {
            onBackgroundComplete({
              response: this.processOutput(stdout)
            });
          } else {
            onBackgroundComplete({
              response: '',
              error: this.formatError(stderr, code, true)
            });
          }
        }
      });

      claudeProcess.on('error', (err) => {
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          this.activeProcesses.delete(claudeProcess);
          
          if (err.message.includes('ENOENT')) {
            reject(new Error('Claude CLIが見つかりません。Claudeがインストールされているか確認してください。'));
          } else {
            // リトライ可能なエラーとしてreject
            reject(err);
          }
        }
      });
    });
  }

  async checkAvailability(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const checkProcess = spawn(this.claudeCommand, ['--version'], {
          shell: false, // セキュリティ向上
          timeout: 5000
        });

        let hasOutput = false;

        checkProcess.stdout?.on('data', () => {
          hasOutput = true;
        });

        checkProcess.on('close', (code) => {
          resolve(code === 0 || hasOutput);
        });

        checkProcess.on('error', () => {
          resolve(false);
        });

        // タイムアウト対策
        setTimeout(() => {
          checkProcess.kill();
          resolve(false);
        }, 5000);
      });
    } catch {
      return false;
    }
  }

  /**
   * すべてのアクティブなプロセスをクリーンアップ
   */
  cleanup(): void {
    this.activeProcesses.forEach(process => {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        // プロセスが既に終了している場合は無視
      }
    });
    this.activeProcesses.clear();
  }
}
