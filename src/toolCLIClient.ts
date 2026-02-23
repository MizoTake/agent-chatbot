import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { withRetry, isRetryableError } from './utils/retry';
import { createLogger } from './utils/logger';

const logger = createLogger('ToolCLIClient');

export interface ToolResponse {
  response: string;
  error?: string;
  timedOut?: boolean;
}

interface BackgroundCallback {
  (response: ToolResponse): void;
}

interface StreamCallback {
  (chunk: string, isError: boolean): void;
}

export interface ToolOptions {
  workingDirectory?: string;
  onBackgroundComplete?: BackgroundCallback;
  onStream?: StreamCallback;
  maxOutputSize?: number;
  skipPermissions?: boolean;
  toolName?: string;
}

export interface ToolConfig {
  command: string;
  args?: string[];
  versionArgs?: string[];
  description?: string;
  supportsSkipPermissions?: boolean;
}

export interface ToolInfo {
  name: string;
  command: string;
  args: string[];
  versionArgs: string[];
  description?: string;
  supportsSkipPermissions: boolean;
}

interface RuntimeCommand {
  command: string;
  args: string[];
}

export class ToolCLIClient {
  private tools: Map<string, ToolInfo>;
  private defaultToolName: string;
  private timeout: number;
  private maxOutputSize: number;
  private activeProcesses: Set<any>;

  constructor(
    toolConfigs: Record<string, ToolConfig> = {},
    defaultToolName: string = 'claude',
    timeout?: number,
    maxOutputSize: number = 10 * 1024 * 1024
  ) {
    this.tools = this.normalizeTools(toolConfigs);
    this.defaultToolName = this.resolveDefaultTool(defaultToolName);
    this.timeout = timeout || 0;
    this.maxOutputSize = maxOutputSize;
    this.activeProcesses = new Set();
  }

  private normalizeTools(configs: Record<string, ToolConfig>): Map<string, ToolInfo> {
    const normalized = new Map<string, ToolInfo>();
    const defaults: Record<string, ToolConfig> = {
      claude: {
        command: 'claude',
        args: ['--print', '{prompt}'],
        versionArgs: ['--version'],
        description: 'Anthropic Claude CLI',
        supportsSkipPermissions: true
      }
    };
    const merged = { ...defaults, ...configs };

    Object.entries(merged).forEach(([name, config]) => {
      if (!config?.command) {
        return;
      }

      const args = Array.isArray(config.args) && config.args.length > 0
        ? config.args
        : ['{prompt}'];

      const versionArgs = Array.isArray(config.versionArgs) && config.versionArgs.length > 0
        ? config.versionArgs
        : ['--version'];

      normalized.set(name, {
        name,
        command: config.command,
        args,
        versionArgs,
        description: config.description,
        supportsSkipPermissions: config.supportsSkipPermissions === true
      });
    });

    return normalized;
  }

  private resolveDefaultTool(requestedDefault: string): string {
    if (this.tools.has(requestedDefault)) {
      return requestedDefault;
    }

    if (this.tools.has('claude')) {
      return 'claude';
    }

    const first = this.tools.keys().next().value;
    return first || 'claude';
  }

  private buildArgs(tool: ToolInfo, prompt: string): string[] {
    const hasPromptPlaceholder = tool.args.some(arg => arg.includes('{prompt}'));
    const args = tool.args.map(arg => arg.split('{prompt}').join(prompt));

    if (!hasPromptPlaceholder) {
      args.push(prompt);
    }

    return args;
  }

  private ensureVibeLocalAutoApprove(tool: ToolInfo, args: string[]): string[] {
    if (tool.name !== 'vibe-local') {
      return args;
    }

    if (args.includes('-y') || args.includes('--yes')) {
      return args;
    }

    return ['-y', ...args];
  }

  private resolveRuntimeCommand(tool: ToolInfo, args: string[]): RuntimeCommand {
    if (process.platform !== 'win32') {
      return { command: tool.command, args };
    }

    if (tool.name === 'vibe-local') {
      const userProfile = process.env.USERPROFILE;
      const scriptPath = userProfile
        ? path.join(userProfile, '.local', 'bin', 'vibe-local.ps1')
        : '';

      if (scriptPath && fs.existsSync(scriptPath)) {
        const normalizedArgs = args.map(arg => arg === '-p' ? '--prompt' : arg);
        return {
          command: 'powershell.exe',
          args: ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...normalizedArgs]
        };
      }
    }

