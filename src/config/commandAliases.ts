/**
 * コマンドエイリアスの定義
 */

export interface CommandAlias {
  alias: string;
  command: string;
  description?: string;
}

export const COMMAND_ALIASES: CommandAlias[] = [
  {
    alias: 'a',
    command: 'agent',
    description: '/agentの短縮形'
  },
  {
    alias: 'ar',
    command: 'agent-repo',
    description: '/agent-repoの短縮形'
  },
  {
    alias: 'ah',
    command: 'agent-help',
    description: '/agent-helpの短縮形'
  },
  {
    alias: 'as',
    command: 'agent-status',
    description: '/agent-statusの短縮形'
  },
  {
    alias: 'ac',
    command: 'agent-clear',
    description: '/agent-clearの短縮形'
  },
  {
    alias: 'asp',
    command: 'agent-skip-permissions',
    description: '/agent-skip-permissionsの短縮形'
  },
  {
    alias: 'at',
    command: 'agent-tool',
    description: '/agent-toolの短縮形'
  },
  {
    alias: 'c',
    command: 'agent',
    description: '/agentの互換短縮形'
  },
  {
    alias: 'cr',
    command: 'agent-repo',
    description: '/agent-repoの互換短縮形'
  },
  {
    alias: 'ch',
    command: 'agent-help',
    description: '/agent-helpの互換短縮形'
  },
  {
    alias: 'cs',
    command: 'agent-status',
    description: '/agent-statusの互換短縮形'
  },
  {
    alias: 'cc',
    command: 'agent-clear',
    description: '/agent-clearの互換短縮形'
  },
  {
    alias: 'csp',
    command: 'agent-skip-permissions',
    description: '/agent-skip-permissionsの互換短縮形'
  },
  {
    alias: 'ct',
    command: 'agent-tool',
    description: '/agent-toolの互換短縮形'
  }
];

/**
 * エイリアスから実際のコマンド名を解決
 */
export function resolveCommandAlias(input: string): string {
  const alias = COMMAND_ALIASES.find(a => a.alias === input);
  return alias ? alias.command : input;
}

/**
 * コマンドのエイリアスを取得
 */
export function getCommandAliases(command: string): string[] {
  return COMMAND_ALIASES
    .filter(a => a.command === command)
    .map(a => a.alias);
}

/**
 * すべてのコマンドとエイリアスのマップを取得
 */
export function getCommandMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  
  COMMAND_ALIASES.forEach(alias => {
    const existing = map.get(alias.command) || [];
    existing.push(alias.alias);
    map.set(alias.command, existing);
  });
  
  return map;
}
