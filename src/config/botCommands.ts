export const BOT_COMMANDS = {
  agent: 'agent',
  codex: 'codex',
  goal: 'goal',
  repository: 'agent-repo',
  tool: 'agent-tool',
  codexModel: 'codex-model',
  update: 'agent-update',
  status: 'agent-status',
  clear: 'agent-clear',
  help: 'agent-help',
  restart: 'agent-restart'
} as const;

export const DISPLAYED_SLASH_COMMANDS = [
  BOT_COMMANDS.agent,
  BOT_COMMANDS.codex,
  BOT_COMMANDS.goal,
  BOT_COMMANDS.repository,
  BOT_COMMANDS.tool,
  BOT_COMMANDS.codexModel,
  BOT_COMMANDS.update,
  BOT_COMMANDS.status,
  BOT_COMMANDS.clear,
  BOT_COMMANDS.help,
  BOT_COMMANDS.restart
] as const;
