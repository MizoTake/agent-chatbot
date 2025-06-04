import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ClaudeResponse {
  response: string;
  error?: string;
}

export class ClaudeCLIClient {
  private claudeCommand: string;
  private timeout: number;

  constructor(claudeCommand: string = 'claude', timeout: number = 60000) {
    this.claudeCommand = claudeCommand;
    this.timeout = timeout;
  }

  async sendPrompt(prompt: string): Promise<ClaudeResponse> {
    try {
      // エスケープ処理
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      
      // Claudeコマンドを実行
      const command = `echo '${escapedPrompt}' | ${this.claudeCommand}`;
      
      console.log('Executing Claude command...');
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 1024 * 1024 * 10 // 10MB
      });

      if (stderr && !stdout) {
        return {
          response: '',
          error: stderr
        };
      }

      return {
        response: stdout.trim()
      };
    } catch (error: any) {
      console.error('Error calling Claude CLI:', error);
      
      if (error.code === 'ENOENT') {
        return {
          response: '',
          error: 'Claude CLIが見つかりません。Claudeがインストールされているか確認してください。'
        };
      }
      
      if (error.killed && error.signal === 'SIGTERM') {
        return {
          response: '',
          error: 'タイムアウト: Claudeの応答に時間がかかりすぎました。'
        };
      }
      
      return {
        response: '',
        error: error.message || '予期しないエラーが発生しました'
      };
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`which ${this.claudeCommand}`);
      return !!stdout.trim();
    } catch {
      return false;
    }
  }
}