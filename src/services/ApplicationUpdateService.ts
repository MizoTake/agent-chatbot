import { spawn } from 'child_process';
import * as path from 'path';

import { createLogger } from '../utils/logger';

const logger = createLogger('ApplicationUpdateService');
const MAX_COMMAND_OUTPUT_BYTES = 5 * 1024 * 1024;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  cwd: string;
}

export interface RestartResult {
  success: boolean;
  error?: string;
}

export interface ApplicationUpdateResult {
  success: boolean;
  pulled: boolean;
  restartScheduled: boolean;
  summary: string;
  details?: string[];
}

export type CommandRunner = (command: string, args: string[], options: CommandRunnerOptions) => Promise<CommandResult>;
export type RestartScheduler = () => RestartResult;

export interface ApplicationUpdateServiceOptions {
  appDir?: string;
  runner?: CommandRunner;
  restartScheduler?: RestartScheduler;
}

interface RepositoryCheck {
  success: boolean;
  remoteUrl?: string;
  summary?: string;
}

interface AheadBehind {
  success: boolean;
  ahead: number;
  behind: number;
  summary?: string;
}

export class ApplicationUpdateService {
  private readonly appDir: string;
  private readonly runner: CommandRunner;
  private readonly restartScheduler: RestartScheduler;

  constructor(options: ApplicationUpdateServiceOptions = {}) {
    this.appDir = path.resolve(options.appDir || process.cwd());
    this.runner = options.runner || this.runCommand.bind(this);
    this.restartScheduler = options.restartScheduler || this.scheduleDefaultRestart.bind(this);
  }

  async getUpdateStatus(): Promise<ApplicationUpdateResult> {
    const repository = await this.validateGitHubRepository();
    if (!repository.success) {
      return this.failure(repository.summary || 'リポジトリ状態を確認できませんでした');
    }

    const workingTree = await this.ensureCleanWorkingTree();
    if (!workingTree.success) {
      return this.failure(workingTree.summary || '作業ツリーを確認できませんでした');
    }

    const upstream = await this.ensureUpstream();
    if (!upstream.success) {
      return this.failure(upstream.summary || 'upstream を確認できませんでした');
    }

    const fetch = await this.runGit(['fetch', '--prune', 'origin']);
    if (this.isFailure(fetch)) {
      return this.failure(`GitHub から最新情報を取得できませんでした: ${this.formatCommandError(fetch)}`);
    }

    const aheadBehind = await this.getAheadBehind();
    if (!aheadBehind.success) {
      return this.failure(aheadBehind.summary || 'GitHub との差分を確認できませんでした');
    }

    return {
      success: true,
      pulled: false,
      restartScheduled: false,
      summary: aheadBehind.behind === 0 ? '現在のブランチは GitHub の最新です。' : `GitHub に ${aheadBehind.behind} 件の未取得コミットがあります。`,
      details: [
        `origin: ${repository.remoteUrl}`,
        `upstream: ${upstream.summary}`,
        `ahead: ${aheadBehind.ahead}`,
        `behind: ${aheadBehind.behind}`
      ]
    };
  }

