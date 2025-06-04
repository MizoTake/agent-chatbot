import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    return match[1].replace(/[^a-zA-Z0-9-_]/g, '-');
  }

  async cloneRepository(repoUrl: string, channelId: string): Promise<GitCloneResult> {
    try {
      const repoName = this.sanitizeRepoName(repoUrl);
      const timestamp = Date.now();
      const localPath = path.join(this.reposDir, `${channelId}-${repoName}-${timestamp}`);

      // Check if directory already exists
      if (fs.existsSync(localPath)) {
        return {
          success: false,
          error: 'Repository directory already exists'
        };
      }

      // Clone the repository
      const { stdout, stderr } = await execAsync(`git clone "${repoUrl}" "${localPath}"`);
      
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
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async pullRepository(localPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { stdout, stderr } = await execAsync('git pull', { cwd: localPath });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getRepositoryStatus(localPath: string): Promise<{ success: boolean; status?: string; error?: string }> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: localPath });
      const isDirty = stdout.trim().length > 0;
      
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: localPath });
      
      const { stdout: remoteUrl } = await execAsync('git config --get remote.origin.url', { cwd: localPath });
      
      return {
        success: true,
        status: `Branch: ${branch.trim()}\nRemote: ${remoteUrl.trim()}\nWorking tree: ${isDirty ? 'Modified' : 'Clean'}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  repositoryExists(localPath: string): boolean {
    return fs.existsSync(path.join(localPath, '.git'));
  }
}