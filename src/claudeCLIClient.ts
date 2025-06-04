import { spawn } from 'child_process';

interface ClaudeResponse {
  response: string;
  error?: string;
  timedOut?: boolean;
}

interface BackgroundCallback {
  (response: ClaudeResponse): void;
}

export class ClaudeCLIClient {
  private claudeCommand: string;
  private timeout: number;

  constructor(claudeCommand: string = 'claude', timeout: number = 900000) { // 15分 (900秒) - Discordの最大応答時間に合わせる
    this.claudeCommand = claudeCommand;
    this.timeout = timeout;
  }

  async sendPrompt(prompt: string, workingDirectory?: string, onBackgroundComplete?: BackgroundCallback): Promise<ClaudeResponse> {
    return new Promise((resolve) => {
      // エスケープ処理
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      
      console.log('Executing Claude command...');
      if (workingDirectory) {
        console.log(`Working directory: ${workingDirectory}`);
      }

      // detached: true で独立したプロセスとして実行
      const claudeProcess = spawn(this.claudeCommand, ['--print', escapedPrompt], {
        cwd: workingDirectory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let timeoutId: NodeJS.Timeout;

      // タイムアウト処理 - プロセスをkillしない
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          // プロセスは継続させ、プロセスグループから切り離す
          claudeProcess.unref();
          resolve({
            response: '',
            error: 'タイムアウト: 応答時間の制限に達しました。Claudeは引き続きバックグラウンドで処理を続けています。',
            timedOut: true
          });
        }
      }, this.timeout);

      claudeProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      claudeProcess.on('close', (code) => {
        clearTimeout(timeoutId);

        if (!isResolved) {
          isResolved = true;

          if (code === 0) {
            resolve({
              response: stdout.trim()
            });
          } else {
            // エラーコードをチェック
            if (stderr.includes('command not found') || stderr.includes('not found')) {
              resolve({
                response: '',
                error: 'Claude CLIが見つかりません。Claudeがインストールされているか確認してください。'
              });
            } else if (stdout.includes('Welcome to Claude Code!')) {
              resolve({
                response: '',
                error: 'Claude CLIがインタラクティブモードで起動しています。--print フラグが正しく適用されていることを確認してください。'
              });
            } else {
              resolve({
                response: '',
                error: stderr || `プロセスがエラーコード ${code} で終了しました`
              });
            }
          }
        } else if (onBackgroundComplete) {
          // タイムアウト後に処理が完了した場合、コールバックを呼ぶ
          if (code === 0) {
            onBackgroundComplete({
              response: stdout.trim()
            });
          } else {
            onBackgroundComplete({
              response: '',
              error: stderr || `バックグラウンド処理がエラーコード ${code} で終了しました`
            });
          }
        }
      });

      claudeProcess.on('error', (err) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          
          if (err.message.includes('ENOENT')) {
            resolve({
              response: '',
              error: 'Claude CLIが見つかりません。Claudeがインストールされているか確認してください。'
            });
          } else {
            resolve({
              response: '',
              error: err.message || '予期しないエラーが発生しました'
            });
          }
        }
      });
    });
  }

  async checkAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const checkProcess = spawn('which', [this.claudeCommand], {
        shell: true
      });

      checkProcess.on('close', (code) => {
        resolve(code === 0);
      });

      checkProcess.on('error', () => {
        resolve(false);
      });
    });
  }
}