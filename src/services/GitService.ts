import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ConfigValidator } from '../config/validator';

const execAsync = promisify(exec);

// 最大バッファサイズを設定 (10MB)
const MAX_BUFFER = 10 * 1024 * 1024;

export interface GitCloneResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

export class GitService {
  private reposDir: string;

  constructor(reposDir: string = 'repositories') {
    this.reposDir = path.resolve(process.cwd(), reposDir);
    this.ensureReposDirectory();
  }

  private ensureReposDirectory(): void {
    if (!fs.existsSync(this.reposDir)) {
      fs.mkdirSync(this.reposDir, { recursive: true });
    }
  }

  private sanitizeRepoName(url: string): string {
    // Extract repo name from URL
    const match = url.match(/([^\/]+?)(\.git)?$/);
    if (!match) {
      return `repo-${Date.now()}`;
    }
    // パストラバーサルを防ぐため、危険な文字を除去
    return match[1]
      .replace(/\.\./g, '') // 上位ディレクトリ参照を除去
      .replace(/[^a-zA-Z0-9-_]/g, '-') // 許可された文字のみ
      .substring(0, 50); // 長さ制限
  }

  async cloneRepository(repoUrl: string, channelId: string): Promise<GitCloneResult> {
    try {
      // URLの検証
      if (!ConfigValidator.validateRepositoryUrl(repoUrl)) {
        return {
          success: false,
          error: 'Invalid repository URL'
        };
      }
      
      // チャンネルIDの検証
      if (!ConfigValidator.validateChannelId(channelId)) {
        return {
          success: false,
          error: 'Invalid channel ID'
        };
      }
      
      const repoName = this.sanitizeRepoName(repoUrl);
      const timestamp = Date.now();
      const localPath = path.join(this.reposDir, `${channelId}-${repoName}-${timestamp}`);

      // パストラバーサルチェック
      if (!ConfigValidator.validatePath(localPath, this.reposDir)) {
        return {
          success: false,
          error: 'Invalid path detected'
        };
      }

      // Check if directory already exists
      if (fs.existsSync(localPath)) {
        return {
          success: false,
          error: 'Repository directory already exists'
        };
      }

      // Clone the repository with proper escaping and buffer settings
      const { stdout, stderr } = await execAsync(
        `git clone "${repoUrl.replace(/"/g, '\\"')}" "${localPath}"`,
        {
          maxBuffer: MAX_BUFFER,
          encoding: 'utf8',
          env: { ...process.env, LANG: 'ja_JP.UTF-8', GIT_TERMINAL_PROMPT: '0' }
        }
      );
      
      // Verify clone was successful
      if (!fs.existsSync(path.join(localPath, '.git'))) {
        return {
          success: false,
          error: 'Clone appeared to succeed but no .git directory found'
        };
      }

      return {
        success: true,
        localPath
      };
    } catch (error) {
      return {
        success: false,
        error: this.formatGitError(error)
      };
    }
  }

  async pullRepository(localPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // パストラバーサルチェック
      if (!ConfigValidator.validatePath(localPath, this.reposDir)) {
        return {
          success: false,
          error: 'Invalid repository path'
        };
      }
      
      const { stdout, stderr } = await execAsync('git pull', {
        cwd: localPath,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        env: { ...process.env, LANG: 'ja_JP.UTF-8', GIT_TERMINAL_PROMPT: '0' }
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.formatGitError(error)
      };
    }
  }

  async getRepositoryStatus(localPath: string): Promise<{ success: boolean; status?: string; error?: string }> {
    try {
      // パストラバーサルチェック
      if (!ConfigValidator.validatePath(localPath, this.reposDir)) {
        return {
          success: false,
          error: 'Invalid repository path'
        };
      }
      
      const options = {
        cwd: localPath,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8' as const,
        env: { ...process.env, LANG: 'ja_JP.UTF-8' }
      };
      
      const { stdout } = await execAsync('git status --porcelain', options);
      const isDirty = stdout.trim().length > 0;
      
      const { stdout: branch } = await execAsync('git branch --show-current', options);
      
      const { stdout: remoteUrl } = await execAsync('git config --get remote.origin.url', options);
      
      return {
        success: true,
        status: `Branch: ${branch.trim()}\nRemote: ${remoteUrl.trim()}\nWorking tree: ${isDirty ? 'Modified' : 'Clean'}`
      };
    } catch (error) {
      return {
        success: false,
        error: this.formatGitError(error)
      };
    }
  }

  repositoryExists(localPath: string): boolean {
    // パストラバーサルチェック
    if (!ConfigValidator.validatePath(localPath, this.reposDir)) {
      return false;
    }
    return fs.existsSync(path.join(localPath, '.git'));
  }

  /**
   * Gitエラーメッセージをフォーマットする
   */
  private formatGitError(error: unknown): string {
    if (!(error instanceof Error)) {
      return '不明なエラーが発生しました';
    }

    let message = error.message;

    // ANSIエスケープシーケンスを削除
    message = message.replace(/\x1b\[[0-9;]*m/g, '');

    // 既知のGitエラーパターンを日本語メッセージに変換
    if (message.includes('fatal: repository') && message.includes('not found')) {
      return 'リポジトリが見つかりません。URLを確認してください。';
    }
    if (message.includes('Permission denied')) {
      return 'アクセスが拒否されました。リポジトリのアクセス権を確認してください。';
    }
    if (message.includes('Could not resolve host')) {
      return 'ホストに接続できません。ネットワーク接続を確認してください。';
    }
    if (message.includes('already exists and is not an empty directory')) {
      return 'ディレクトリが既に存在しています。';
    }
    if (message.includes('Authentication failed')) {
      return '認証に失敗しました。プライベートリポジトリの場合はアクセストークンが必要です。';
    }
    if (message.includes('timeout')) {
      return 'タイムアウトしました。ネットワーク接続またはリポジトリのサイズを確認してください。';
    }

    // コマンド出力から不要な情報を削除
    const lines = message.split('\n');
    const relevantLines = lines.filter(line => 
      !line.includes('Command failed:') && 
      line.trim().length > 0
    );
    
    return relevantLines.join('\n') || message;
  }
}