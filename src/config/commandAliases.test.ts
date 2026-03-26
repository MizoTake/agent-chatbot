import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommandAlias, getCommandAliases, getCommandMap, COMMAND_ALIASES } from './commandAliases';

test('resolveCommandAlias: 登録済みエイリアスを実コマンドに解決する', () => {
  assert.equal(resolveCommandAlias('a'), 'agent');
  assert.equal(resolveCommandAlias('ar'), 'agent-repo');
  assert.equal(resolveCommandAlias('ah'), 'agent-help');
  assert.equal(resolveCommandAlias('as'), 'agent-status');
  assert.equal(resolveCommandAlias('ac'), 'agent-clear');
  assert.equal(resolveCommandAlias('at'), 'agent-tool');
  assert.equal(resolveCommandAlias('asp'), 'agent-skip-permissions');
});

test('resolveCommandAlias: 未登録の入力はそのまま返す', () => {
  assert.equal(resolveCommandAlias('agent'), 'agent');
  assert.equal(resolveCommandAlias('unknown-cmd'), 'unknown-cmd');
  assert.equal(resolveCommandAlias(''), '');
});

test('getCommandAliases: コマンドに対応するエイリアス一覧を返す', () => {
  const aliases = getCommandAliases('agent');
  assert.ok(aliases.includes('a'), 'a should be an alias for agent');
  assert.ok(aliases.includes('c'), 'c should be an alias for agent');
});

test('getCommandAliases: 存在しないコマンドは空配列を返す', () => {
  const aliases = getCommandAliases('no-such-command');
  assert.deepEqual(aliases, []);
});

test('getCommandMap: すべてのコマンドのマップを返す', () => {
  const map = getCommandMap();
  assert.ok(map instanceof Map);
  assert.ok(map.has('agent'));
  assert.ok(map.has('agent-repo'));
  assert.ok(map.has('agent-tool'));
  assert.ok(map.has('agent-clear'));
  assert.ok(map.has('agent-help'));
  assert.ok(map.has('agent-status'));
  assert.ok(map.has('agent-skip-permissions'));
});

test('COMMAND_ALIASES: エイリアスは重複していない', () => {
  const aliases = COMMAND_ALIASES.map(a => a.alias);
  const unique = new Set(aliases);
  assert.equal(unique.size, aliases.length, 'All aliases should be unique');
});

test('COMMAND_ALIASES: すべてのエイリアスは resolveCommandAlias で解決できる', () => {
  for (const { alias, command } of COMMAND_ALIASES) {
    assert.equal(resolveCommandAlias(alias), command, `Alias '${alias}' should resolve to '${command}'`);
  }
});