  async updateApplication(_action: string = 'pull'): Promise<ApplicationUpdateResult> {
    const repository = await this.validateGitHubRepository();
    if (!repository.success) {
      return this.failure(repository.summary || 'リポジトリ状態を確認できませんでした');
    }

    const workingTree = await this.ensureCleanWorkingTree();
    if (!workingTree.success) {
      return this.failure(workingTree.summary || '作業ツリーを確認できませんでした');
    }

    const upstream = await this.ensureUpstream();
    if (!upstream.success) {
      return this.failure(upstream.summary || 'upstream を確認できませんでした');
    }

    const fetch = await this.runGit(['fetch', '--prune', 'origin']);
    if (this.isFailure(fetch)) {
      return this.failure(`GitHub から最新情報を取得できませんでした: ${this.formatCommandError(fetch)}`);
    }

    const aheadBehind = await this.getAheadBehind();
    if (!aheadBehind.success) {
      return this.failure(aheadBehind.summary || 'GitHub との差分を確認できませんでした');
    }

    if (aheadBehind.behind === 0) {
      return {
        success: true,
        pulled: false,
        restartScheduled: false,
        summary: aheadBehind.ahead > 0 ? `現在のブランチは GitHub より ${aheadBehind.ahead} 件進んでいます。未取得コミットはないため再起動しません。` : '現在のブランチは GitHub の最新です。再起動は行いません。',
        details: [`origin: ${repository.remoteUrl}`, `upstream: ${upstream.summary}`]
      };
    }

    if (aheadBehind.ahead > 0) {
      return this.failure(`ローカルブランチと GitHub が分岐しています（ahead ${aheadBehind.ahead}, behind ${aheadBehind.behind}）。手動で解決してください。`);
    }

    const beforeHead = await this.runGit(['rev-parse', 'HEAD']);
    if (this.isFailure(beforeHead)) {
      return this.failure(`更新前のコミットを確認できませんでした: ${this.formatCommandError(beforeHead)}`);
    }

    const pull = await this.runGit(['pull', '--ff-only']);
    if (this.isFailure(pull)) {
      return this.failure(`git pull --ff-only に失敗しました: ${this.formatCommandError(pull)}`);
    }

    const afterHead = await this.runGit(['rev-parse', 'HEAD']);
    if (this.isFailure(afterHead)) {
      return this.failure(`更新後のコミットを確認できませんでした: ${this.formatCommandError(afterHead)}`);
    }

    const changedFiles = await this.getChangedFiles(beforeHead.stdout.trim(), afterHead.stdout.trim());
    if (changedFiles.some(file => file === 'package.json' || file === 'package-lock.json')) {
      const install = await this.runNpm(['install']);
      if (this.isFailure(install)) {
        return this.failure(`npm install に失敗しました: ${this.formatCommandError(install)}`);
      }
    }

    const build = await this.runNpm(['run', 'build']);
    if (this.isFailure(build)) {
      return this.failure(`ビルドに失敗したため再起動しません: ${this.formatCommandError(build)}`);
    }

    const restart = this.restartScheduler();
    if (!restart.success) {
      return {
        success: false,
        pulled: true,
        restartScheduled: false,
        summary: `更新とビルドは完了しましたが、再起動予約に失敗しました: ${restart.error || '不明なエラー'}`,
        details: [`更新前: ${beforeHead.stdout.trim()}`, `更新後: ${afterHead.stdout.trim()}`]
      };
    }

    return {
      success: true,
      pulled: true,
      restartScheduled: true,
      summary: 'GitHub から最新を pull し、ビルド後にアプリの再起動を予約しました。',
      details: [`更新前: ${beforeHead.stdout.trim()}`, `更新後: ${afterHead.stdout.trim()}`, `変更ファイル数: ${changedFiles.length}`]
    };
  }

  restartApplication(): RestartResult {
    return this.restartScheduler();
  }

  private failure(summary: string): ApplicationUpdateResult {
    return {
      success: false,
      pulled: false,
      restartScheduled: false,
      summary
    };
  }

  private async validateGitHubRepository(): Promise<RepositoryCheck> {
    const inside = await this.runGit(['rev-parse', '--is-inside-work-tree']);
    if (this.isFailure(inside) || inside.stdout.trim() !== 'true') {
      return {
        success: false,
        summary: 'このアプリケーションの実行ディレクトリが Git リポジトリではありません。'
      };
    }

    const remote = await this.runGit(['remote', 'get-url', 'origin']);
    if (this.isFailure(remote)) {
      return {
        success: false,
        summary: `origin remote を確認できませんでした: ${this.formatCommandError(remote)}`
      };
    }

    const remoteUrl = remote.stdout.trim();
    if (!remoteUrl.includes('github.com')) {
      return {
        success: false,
        summary: `origin が GitHub ではないため自動更新を中止しました: ${remoteUrl}`
      };
    }

    return {
      success: true,
      remoteUrl
    };
  }

  private async ensureCleanWorkingTree(): Promise<RepositoryCheck> {
    const status = await this.runGit(['status', '--porcelain']);
    if (this.isFailure(status)) {
      return {
        success: false,
        summary: `作業ツリー状態を確認できませんでした: ${this.formatCommandError(status)}`
      };
    }

    const dirtyLines = status.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (dirtyLines.length > 0) {
      return {
        success: false,
        summary: `未コミットの変更があるため自動更新を中止しました。先に commit/stash してください。\n${dirtyLines.slice(0, 10).join('\n')}`
      };
    }

    return { success: true };
  }

