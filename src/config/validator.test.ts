import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigValidator } from './validator';

function withEnv(env: NodeJS.ProcessEnv, callback: () => void): void {
  const backup = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    PORT: process.env.PORT,
    DEBUG: process.env.DEBUG
  };

  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.PORT;
  delete process.env.DEBUG;
  Object.assign(process.env, env);

  try {
    callback();
  } finally {
    if (backup.DISCORD_BOT_TOKEN === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = backup.DISCORD_BOT_TOKEN;
    }

    if (backup.PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = backup.PORT;
    }

    if (backup.DEBUG === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = backup.DEBUG;
    }
  }
}

// ─── validateRepositoryUrl ───────────────────────────────────────────────────

test('ConfigValidator.validateRepositoryUrl: HTTPS URLを許可する', () => {
  assert.equal(ConfigValidator.validateRepositoryUrl('https://github.com/user/repo'), true);
  assert.equal(ConfigValidator.validateRepositoryUrl('https://gitlab.com/user/repo.git'), true);
  assert.equal(ConfigValidator.validateRepositoryUrl('http://internal.corp/repo'), true);
});

test('ConfigValidator.validateRepositoryUrl: git@ SSH URLを許可する', () => {
  assert.equal(ConfigValidator.validateRepositoryUrl('git@github.com:user/repo.git'), true);
  assert.equal(ConfigValidator.validateRepositoryUrl('git@gitlab.com:group/subgroup/repo.git'), true);
});

test('ConfigValidator.validateRepositoryUrl: 無効なURLを拒否する', () => {
  assert.equal(ConfigValidator.validateRepositoryUrl('ftp://example.com/repo'), false);
  assert.equal(ConfigValidator.validateRepositoryUrl('file:///etc/passwd'), false);
  assert.equal(ConfigValidator.validateRepositoryUrl('not-a-url'), false);
  assert.equal(ConfigValidator.validateRepositoryUrl(''), false);
  assert.equal(ConfigValidator.validateRepositoryUrl('local://myrepo'), false);
});

test('ConfigValidator.validateRepositoryUrl: 非対応スキームを拒否する', () => {
  // file://, ftp:// などは拒否
  assert.equal(ConfigValidator.validateRepositoryUrl('ftp://example.com/repo'), false);
  assert.equal(ConfigValidator.validateRepositoryUrl('file:///etc/passwd'), false);
  assert.equal(ConfigValidator.validateRepositoryUrl('javascript:alert(1)'), false);
});

// ─── validateChannelId ────────────────────────────────────────────────────────

test('ConfigValidator.validateChannelId: 有効なチャンネルIDを許可する', () => {
  assert.equal(ConfigValidator.validateChannelId('C1234567890'), true);
  assert.equal(ConfigValidator.validateChannelId('channel-01'), true);
  assert.equal(ConfigValidator.validateChannelId('my_channel'), true);
});

test('ConfigValidator.validateChannelId: 短すぎるIDを拒否する', () => {
  assert.equal(ConfigValidator.validateChannelId('abc'), false);
  assert.equal(ConfigValidator.validateChannelId(''), false);
});

test('ConfigValidator.validateChannelId: 長すぎるIDを拒否する', () => {
  assert.equal(ConfigValidator.validateChannelId('a'.repeat(51)), false);
});

test('ConfigValidator.validateChannelId: 特殊文字を含むIDを拒否する', () => {
  assert.equal(ConfigValidator.validateChannelId('chan nel'), false);
  assert.equal(ConfigValidator.validateChannelId('chan#el'), false);
  assert.equal(ConfigValidator.validateChannelId('../etc'), false);
});

// ─── validatePath ─────────────────────────────────────────────────────────────

test('ConfigValidator.validatePath: ベースパス内のパスを許可する', () => {
  assert.equal(ConfigValidator.validatePath('/base/repos/myrepo', '/base/repos'), true);
  assert.equal(ConfigValidator.validatePath('/base/repos', '/base/repos'), true);
});

test('ConfigValidator.validatePath: ベースパス外への参照を拒否する', () => {
  assert.equal(ConfigValidator.validatePath('/etc/passwd', '/base/repos'), false);
  assert.equal(ConfigValidator.validatePath('/base/other', '/base/repos'), false);
  assert.equal(ConfigValidator.validatePath('/base/repos-evil/project', '/base/repos'), false);
});

// ─── validateEnvironment ─────────────────────────────────────────────────────

test('ConfigValidator.validateEnvironment: 有効な Discord 設定をサニタイズする', () => {
  withEnv({
    DISCORD_BOT_TOKEN: 'discord.token.valid',
    PORT: '3000',
    DEBUG: 'true'
  }, () => {
    const actual = ConfigValidator.validateEnvironment();
    assert.equal(actual.valid, true);
    assert.deepEqual(actual.sanitized, {
      DISCORD_BOT_TOKEN: 'discord.token.valid',
      PORT: '3000',
      DEBUG: 'true'
    });
  });
});

test('ConfigValidator.validateEnvironment: Discord トークンがなければエラーにする', () => {
  withEnv({}, () => {
    const actual = ConfigValidator.validateEnvironment();
    assert.equal(actual.valid, false);
    assert.ok(actual.errors.includes('DISCORD_BOT_TOKEN is required'));
  });
});

test('ConfigValidator.validateEnvironment: 不正な Discord トークンと Port を検出する', () => {
  withEnv({
    DISCORD_BOT_TOKEN: 'short',
    PORT: '70000'
  }, () => {
    const actual = ConfigValidator.validateEnvironment();
    assert.equal(actual.valid, false);
    assert.ok(actual.errors.includes('DISCORD_BOT_TOKEN is invalid'));
    assert.ok(actual.errors.includes('PORT must be a valid port number (1-65535)'));
  });
});