    return { command: tool.command, args };
  }

  private processOutput(output: string): string {
    let processed = output.trim();
    processed = processed.replace(/\x1b\[[0-9;]*m/g, '');
    processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    processed = processed.replace(/\n{3,}/g, '\n\n');
    return processed;
  }

  private formatError(stderr: string, code: number | null, isBackground: boolean = false): string {
    const processedError = this.processOutput(stderr);

    if (processedError) {
      if (processedError.includes('Permission denied')) {
        return `権限エラー: ファイルまたはディレクトリへのアクセス権がありません\n${processedError}`;
      }
      if (processedError.includes('No such file or directory')) {
        return `ファイル/ディレクトリが見つかりません\n${processedError}`;
      }
      if (processedError.toLowerCase().includes('timeout')) {
        return `タイムアウト: 処理が長時間かかっています\n${processedError}`;
      }
      return processedError;
    }

    const prefix = isBackground ? 'バックグラウンド処理' : 'プロセス';
    return `${prefix}がエラーコード ${code} で終了しました`;
  }

  private resolveTool(toolName?: string): ToolInfo {
    const selected = toolName || this.defaultToolName;
    const tool = this.tools.get(selected);
    if (!tool) {
      throw new Error(`未対応のツールです: ${selected}`);
    }
    return tool;
  }

  listTools(): ToolInfo[] {
    return Array.from(this.tools.values());
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  getDefaultToolName(): string {
    return this.defaultToolName;
  }

  async sendPrompt(prompt: string, options: ToolOptions = {}): Promise<ToolResponse> {
    try {
      return await withRetry(
        () => this.executeTool(prompt, options),
        {
          maxAttempts: 3,
          initialDelay: 2000,
          shouldRetry: (error) => {
            if (error.timedOut) return false;
            if (error.message?.includes('CLIが見つかりません')) return false;
            return isRetryableError(error);
          },
          onRetry: (error, attempt) => {
            logger.warn('Retrying tool command', {
              attempt,
              error: error.message
            });
          }
        }
      );
    } catch (retryError: any) {
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

  private async executeTool(prompt: string, options: ToolOptions): Promise<ToolResponse> {
    const {
      workingDirectory,
      onBackgroundComplete,
      onStream,
      maxOutputSize = this.maxOutputSize,
      skipPermissions = false,
      toolName
    } = options;

    const tool = this.resolveTool(toolName);

    return new Promise((resolve, reject) => {
      logger.debug('Executing tool command', {
        tool: tool.name,
        command: tool.command,
        workingDirectory: workingDirectory || 'current',
        timeout: this.timeout,
        maxOutputSize,
        skipPermissions
      });

      let command = tool.command;
      let args = this.ensureVibeLocalAutoApprove(tool, this.buildArgs(tool, prompt));

      const forceAllowRoot = process.env.CLAUDE_FORCE_ALLOW_ROOT === 'true';
      const runAsUser = process.env.CLAUDE_RUN_AS_USER;
      const canSkipPermissions = skipPermissions && tool.supportsSkipPermissions;

      if (canSkipPermissions && process.getuid && process.getuid() === 0 && !forceAllowRoot) {
        if (runAsUser) {
          command = 'sudo';
          args = ['-u', runAsUser, tool.command, ...args];
        } else {
          command = 'sudo';
          args = ['-u', 'agent-chatbot', tool.command, ...args];
        }
      }

      if (skipPermissions && !tool.supportsSkipPermissions) {
        logger.warn('skipPermissions requested but tool does not support it', { tool: tool.name });
      }

      const runtime = this.resolveRuntimeCommand(tool, args);
      command = runtime.command;
      args = runtime.args;
      const useDetached = !(process.platform === 'win32' && tool.name === 'vibe-local');

      const spawnOptions: any = {
        cwd: workingDirectory ? path.resolve(workingDirectory) : undefined,
        detached: useDetached,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: {
          ...process.env,
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
          ...(canSkipPermissions && process.env.CLAUDE_FORCE_ALLOW_ROOT !== 'true'
            ? { USER: 'agent-chatbot', HOME: '/tmp/agent-chatbot' }
            : {})
        }
      };

      const toolProcess = spawn(command, args, spawnOptions);

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let timeoutId: NodeJS.Timeout;
      let outputSize = 0;
      let outputTruncated = false;

      if (this.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            toolProcess.unref();

            logger.warn('Tool process timed out', {
              tool: tool.name,
              timeout_ms: this.timeout,
              workingDirectory
            });

            resolve({
              response: '',
              error: 'タイムアウト: 応答時間の制限に達しました。処理はバックグラウンドで継続しています。',
              timedOut: true
            });
          }
        }, this.timeout);
      }

      this.activeProcesses.add(toolProcess);

      toolProcess.stdout?.on('data', (data) => {
        const str = data.toString('utf8');
        outputSize += Buffer.byteLength(str, 'utf8');

        if (outputSize > maxOutputSize) {
          if (!outputTruncated) {
            stdout += '\n\n[出力が最大サイズを超えたため切り詰められました]';
            outputTruncated = true;
          }
          return;
        }

        stdout += str;
        if (onStream && !isResolved) {
          onStream(str, false);
        }
      });

      toolProcess.stderr?.on('data', (data) => {
        const str = data.toString('utf8');
        stderr += str;
        if (onStream && !isResolved) {
          onStream(str, true);
        }
      });

      toolProcess.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.activeProcesses.delete(toolProcess);

        if (!isResolved) {
          isResolved = true;

          if (code === 0) {
            resolve({
              response: this.processOutput(stdout)
            });
          } else {
            if (stderr.includes('command not found') || stderr.includes('not found')) {
              reject(new Error(`${tool.name} CLIが見つかりません。インストールとPATH設定を確認してください。`));
            } else {
              const errorMessage = this.formatError(stderr, code);
              const error = new Error(errorMessage);
              (error as any).code = code;
              (error as any).stderr = stderr;
              reject(error);
            }
          }
        } else if (onBackgroundComplete) {
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

      toolProcess.on('error', (err) => {
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          this.activeProcesses.delete(toolProcess);

          if (err.message.includes('ENOENT')) {
            reject(new Error(`${tool.name} CLIが見つかりません。インストールとPATH設定を確認してください。`));
          } else {
            reject(err);
          }
        }
      });
    });
  }

  async checkAvailability(toolName?: string): Promise<boolean> {
    try {
      const tool = this.resolveTool(toolName);
      const versionArgs = this.ensureVibeLocalAutoApprove(tool, [...tool.versionArgs]);

      return new Promise((resolve) => {
        const runtime = this.resolveRuntimeCommand(tool, versionArgs);
        const checkProcess = spawn(runtime.command, runtime.args, {
          shell: false,
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

        setTimeout(() => {
          checkProcess.kill();
          resolve(false);
        }, 5000);
      });
    } catch {
      return false;
    }
  }

  cleanup(): void {
    this.activeProcesses.forEach(process => {
      try {
        process.kill('SIGTERM');
      } catch {
        // noop
      }
    });
    this.activeProcesses.clear();
  }
}