  private async ensureUpstream(): Promise<RepositoryCheck> {
    const upstream = await this.runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (this.isFailure(upstream)) {
      return {
        success: false,
        summary: `現在のブランチに upstream が設定されていません: ${this.formatCommandError(upstream)}`
      };
    }

    return {
      success: true,
      summary: upstream.stdout.trim()
    };
  }

  private async getAheadBehind(): Promise<AheadBehind> {
    const result = await this.runGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    if (this.isFailure(result)) {
      return {
        success: false,
        ahead: 0,
        behind: 0,
        summary: `GitHub との差分を確認できませんでした: ${this.formatCommandError(result)}`
      };
    }

    const [aheadText, behindText] = result.stdout.trim().split(/\s+/);
    const ahead = Number(aheadText);
    const behind = Number(behindText);
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
      return {
        success: false,
        ahead: 0,
        behind: 0,
        summary: `GitHub との差分出力を解釈できませんでした: ${result.stdout.trim()}`
      };
    }

    return {
      success: true,
      ahead,
      behind
    };
  }

  private async getChangedFiles(beforeHead: string, afterHead: string): Promise<string[]> {
    if (!beforeHead || !afterHead || beforeHead === afterHead) {
      return [];
    }

    const diff = await this.runGit(['diff', '--name-only', beforeHead, afterHead]);
    if (this.isFailure(diff)) {
      logger.warn('Failed to inspect changed files after update', { error: this.formatCommandError(diff) });
      return [];
    }

    return diff.stdout.trim().split(/\r?\n/).map(file => file.trim()).filter(Boolean);
  }

  private runGit(args: string[]): Promise<CommandResult> {
    return this.runner('git', args, { cwd: this.appDir });
  }

  private runNpm(args: string[]): Promise<CommandResult> {
    return this.runner('npm', args, { cwd: this.appDir });
  }

  private isFailure(result: CommandResult): boolean {
    return result.exitCode !== 0;
  }

  private formatCommandError(result: CommandResult): string {
    const output = `${result.stderr}\n${result.stdout}`.trim();
    return output || `exit code ${result.exitCode}`;
  }

  private runCommand(command: string, args: string[], options: CommandRunnerOptions): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
          GIT_TERMINAL_PROMPT: '0'
        },
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      const appendOutput = (current: string, chunk: Buffer): string => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
          return current;
        }
        return current + chunk.toString('utf8');
      };

      child.stdout?.on('data', chunk => {
        stdout = appendOutput(stdout, chunk);
      });
      child.stderr?.on('data', chunk => {
        stderr = appendOutput(stderr, chunk);
      });
      child.on('close', code => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        });
      });
      child.on('error', error => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: error.message
        });
      });
    });
  }

  private scheduleDefaultRestart(): RestartResult {
    try {
      const mode = (process.env.AGENT_CHATBOT_RESTART_MODE || '').trim().toLowerCase();
      const signalDelayMs = this.parsePositiveInt(process.env.AGENT_CHATBOT_RESTART_SIGNAL_DELAY_MS, 5000);

      if (mode === 'exit') {
        setTimeout(() => this.signalCurrentProcess(), signalDelayMs);
        return { success: true };
      }

      const restartCommand = process.env.AGENT_CHATBOT_RESTART_COMMAND?.trim() || 'npm start';
      const startDelaySeconds = this.parsePositiveInt(process.env.AGENT_CHATBOT_RESTART_START_DELAY_SECONDS, 8);
      this.spawnDelayedRestart(restartCommand, startDelaySeconds);
      setTimeout(() => this.signalCurrentProcess(), signalDelayMs);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to schedule application restart', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: message
      };
    }
  }

  private spawnDelayedRestart(restartCommand: string, startDelaySeconds: number): void {
    const child = process.platform === 'win32'
      ? spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `timeout /t ${startDelaySeconds} /nobreak >nul && ${restartCommand}`], {
        cwd: this.appDir,
        detached: true,
        env: process.env,
        stdio: 'ignore',
        windowsHide: true
      })
      : spawn('sh', ['-c', `sleep ${startDelaySeconds}; exec ${restartCommand}`], {
        cwd: this.appDir,
        detached: true,
        env: process.env,
        stdio: 'ignore'
      });

    child.unref();
  }

  private signalCurrentProcess(): void {
    try {
      process.kill(process.pid, 'SIGTERM');
    } catch (error) {
      logger.warn('Failed to send SIGTERM to current process, exiting directly', { error: error instanceof Error ? error.message : String(error) });
      process.exit(0);
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
