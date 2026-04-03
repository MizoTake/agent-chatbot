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
  sessionId?: string;
  /** True when the LLM only performed tool calls without producing text output. */
  toolCallsOnly?: boolean;
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
  resumeConversation?: boolean;
  sessionId?: string;
  /** Extra CLI arguments inserted before the tool's configured args. */
  extraArgs?: string[];
}

export interface ToolConfig {
  command: string;
  args?: string[];
  versionArgs?: string[];
  description?: string;
  supportsSkipPermissions?: boolean;
  /** OSS プロバイダー名 (e.g. "lmstudio", "ollama")。設定時に codex --oss フラグを付与。 */
  provider?: string;
  /** モデル名 (e.g. "qwen/qwen3.5-9b")。codex -m に渡される。 */
  model?: string;
}

export interface ToolInfo {
  name: string;
  command: string;
  args: string[];
  versionArgs: string[];
  description?: string;
  supportsSkipPermissions: boolean;
  provider?: string;
  model?: string;
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
  private resolvedCommandCache: Map<string, string>;

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
    this.resolvedCommandCache = new Map();
  }

  private normalizeTools(configs: Record<string, ToolConfig>): Map<string, ToolInfo> {
    const normalized = new Map<string, ToolInfo>();
    const defaults: Record<string, ToolConfig> = {
      claude: {
        command: 'claude',
        args: ['--dangerously-skip-permissions', '--print', '{prompt}'],
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
        supportsSkipPermissions: config.supportsSkipPermissions === true,
        provider: config.provider,
        model: config.model
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

  private ensureTaktPipelineMode(tool: ToolInfo, args: string[]): string[] {
    if (tool.name !== 'takt') {
      return args;
    }

    if (args.includes('--pipeline')) {
      return args;
    }

    return ['--pipeline', ...args];
  }

  private ensureStandardExecutionOptions(tool: ToolInfo, args: string[]): string[] {
    let normalized = [...args];

    if (tool.name === 'claude' && !normalized.includes('--dangerously-skip-permissions')) {
      normalized = ['--dangerously-skip-permissions', ...normalized];
    }

    if (tool.name === 'codex' && !normalized.includes('--sandbox') && !normalized.includes('-s')) {
      normalized = ['--sandbox', 'danger-full-access', ...normalized];
    }

    if (tool.name === 'codex') {
      // codex のコマンド構造: codex [global-opts] exec [exec-opts] [prompt]
      // --oss, -m, --local-provider はグローバルオプション (exec の前)
      // --json, --skip-git-repo-check は exec のサブコマンドオプション (exec の後)
      if (tool.provider && !normalized.includes('--oss')) {
        normalized = ['--oss', '--local-provider', tool.provider, ...normalized];
      }
      if (tool.model && !normalized.includes('--model') && !normalized.includes('-m')) {
        normalized = ['-m', tool.model, ...normalized];
      }

      // exec サブコマンドの後にオプションを挿入する
      const execIndex = normalized.indexOf('exec');
      if (execIndex >= 0) {
        const execOpts: string[] = [];
        if (!normalized.includes('--json')) {
          execOpts.push('--json');
        }
        if (!normalized.includes('--skip-git-repo-check')) {
          execOpts.push('--skip-git-repo-check');
        }
        if (execOpts.length > 0) {
          normalized = [
            ...normalized.slice(0, execIndex + 1),
            ...execOpts,
            ...normalized.slice(execIndex + 1)
          ];
        }
      }
    }

    normalized = this.ensureVibeLocalAutoApprove(tool, normalized);
    return this.ensureTaktPipelineMode(tool, normalized);
  }

  private stripCodexSandboxOption(args: string[]): { args: string[]; sandboxMode?: string } {
    const stripped: string[] = [];
    let sandboxMode: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const current = args[i];
      if ((current === '--sandbox' || current === '-s') && i + 1 < args.length) {
        if (!sandboxMode) {
          sandboxMode = args[i + 1];
        }
        i++;
        continue;
      }
      stripped.push(current);
    }

    return { args: stripped, sandboxMode };
  }

  private applyResumeOption(tool: ToolInfo, args: string[], resumeConversation: boolean, sessionId?: string): string[] {
    if (!resumeConversation) {
      return args;
    }

    if (tool.name === 'claude') {
      if (args.includes('--resume') || args.includes('-r') || args.includes('--continue') || args.includes('-c')) {
        return args;
      }
      if (sessionId) {
        // Resume specific per-channel session
        return ['--resume', sessionId, ...args];
      }
      // No stored session yet — start fresh; session ID will be captured from the response
      return args;
    }

    if (tool.name === 'codex') {
      if (args.includes('resume')) {
        return args;
      }

      const execIndex = args.indexOf('exec');
      if (execIndex < 0) {
        return args;
      }

      const beforeExec = args.slice(0, execIndex);
      const afterExec = args.slice(execIndex + 1);
      const strippedBefore = this.stripCodexSandboxOption(beforeExec);
      const strippedAfter = this.stripCodexSandboxOption(afterExec);
      const sandboxMode = strippedBefore.sandboxMode || strippedAfter.sandboxMode || 'danger-full-access';

      return [
        ...strippedBefore.args,
        '--sandbox',
        sandboxMode,
        'exec',
        'resume',
        '--last',
        ...strippedAfter.args
      ];
    }

    if (tool.name === 'vibe-local') {
      if (args.includes('--resume')) {
        return args;
      }
      return ['--resume', ...args];
    }

    if (tool.name === 'opencode') {
      if (args.includes('--session') || args.includes('-s')) {
        return args;
      }
      // args may start with a script path when using the monitor wrapper,
      // so insert --session <id> right after the 'run' subcommand, not at index 0.
      const runIndex = args.indexOf('run');
      if (runIndex < 0) {
        return args;
      }
      if (sessionId) {
        return [
          ...args.slice(0, runIndex + 1),
          '--session', sessionId,
          ...args.slice(runIndex + 1)
        ];
      }
      // No stored session yet — start fresh; session ID will be captured from the response
      return args;
    }

    if (tool.name === 'takt') {
      if (args.includes('--continue') || args.includes('-c')) {
        return args;
      }
      return ['--continue', ...args];
    }

    return args;
  }

  private isResumeUnavailableError(message: string): boolean {
    const normalized = message.toLowerCase();
    const hasResumeOrSessionKeyword = normalized.includes('resume') || normalized.includes('session');
    return (
      normalized.includes('no previous session') ||
      normalized.includes('no sessions') ||
      normalized.includes('session not found') ||
      normalized.includes('could not find session') ||
      normalized.includes('failed to resume') ||
      normalized.includes('cannot resume') ||
      normalized.includes('unable to resume') ||
      // codex: "no exec history" or similar when no previous session exists
      normalized.includes('no exec history') ||
      normalized.includes('no history') ||
      // opencode: unknown/unrecognized --session flag means no resume support in this version
      (normalized.includes('--session') && (normalized.includes('unknown') || normalized.includes('invalid') || normalized.includes('unrecognized'))) ||
      (hasResumeOrSessionKeyword && normalized.includes('not found'))
    );
  }

  /**
   * Detect transient errors in tool output that should trigger a retry,
   * even though the process exited with code 0.
   */
  private isTransientToolError(response: string): boolean {
    if (!response) return false;
    const lower = response.toLowerCase();
    return (
      // codex: LMStudio/Ollama SSE stream disconnection
      lower.includes('idle timeout waiting for sse') ||
      lower.includes('stream disconnected before completion') ||
      // Generic connection failures
      lower.includes('connection refused') ||
      lower.includes('connection reset') ||
      lower.includes('econnrefused') ||
      lower.includes('econnreset') ||
      lower.includes('socket hang up')
    );
  }

  private async executeWithRetry(prompt: string, options: ToolOptions): Promise<ToolResponse> {
    return withRetry(
      () => this.executeTool(prompt, options),
      {
        maxAttempts: 3,
        initialDelay: 2000,
        shouldRetry: (error) => {
          if (error.timedOut) return false;
          if (error.message?.includes('CLIが見つかりません')) return false;
          if (error.transient) return true;
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
  }

  private resolveRuntimeCommand(tool: ToolInfo, args: string[]): RuntimeCommand {
    const resolvedCommand = this.resolveCommandFromPath(tool.command);

    if (process.platform !== 'win32') {
      return { command: resolvedCommand, args };
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

    // Windows: .cmd/.bat ファイルは spawn(shell:false) で直接実行できないため
    // cmd.exe /c 経由で起動する
    const ext = path.extname(resolvedCommand).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      return {
        command: process.env.COMSPEC || 'cmd.exe',
        args: ['/c', resolvedCommand, ...args]
      };
    }

    return { command: resolvedCommand, args };
  }

  private resolveCommandFromPath(command: string): string {
    if (!command || path.isAbsolute(command)) {
      return command;
    }

    const cached = this.resolvedCommandCache.get(command);
    if (cached) {
      return cached;
    }

    const envPath = process.env.PATH || process.env.Path || '';
    if (!envPath) {
      return command;
    }

    // If a command already includes a separator, treat it as a direct path.
    if (command.includes('/') || command.includes('\\')) {
      return command;
    }

    const pathEntries = envPath
      .split(path.delimiter)
      .map(entry => entry.trim())
      .filter(Boolean);

    if (process.platform === 'win32') {
      const hasExtension = path.extname(command).length > 0;
      const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(ext => ext.trim())
        .filter(Boolean);
      // Windows では PATHEXT 付きファイル (.cmd, .exe 等) を優先する。
      // 拡張子なしファイルは bash 用シェルスクリプトの場合があり、
      // spawn(shell:false) で実行できない。
      const candidates = hasExtension
        ? [command]
        : [...pathExt.map(ext => `${command}${ext.toLowerCase()}`), ...pathExt.map(ext => `${command}${ext.toUpperCase()}`), command];

      for (const dir of pathEntries) {
        for (const candidate of candidates) {
          const fullPath = path.join(dir, candidate);
          if (fs.existsSync(fullPath)) {
            this.resolvedCommandCache.set(command, fullPath);
            return fullPath;
          }
        }
      }
      return command;
    }

    for (const dir of pathEntries) {
      const fullPath = path.join(dir, command);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        this.resolvedCommandCache.set(command, fullPath);
        return fullPath;
      } catch {
        // noop
      }
    }

    return command;
  }

  private processOutput(output: string): string {
    let processed = output.trim();
    // Strip ANSI color codes
    processed = processed.replace(/\x1b\[[0-9;]*m/g, '');
    // Strip non-printable control characters
    processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Strip LLM-internal special tokens: <|token_name|>
    // These leak out when local models (e.g. gpt-oss, Qwen) emit tool-call
    // control tokens as plain text.
    processed = processed.replace(/<\|[^|]{1,64}\|>/g, '');
    // Strip leaked tool-call lines such as "to=functions.read ..." that some
    // models emit before or after the actual answer.
    processed = processed.replace(/^to=\S+.*$/gm, '');
    // Strip leaked tool-call XML blocks: <tool_call>...</tool_call> or <function=...>...</function>
    // Local models sometimes emit these as plain text instead of proper tool calls.
    processed = processed.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    processed = processed.replace(/<function=[^>]*>[\s\S]*?<\/function>/g, '');
    // Strip leaked system prompt instructions that some models echo back
    processed = processed.replace(/^Continue if you have next steps.*$/gm, '');
    processed = processed.replace(/^We haven't completed any work yet\..*$/gm, '');
    // Strip common LLM filler when confused by empty tool results
    processed = processed.replace(/^What would you like help with\??\s*$/gm, '');
    // Strip codex stderr noise that may leak into response via stderr fallback
    processed = processed.replace(/^Reading additional input from stdin\.{0,3}\s*$/gm, '');
    // Collapse runs of blank lines left after stripping
    processed = processed.replace(/\n{3,}/g, '\n\n');
    return processed.trim();
  }

  /**
   * Parse opencode NDJSON output (--format json).
   * Each line is a JSON event. Text is accumulated from message.part.updated events
   * where properties.part.type === "text". The sessionID field is present on every event.
   *
   * Uses brace-depth extraction instead of newline splitting so that events concatenated
   * without a newline separator (e.g. LMStudio chunk merging) are still parsed correctly.
   */
  private extractJsonObjects(text: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return objects;
  }

  /**
   * Check whether an NDJSON event type is one that carries displayable text.
   * We accept known types explicitly and also match patterns commonly used
   * by opencode variants / different LLM backends.
   */
  private isTextEventType(eventType: string): boolean {
    // Known types observed in production
    if (eventType === 'text' || eventType === 'message.part.updated') {
      return true;
    }
    // Additional types seen in various opencode / LLM-backend versions
    if (
      eventType === 'assistant' ||
      eventType === 'content' ||
      eventType === 'message.content' ||
      eventType === 'message.delta' ||
      eventType === 'result'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Extract displayable text from an opencode event's part / properties.
   * Returns the text string or undefined if the event has no displayable text.
   */
  private extractTextFromEvent(event: any): { text: string; partId?: string } | undefined {
    const part = event.part ?? event.properties?.part;

    // Standard path: part.type === 'text' with part.text
    if (part && part.type === 'text' && typeof part.text === 'string') {
      return { text: part.text, partId: part.id };
    }

    // Fallback: part has text but part.type is not 'text' (e.g. type is missing or different)
    if (part && typeof part.text === 'string') {
      return { text: part.text, partId: part.id };
    }

    // Some backends put text directly on the event (e.g. event.text or event.content)
    if (typeof event.text === 'string' && !event.part) {
      return { text: event.text };
    }
    if (typeof event.content === 'string') {
      return { text: event.content };
    }
    if (Array.isArray(event.content)) {
      const joinedContent = event.content
        .map((item: any) => {
          if (!item || typeof item !== 'object') {
            return '';
          }
          if (typeof item.text === 'string') {
            return item.text;
          }
          if (item.type === 'output_text' && typeof item.content === 'string') {
            return item.content;
          }
          return '';
        })
        .join('');
      if (joinedContent) {
        return { text: joinedContent };
      }
    }

    // result-type events (like claude's {"type":"result","result":"..."})
    if (typeof event.result === 'string') {
      return { text: event.result };
    }
    if (typeof event.delta === 'string') {
      return { text: event.delta };
    }
    if (event.delta && typeof event.delta.text === 'string') {
      return { text: event.delta.text };
    }
    if (typeof event.output_text === 'string') {
      return { text: event.output_text };
    }
    if (event.response && typeof event.response.output_text === 'string') {
      return { text: event.response.output_text };
    }
    if (Array.isArray(event.output)) {
      const joinedOutput = event.output
        .map((item: any) => {
          if (!item || typeof item !== 'object') {
            return '';
          }
          if (typeof item.text === 'string') {
            return item.text;
          }
          if (Array.isArray(item.content)) {
            return item.content
              .map((contentItem: any) => {
                if (!contentItem || typeof contentItem !== 'object') {
                  return '';
                }
                if (typeof contentItem.text === 'string') {
                  return contentItem.text;
                }
                if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
                  return contentItem.text;
                }
                if (contentItem.type === 'output_text' && typeof contentItem.content === 'string') {
                  return contentItem.content;
                }
                return '';
              })
              .join('');
          }
          return '';
        })
        .join('');
      if (joinedOutput) {
        return { text: joinedOutput };
      }
    }

    return undefined;
  }

  private parseOpencodeJsonOutput(stdout: string): { response: string; sessionId?: string; toolCallsOnly?: boolean } {
    const objects = this.extractJsonObjects(stdout);
    const partOrder: string[] = [];
    const partTexts = new Map<string, string>();
    let sessionId: string | undefined;
    let syntheticIdCounter = 0;
    const unrecognizedEventTypes = new Set<string>();
    // Track tool calls so we can report them when text is empty
    const toolCalls: { tool: string; status?: string }[] = [];
    let finishReason: string | undefined;
    let outputTokens = 0;

    for (const raw of objects) {
      try {
        const event = JSON.parse(raw);
        if (typeof event.sessionID === 'string' && event.sessionID) {
          sessionId = event.sessionID;
        }
        // Also capture session_id (snake_case variant)
        if (!sessionId && typeof event.session_id === 'string' && event.session_id) {
          sessionId = event.session_id;
        }

        const eventType = typeof event.type === 'string' ? event.type : '';

        // Collect tool usage information
        if (eventType === 'tool_use' || eventType === 'tool_call') {
          const part = event.part ?? event.properties?.part;
          const toolName = part?.tool || part?.name || event.tool || event.name;
          const status = part?.state?.status || part?.status;
          if (toolName) {
            toolCalls.push({ tool: toolName, status });
          }
        }

        // Collect finish reason and token counts for diagnostics
        if (eventType === 'step_finish') {
          const part = event.part ?? event.properties?.part;
          if (part?.reason) {
            finishReason = part.reason;
          }
          const tokens = part?.tokens;
          if (tokens && typeof tokens.output === 'number') {
            outputTokens = tokens.output;
          }
        }

        if (this.isTextEventType(eventType)) {
          const extracted = this.extractTextFromEvent(event);
          // Only store non-empty text — opencode emits placeholder text events
          // with empty part.text when the model uses tools without prose output.
          if (extracted && extracted.text.trim()) {
            const partId = extracted.partId || `__synthetic_${syntheticIdCounter++}`;
            if (!partTexts.has(partId)) {
              partOrder.push(partId);
            }
            partTexts.set(partId, extracted.text);
          }
        } else if (eventType) {
          // Track unrecognized event types; also try extracting text from them
          // in case they carry response content under an unknown type name.
          const extracted = this.extractTextFromEvent(event);
          if (extracted && extracted.text.trim()) {
            unrecognizedEventTypes.add(eventType);
            const partId = extracted.partId || `__synthetic_${syntheticIdCounter++}`;
            if (!partTexts.has(partId)) {
              partOrder.push(partId);
            }
            partTexts.set(partId, extracted.text);
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    if (unrecognizedEventTypes.size > 0) {
      logger.info('Extracted text from unrecognized opencode event types', {
        types: Array.from(unrecognizedEventTypes),
        sessionId
      });
    }

    if (partOrder.length > 0) {
      const joined = partOrder.map(id => partTexts.get(id) ?? '').join('');
      const processed = this.processOutput(joined);
      if (processed) {
        return { response: processed, sessionId };
      }
      // processOutput stripped all content (e.g. only special tokens or whitespace).
      // Return the raw joined text so the user receives the actual LLM output.
      const rawTrimmed = joined
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/<\|[^|]{1,64}\|>/g, '')
        .trim();
      if (rawTrimmed) {
        logger.warn('processOutput stripped text-part content to empty; using raw text', {
          rawLength: joined.length,
          preview: joined.slice(0, 200)
        });
        return { response: rawTrimmed, sessionId };
      }
    }

    // No displayable text found. If the model used tools, build a summary
    // so the user knows the model did something rather than seeing "empty".
    if (toolCalls.length > 0) {
      const uniqueTools = [...new Set(toolCalls.map(tc => tc.tool))];
      const toolSummary = uniqueTools.map(t => `\`${t}\``).join(', ');
      logger.info('opencode produced tool calls but no text response', {
        tools: uniqueTools,
        outputTokens,
        finishReason,
        sessionId
      });
      return {
        response: `🔧 ツールを実行しました（${toolSummary}）が、テキスト応答はありませんでした。`,
        sessionId,
        toolCallsOnly: true
      };
    }

    // No text events and no tool calls — fall back to raw stdout.
    // Avoid returning the NDJSON itself as the response.
    const fallback = this.processOutput(stdout);
    if (fallback && !fallback.trimStart().startsWith('{')) {
      return { response: fallback, sessionId };
    }

    // Log the event types we DID see, plus a preview of raw stdout for debugging.
    const seenTypes = new Set<string>();
    for (const raw of objects) {
      try {
        const ev = JSON.parse(raw);
        if (typeof ev.type === 'string') seenTypes.add(ev.type);
      } catch { /* skip */ }
    }
    logger.warn('No text events found in opencode output', {
      stdoutLength: stdout.length,
      eventCount: objects.length,
      eventTypes: Array.from(seenTypes),
      outputTokens,
      finishReason,
      stdoutPreview: stdout.slice(0, 500),
      sessionId
    });
    return { response: '', sessionId };
  }

  /**
   * Parse stdout for tools that emit structured JSON output.
   * For claude (--output-format json) the output is:
   *   {"type":"result","result":"<text>","session_id":"<id>",...}
   * For opencode (--format json) the output is NDJSON with sessionID on each event.
   * Returns the display text and optional session_id.
   */
  private parseClaudeOutput(stdout: string): { response: string; sessionId?: string; toolCallsOnly?: boolean } | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return undefined;
    }

    const buildClaudeResponse = (objects: any[]): { response: string; sessionId?: string; toolCallsOnly?: boolean } | undefined => {
      let sessionId: string | undefined;
      const textParts: string[] = [];
      const toolNames: string[] = [];

      const visitContentArray = (content: any[]): void => {
        for (const item of content) {
          if (!item || typeof item !== 'object') {
            continue;
          }
          if (typeof item.text === 'string') {
            textParts.push(item.text);
          }
          if (item.type === 'tool_use') {
            const toolName = item.name || item.tool || item.tool_name;
            if (typeof toolName === 'string' && toolName) {
              toolNames.push(toolName);
            }
          }
        }
      };

      for (const parsed of objects) {
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        let capturedStructuredText = false;

        if (!sessionId) {
          sessionId =
            typeof parsed.session_id === 'string' ? parsed.session_id
              : typeof parsed.sessionId === 'string' ? parsed.sessionId
                : undefined;
        }

        if (typeof parsed.result === 'string') {
          textParts.push(parsed.result);
          capturedStructuredText = true;
        }
        if (Array.isArray(parsed.content)) {
          visitContentArray(parsed.content);
          capturedStructuredText = true;
        }
        if (parsed.message && Array.isArray(parsed.message.content)) {
          visitContentArray(parsed.message.content);
          capturedStructuredText = true;
        }
        if (Array.isArray(parsed.messages)) {
          for (const message of parsed.messages) {
            if (message && Array.isArray(message.content)) {
              visitContentArray(message.content);
            }
          }
          capturedStructuredText = true;
        }
        if (!capturedStructuredText) {
          const extracted = this.extractTextFromEvent(parsed);
          if (extracted?.text) {
            textParts.push(extracted.text);
          }
        }
      }

      const processedText = this.processOutput(textParts.join(''));
      if (processedText) {
        return {
          response: processedText,
          sessionId
        };
      }

      if (toolNames.length > 0) {
        const uniqueTools = [...new Set(toolNames)];
        logger.info('claude produced tool calls but no text response', {
          tools: uniqueTools,
          sessionId
        });
        return {
          response: `🔧 ツールを実行しました（${uniqueTools.map(t => `\`${t}\``).join(', ')}）が、テキスト応答はありませんでした。`,
          sessionId,
          toolCallsOnly: true
        };
      }

      return sessionId || textParts.length > 0 ? { response: processedText, sessionId } : undefined;
    };

    try {
      const parsed = JSON.parse(trimmed);
      return buildClaudeResponse([parsed]);
    } catch {
      const objects = this.extractJsonObjects(trimmed);
      if (objects.length > 0) {
        const parsedObjects = objects
          .map(raw => {
            try {
              return JSON.parse(raw);
            } catch {
              return undefined;
            }
          })
          .filter(Boolean);
        return buildClaudeResponse(parsedObjects);
      }
    }

    return undefined;
  }

  /**
   * Parse codex JSONL output (--json).
   * Events include: thread.started, turn.started, message (assistant text),
   * exec (tool calls), turn.completed, etc.
   * We extract assistant message content and thread_id as session ID.
   */
  private parseCodexJsonOutput(stdout: string): { response: string; sessionId?: string; toolCallsOnly?: boolean } {
    const objects = this.extractJsonObjects(stdout);
    let sessionId: string | undefined;
    const textParts: string[] = [];
    const toolCalls: string[] = [];
    let lastError: string | undefined;

    for (const raw of objects) {
      try {
        const event = JSON.parse(raw);

        // Capture thread ID as session
        if (typeof event.thread_id === 'string' && event.thread_id) {
          sessionId = event.thread_id;
        }
        if (typeof event.session_id === 'string' && event.session_id) {
          sessionId = event.session_id;
        }

        const eventType = typeof event.type === 'string' ? event.type : '';

        // Error events (connection failures, turn failures, etc.)
        if (eventType === 'error' || eventType === 'turn.failed') {
          const msg = event.message || event.error?.message;
          if (typeof msg === 'string') {
            lastError = msg;
          }
        }

        // Assistant text messages
        if (eventType === 'message' && event.role === 'assistant') {
          if (typeof event.content === 'string' && event.content.trim()) {
            textParts.push(event.content);
          }
          if (Array.isArray(event.content)) {
            for (const item of event.content) {
              if (item && typeof item === 'object' && typeof item.text === 'string') {
                textParts.push(item.text);
              }
            }
          }
        }

        // Fallback: any event with a content/text field from assistant
        if (!textParts.length && typeof event.content === 'string' && event.content.trim() && event.role !== 'user') {
          textParts.push(event.content);
        }

        // Tool/exec events
        if (eventType === 'exec' || eventType === 'tool_use' || eventType === 'tool_call') {
          const toolName = event.tool || event.name || 'unknown';
          toolCalls.push(toolName);
        }
      } catch {
        // Skip non-JSON
      }
    }

    const joined = textParts.join('\n');
    const processed = this.processOutput(joined);
    if (processed) {
      return { response: processed, sessionId };
    }

    if (toolCalls.length > 0) {
      const uniqueTools = [...new Set(toolCalls)];
      logger.info('codex produced tool calls but no text response', { tools: uniqueTools, sessionId });
      return {
        response: `🔧 ツールを実行しました（${uniqueTools.map(t => `\`${t}\``).join(', ')}）が、テキスト応答はありませんでした。`,
        sessionId,
        toolCallsOnly: true
      };
    }

    // If we have an error from the JSONL stream, report it
    if (lastError) {
      logger.warn('codex JSONL stream reported error', { error: lastError, sessionId });
      return { response: `⚠️ codex エラー: ${lastError}`, sessionId };
    }

    // Fallback: try processOutput on raw stdout (non-JSON output)
    const fallback = this.processOutput(stdout);
    if (fallback && !fallback.trimStart().startsWith('{')) {
      return { response: fallback, sessionId };
    }

    logger.warn('No text found in codex output', {
      stdoutLength: stdout.length,
      eventCount: objects.length,
      stdoutPreview: stdout.slice(0, 500),
      sessionId
    });
    return { response: '', sessionId };
  }

  private parseToolOutput(tool: ToolInfo, stdout: string): { response: string; sessionId?: string; toolCallsOnly?: boolean } {
    if (tool.name === 'claude') {
      const parsedClaude = this.parseClaudeOutput(stdout);
      if (parsedClaude) {
        return parsedClaude;
      }
    }

    if (tool.name === 'codex') {
      return this.parseCodexJsonOutput(stdout);
    }

    if (tool.name === 'opencode') {
      return this.parseOpencodeJsonOutput(stdout);
    }

    return { response: this.processOutput(stdout) };
  }

  private shouldLogToolStream(): boolean {
    return process.env.AGENT_CHATBOT_LOG_TOOL_STREAM === 'true';
  }

  private sanitizeLogChunk(chunk: string): string {
    return chunk
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
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
      return await this.executeWithRetry(prompt, options);
    } catch (retryError: any) {
      const retryMessage = retryError.lastError?.message || retryError.message || '';

      if (options.resumeConversation && this.isResumeUnavailableError(retryMessage)) {
        logger.warn('Resume failed, retrying without resume option', {
          tool: options.toolName || this.defaultToolName,
          error: retryMessage
        });

        try {
          return await this.executeWithRetry(prompt, {
            ...options,
            resumeConversation: false
          });
        } catch (fallbackError: any) {
          if (fallbackError.name === 'RetryError') {
            return {
              response: '',
              error: fallbackError.lastError?.message || fallbackError.message,
              timedOut: fallbackError.lastError?.timedOut
            };
          }
          return {
            response: '',
            error: fallbackError.message || '予期しないエラーが発生しました'
          };
        }
      }

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
      toolName,
      resumeConversation = false,
      sessionId,
      extraArgs
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
      let args = this.ensureStandardExecutionOptions(tool, this.buildArgs(tool, prompt));
      if (extraArgs && extraArgs.length > 0) {
        args = [...extraArgs, ...args];
      }
      args = this.applyResumeOption(tool, args, resumeConversation, sessionId);

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
      const useDetached = process.env.AGENT_CHATBOT_TOOL_DETACHED === 'true';
      const logToolStream = this.shouldLogToolStream();

      // stdin を 'pipe' にして spawn 直後に end() する。
      // 'ignore' だと cmd.exe /c 経由で codex が stdin を TTY でないと判定し
      // "Reading additional input from stdin..." で待機してしまう。
      const spawnOptions: any = {
        cwd: workingDirectory ? path.resolve(workingDirectory) : undefined,
        detached: useDetached,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
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

      // stdin を即座に閉じて、ツールが追加入力を待たないようにする
      if (toolProcess.stdin) {
        toolProcess.stdin.end();
      }

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

        if (logToolStream) {
          const sanitized = this.sanitizeLogChunk(str);
          if (sanitized) {
            logger.info('Tool stdout', {
              tool: tool.name,
              chunk: sanitized
            });
          }
        }
      });

      toolProcess.stderr?.on('data', (data) => {
        const str = data.toString('utf8');
        stderr += str;
        if (onStream && !isResolved) {
          onStream(str, true);
        }

        if (logToolStream) {
          const sanitized = this.sanitizeLogChunk(str);
          if (sanitized) {
            logger.warn('Tool stderr', {
              tool: tool.name,
              chunk: sanitized
            });
          }
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
            const parsed = this.parseToolOutput(tool, stdout);
            // When stdout parsing yields empty, check stderr for useful info.
            // Some tools write diagnostic output or even the response to stderr.
            if (!parsed.response?.trim() && stderr.trim()) {
              const processedStderr = this.processOutput(stderr);
              if (processedStderr && !processedStderr.toLowerCase().includes('deprecat')) {
                logger.warn('Tool stdout empty but stderr has content', {
                  tool: tool.name,
                  stderrLength: stderr.length,
                  stderrPreview: stderr.slice(0, 500)
                });
                // Use stderr as fallback response if it looks like actual content
                // (not just warnings/deprecation notices)
                if (!parsed.response?.trim()) {
                  parsed.response = processedStderr;
                }
              }
            }

            // If the parsed response matches a transient error pattern
            // (e.g. SSE timeout from codex), reject to trigger withRetry.
            if (this.isTransientToolError(parsed.response)) {
              const err = new Error(parsed.response);
              (err as any).transient = true;
              logger.warn('Tool exited successfully but output indicates transient error, will retry', {
                tool: tool.name,
                responsePreview: parsed.response.slice(0, 200)
              });
              reject(err);
              return;
            }

            resolve(parsed);
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
            onBackgroundComplete(this.parseToolOutput(tool, stdout));
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

        const timeoutId = setTimeout(() => {
          checkProcess.kill();
          resolve(false);
        }, 5000);

        checkProcess.stdout?.on('data', () => {
          hasOutput = true;
        });

        checkProcess.on('close', (code) => {
          clearTimeout(timeoutId);
          resolve(code === 0 || hasOutput);
        });

        checkProcess.on('error', () => {
          clearTimeout(timeoutId);
          resolve(false);
        });
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
