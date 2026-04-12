import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { BotMessage, BotResponse } from '../interfaces/BotInterface';
import { ConfigLoader } from '../config/configLoader';
import { createLogger } from '../utils/logger';
import { ChannelContextService } from './ChannelContextService';
import { ToolRuntimeService } from './ToolRuntimeService';

const logger = createLogger('WorkflowRunnerService');

export class WorkflowRunnerService {
  constructor(
    private readonly toolRuntimeService: ToolRuntimeService,
    private readonly channelContextService: ChannelContextService
  ) {}

  async runTakt(message: BotMessage): Promise<BotResponse | null> {
    if (!message.text?.trim()) {
      return {
        text: '📝 使い方',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*TAKT 実行コマンド*\n\n' +
                '• `/takt-run <タスク>` - パイプラインモードでタスクを実行\n' +
                '• `/takt-run --auto-pr <タスク>` - 実行後にPRを自動作成\n' +
                '• `/takt-run --provider claude <タスク>` - プロバイダーを指定\n' +
                '• `/takt-run --piece dual <タスク>` - ピースを指定\n' +
                '• `/takt-run --model provider/model <タスク>` - モデルを指定\n\n' +
                '_`--pipeline` は自動付与されます。_'
            }
          }
        ]
      };
    }

    const toolClient = this.toolRuntimeService.getToolClient();
    if (!toolClient.hasTool('takt')) {
      return {
        text: '❌ takt ツールが登録されていません。設定を確認してください。'
      };
    }

    const isAvailable = await toolClient.checkAvailability('takt');
    if (!isAvailable) {
      return {
        text: '❌ takt CLI が見つかりません。`npm install -g takt` でインストールしてください。'
      };
    }

    const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
    if (resolvedRepository.error) {
      return {
        text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
      };
    }

    const input = message.text.trim();
    const taktFlags: string[] = [];
    const promptParts: string[] = [];
    const tokens = input.split(/\s+/);
    const flagsWithValue = new Set(['--provider', '--piece', '-w', '--model', '--branch', '-b']);
    const flagsBoolean = new Set(['--auto-pr', '--draft', '--skip-git', '--quiet', '-q']);

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (flagsWithValue.has(token) && index + 1 < tokens.length) {
        taktFlags.push(token, tokens[++index]);
      } else if (flagsBoolean.has(token)) {
        taktFlags.push(token);
      } else {
        promptParts.push(token);
      }
    }

    const taskPrompt = promptParts.join(' ');
    if (!taskPrompt) {
      return {
        text: '❌ タスク内容を指定してください。例: `/takt-run バグを修正してください`'
      };
    }

    logger.info('Executing takt-run command', {
      channelId: message.channelId,
      taktFlags,
      taskPrompt: taskPrompt.slice(0, 100),
      workingDirectory: resolvedRepository.repository?.localPath
    });

    const result = await toolClient.sendPrompt(taskPrompt, {
      workingDirectory: resolvedRepository.repository?.localPath,
      toolName: 'takt',
      extraArgs: taktFlags.length > 0 ? taktFlags : undefined
    });

    if (result.error) {
      return {
        text: `❌ [takt] ${result.error}`
      };
    }

    if (!result.response?.trim()) {
      return {
        text: '⚠️ [takt] タスクは実行されましたが、表示可能な応答がありませんでした。'
      };
    }

    return {
      text: result.response,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🎵 takt:*\n${result.response}`
          }
        }
      ]
    };
  }

  async runOrcha(message: BotMessage): Promise<BotResponse | null> {
    if (!message.text?.trim()) {
      return {
        text: '📝 使い方',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*orcha 実行コマンド*\n\n' +
                '• `/orcha-run <タスク>` - タスクを作成して orcha サイクルを実行\n' +
                '• `/orcha-run --profile <name> <タスク>` - プロファイルを指定して実行\n' +
                '• `/orcha-run --no-timeout <タスク>` - タイムアウトなしで実行\n' +
                '• `/orcha-run --verbose <タスク>` - 詳細ログ付きで実行\n' +
                '• `/orcha-run status` - 現在のステータスを表示\n\n' +
                '_`.orcha/` 設定は本プロジェクトのものを使用し、対象リポジトリの cwd で実行します。_'
            }
          }
        ]
      };
    }

    const orchaCommand = process.env.ORCHA_COMMAND || 'orcha';
    const orchaDirSource = path.resolve(process.cwd(), '.orcha');
    if (!fs.existsSync(orchaDirSource)) {
      return {
        text: '❌ `.orcha/` ディレクトリが見つかりません。`orcha init` で初期化してください。'
      };
    }

    const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
    if (resolvedRepository.error) {
      return {
        text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
      };
    }

    const repository = resolvedRepository.repository;
    if (!repository?.localPath) {
      return {
        text: '❌ このチャンネルにリポジトリがリンクされていません。先に `/agent-repo <URL>` でリポジトリを設定してください。'
      };
    }

    const workingDirectory = path.resolve(repository.localPath);
    const orchaDirTarget = path.join(workingDirectory, '.orcha');
    if (!fs.existsSync(orchaDirTarget)) {
      this.copyDirSync(orchaDirSource, orchaDirTarget);
      logger.info('Copied .orcha/ into target repository', {
        source: orchaDirSource,
        target: orchaDirTarget
      });
    } else {
      const sourceYmlPath = path.join(orchaDirSource, 'orcha.yml');
      const targetYmlPath = path.join(orchaDirTarget, 'orcha.yml');
      if (fs.existsSync(sourceYmlPath)) {
        fs.copyFileSync(sourceYmlPath, targetYmlPath);
      }
    }
    this.patchOrchaYmlForWindows(orchaDirTarget);

    const input = message.text.trim();
    if (input === 'status') {
      return this.buildOrchaStatusResponse(orchaDirTarget);
    }

    const orchaFlags: string[] = [];
    const promptParts: string[] = [];
    const tokens = input.split(/\s+/);
    const flagsWithValue = new Set(['--profile']);
    const flagsBoolean = new Set(['--no-timeout', '--verbose', '-v', '--reset-cycle', '--enforce-lock']);

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (flagsWithValue.has(token) && index + 1 < tokens.length) {
        orchaFlags.push(token, tokens[++index]);
      } else if (flagsBoolean.has(token)) {
        orchaFlags.push(token);
      } else {
        promptParts.push(token);
      }
    }

    const taskContent = promptParts.join(' ');
    if (!taskContent) {
      return {
        text: '❌ タスク内容を指定してください。例: `/orcha-run バグを修正してください`'
      };
    }

    const profileIndex = orchaFlags.indexOf('--profile');
    if (profileIndex >= 0 && profileIndex + 1 < orchaFlags.length) {
      const profileName = orchaFlags[profileIndex + 1];
      this.updateOrchaProfile(orchaDirTarget, profileName);
      orchaFlags.splice(profileIndex, 2);
    }

    const taskId = `T${Date.now()}`;
    const taskFilePath = this.createOrchaTaskFile(orchaDirTarget, taskId, taskContent);
    logger.info('Created orcha task file', {
      channelId: message.channelId,
      taskId,
      taskFilePath,
      workingDirectory
    });

    const args = ['run', '--reset-cycle', ...orchaFlags];
    const noTimeout = orchaFlags.includes('--no-timeout');

    logger.info('Executing orcha run', {
      channelId: message.channelId,
      orchaCommand,
      args,
      workingDirectory,
      orchaDir: orchaDirTarget
    });

    return new Promise<BotResponse>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const processInstance = spawn(orchaCommand, args, {
        cwd: workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: true,
        env: {
          ...process.env,
          LANG: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
          PYTHONIOENCODING: 'utf-8'
        }
      });

      if (processInstance.stdin) {
        processInstance.stdin.end();
      }

      let timeoutId: NodeJS.Timeout | undefined;
      if (!noTimeout) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          processInstance.kill('SIGTERM');
          resolve({
            text: '⏱️ [orcha] タイムアウトしました。バックグラウンドで処理を継続している可能性があります。\n`/orcha-run status` で状態を確認してください。'
          });
        }, ConfigLoader.get('claude.timeout', 3600000));
      }

      processInstance.stdout?.on('data', (data) => {
        stdout += data.toString('utf8');
      });

      processInstance.stderr?.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      processInstance.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (timedOut) {
          return;
        }

        if (code === 0) {
          const summary = this.readOrchaStatusSummary(orchaDirTarget);
          const outputPreview = stdout.trim().slice(-2000) || '(出力なし)';
          resolve({
            text: summary,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*🎼 orcha 完了 (タスク: ${taskId})*\n\n${summary}\n\n*出力 (末尾):*\n\`\`\`\n${outputPreview.slice(0, 1500)}\n\`\`\``
                }
              }
            ]
          });
          return;
        }

        const errorPreview = (stderr.trim() || stdout.trim()).slice(0, 1500);
        resolve({
          text: `❌ [orcha] 終了コード ${code} で失敗しました`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *orcha* がエラーコード ${code} で終了しました\n\n\`\`\`\n${errorPreview}\n\`\`\``
              }
            }
          ]
        });
      });

      processInstance.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (timedOut) {
          return;
        }
        if (error.message.includes('ENOENT')) {
          resolve({
            text: '❌ orcha CLI が見つかりません。インストールとPATH設定を確認してください。'
          });
          return;
        }
        resolve({
          text: `❌ [orcha] プロセス起動エラー: ${error.message}`
        });
      });
    });
  }

  private createOrchaTaskFile(orchaDir: string, taskId: string, taskContent: string): string {
    const taskFileName = `${taskId}.md`;
    const tasksOpenDir = path.join(orchaDir, 'tasks', 'open');
    if (!fs.existsSync(tasksOpenDir)) {
      fs.mkdirSync(tasksOpenDir, { recursive: true });
    }

    const taskFilePath = path.join(tasksOpenDir, taskFileName);
    const taskFileContent =
      `---\nid: ${taskId}\ntitle: "${taskContent.slice(0, 80).replace(/"/g, '\\"')}"\nowner: discord\ncreated: ${new Date().toISOString()}\n---\n\n## Description\n\n${taskContent}\n`;
    fs.writeFileSync(taskFilePath, taskFileContent, 'utf-8');
    return taskFilePath;
  }

  private copyDirSync(sourcePath: string, destinationPath: string): void {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      const sourceEntryPath = path.join(sourcePath, entry.name);
      const destinationEntryPath = path.join(destinationPath, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(sourceEntryPath, destinationEntryPath);
      } else {
        fs.copyFileSync(sourceEntryPath, destinationEntryPath);
      }
    }
  }

  private patchOrchaYmlForWindows(orchaDir: string): void {
    if (process.platform !== 'win32') {
      return;
    }

    const ymlPath = path.join(orchaDir, 'orcha.yml');
    if (!fs.existsSync(ymlPath)) {
      return;
    }

    let content = fs.readFileSync(ymlPath, 'utf-8');
    const originalContent = content;
    content = content.replace(
      /command:\s*"bash"\s*\n(\s*args:\s*\[)"scripts\/opencode-monitor\.sh",\s*/g,
      'command: "opencode-cli"\n$1'
    );
    content = content.replace(
      /command:\s*"bash"\s*\n(\s*args:\s*\[)/g,
      'command: "cmd.exe"\n$1"/c", '
    );

    if (content !== originalContent) {
      fs.writeFileSync(ymlPath, content, 'utf-8');
      logger.info('Patched orcha.yml for Windows: replaced bash with direct CLI commands', {
        orchaDir
      });
    }
  }

  private updateOrchaProfile(orchaDir: string, profileName: string): void {
    const ymlPath = path.join(orchaDir, 'orcha.yml');
    if (!fs.existsSync(ymlPath)) {
      return;
    }

    let content = fs.readFileSync(ymlPath, 'utf-8');
    content = content.replace(/^(\s*profile:\s*)"[^"]*"/m, `$1"${profileName}"`);
    content = content.replace(/^(\s*profile:\s*)(?!")[^\s#]+/m, `$1"${profileName}"`);
    fs.writeFileSync(ymlPath, content, 'utf-8');
    logger.info('Updated orcha profile', { orchaDir, profileName });
  }

  private readOrchaStatusSummary(orchaDir: string): string {
    const statusPath = path.join(orchaDir, 'agentworkspace', 'status.md');
    if (!fs.existsSync(statusPath)) {
      return '(status.md が見つかりません)';
    }

    const raw = fs.readFileSync(statusPath, 'utf-8');
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return raw.slice(0, 500);
    }

    const frontmatter = frontmatterMatch[1];
    const getField = (name: string): string => {
      const match = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
      return match ? match[1].trim() : '-';
    };

    return `**Cycle:** ${getField('cycle')} | **Phase:** ${getField('phase')} | **Profile:** ${getField('profile')}\n` +
      `**Review:** ${getField('review_status')} | **Verify failures:** ${getField('consecutive_verify_failures')}`;
  }

  private buildOrchaStatusResponse(orchaDir: string): BotResponse {
    const summary = this.readOrchaStatusSummary(orchaDir);
    return {
      text: summary,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🎼 orcha ステータス*\n\n${summary}`
          }
        }
      ]
    };
  }
}
