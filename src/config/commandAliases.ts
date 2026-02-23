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
    alias: 'c',
    command: 'claude',
    description: '/claudeの短縮形'
  },
  {
    alias: 'cr',
    command: 'claude-repo',
    description: '/claude-repoの短縮形'
  },
  {
    alias: 'ch',
    command: 'claude-help',
    description: '/claude-helpの短縮形'
  },
  {
    alias: 'cs',
    command: 'claude-status',
    description: '/claude-statusの短縮形'
  },
  {
    alias: 'cc',
    command: 'claude-clear',
    description: '/claude-clearの短縮形'
  },
  {
    alias: 'csp',
    command: 'claude-skip-permissions',
    description: '/claude-skip-permissionsの短縮形'
  },
  {
    alias: 'ct',
    command: 'claude-tool',
    description: '/claude-toolの短縮形'
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
