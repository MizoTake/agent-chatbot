import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApplicationUpdateService, CommandResult } from './ApplicationUpdateService';

interface ExpectedCommand extends CommandResult {
  command: string;
  args: string[];
}

function createSequenceRunner(expectedCommands: ExpectedCommand[]) {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runner = async (command: string, args: string[], options: { cwd: string }): Promise<CommandResult> => {
    calls.push({ command, args, cwd: options.cwd });
    const expected = expectedCommands.shift();
    if (!expected) {
      return { exitCode: 99, stdout: '', stderr: `unexpected command: ${command} ${args.join(' ')}` };
    }
    assert.equal(command, expected.command);
    assert.deepEqual(args, expected.args);
    return {
      exitCode: expected.exitCode,
      stdout: expected.stdout,
      stderr: expected.stderr
    };
  };
  return { runner, calls };
}

function git(args: string[], stdout: string = '', exitCode: number = 0, stderr: string = ''): ExpectedCommand {
  return { command: 'git', args, stdout, exitCode, stderr };
}

function npm(args: string[], stdout: string = '', exitCode: number = 0, stderr: string = ''): ExpectedCommand {
  return { command: 'npm', args, stdout, exitCode, stderr };
}

test('ApplicationUpdateService: 作業ツリーが dirty なら pull せず失敗する', async () => {
  let restartCalled = false;
  const { runner, calls } = createSequenceRunner([
    git(['rev-parse', '--is-inside-work-tree'], 'true\n'),
    git(['remote', 'get-url', 'origin'], 'https://github.com/example/agent-chatbot.git\n'),
    git(['status', '--porcelain'], 'M src/index.ts\n')
  ]);
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner,
    restartScheduler: () => {
      restartCalled = true;
      return { success: true };
    }
  });

  const result = await service.updateApplication();

  assert.equal(result.success, false);
  assert.match(result.summary, /未コミット/);
  assert.equal(restartCalled, false);
  assert.equal(calls.some(call => call.command === 'git' && call.args[0] === 'pull'), false);
});

test('ApplicationUpdateService: GitHub origin でなければ更新を中止する', async () => {
  const { runner } = createSequenceRunner([
    git(['rev-parse', '--is-inside-work-tree'], 'true\n'),
    git(['remote', 'get-url', 'origin'], 'https://gitlab.com/example/agent-chatbot.git\n')
  ]);
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner,
    restartScheduler: () => ({ success: true })
  });

  const result = await service.updateApplication();

  assert.equal(result.success, false);
  assert.match(result.summary, /GitHub/);
});

test('ApplicationUpdateService: behind がなければ pull も再起動もしない', async () => {
  let restartCalled = false;
  const { runner, calls } = createSequenceRunner([
    git(['rev-parse', '--is-inside-work-tree'], 'true\n'),
    git(['remote', 'get-url', 'origin'], 'git@github.com:example/agent-chatbot.git\n'),
    git(['status', '--porcelain'], ''),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 'origin/main\n'),
    git(['fetch', '--prune', 'origin'], ''),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], '0\t0\n')
  ]);
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner,
    restartScheduler: () => {
      restartCalled = true;
      return { success: true };
    }
  });

  const result = await service.updateApplication();

  assert.equal(result.success, true);
  assert.equal(result.pulled, false);
  assert.equal(result.restartScheduled, false);
  assert.match(result.summary, /最新/);
  assert.equal(restartCalled, false);
  assert.equal(calls.some(call => call.command === 'git' && call.args[0] === 'pull'), false);
});

test('ApplicationUpdateService: pull と build が成功したら再起動を予約する', async () => {
  let restartCalled = false;
  const { runner } = createSequenceRunner([
    git(['rev-parse', '--is-inside-work-tree'], 'true\n'),
    git(['remote', 'get-url', 'origin'], 'https://github.com/example/agent-chatbot.git\n'),
    git(['status', '--porcelain'], ''),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 'origin/main\n'),
    git(['fetch', '--prune', 'origin'], ''),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], '0\t2\n'),
    git(['rev-parse', 'HEAD'], 'old\n'),
    git(['pull', '--ff-only'], 'Updating old..new\n'),
    git(['rev-parse', 'HEAD'], 'new\n'),
    git(['diff', '--name-only', 'old', 'new'], 'package-lock.json\nsrc/index.ts\n'),
    npm(['install'], 'installed\n'),
    npm(['run', 'build'], 'built\n')
  ]);
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner,
    restartScheduler: () => {
      restartCalled = true;
      return { success: true };
    }
  });

  const result = await service.updateApplication();

  assert.equal(result.success, true);
  assert.equal(result.pulled, true);
  assert.equal(result.restartScheduled, true);
  assert.equal(restartCalled, true);
  assert.match(result.summary, /再起動/);
});

test('ApplicationUpdateService: build が失敗したら再起動しない', async () => {
  let restartCalled = false;
  const { runner } = createSequenceRunner([
    git(['rev-parse', '--is-inside-work-tree'], 'true\n'),
    git(['remote', 'get-url', 'origin'], 'https://github.com/example/agent-chatbot.git\n'),
    git(['status', '--porcelain'], ''),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 'origin/main\n'),
    git(['fetch', '--prune', 'origin'], ''),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], '0\t1\n'),
    git(['rev-parse', 'HEAD'], 'old\n'),
    git(['pull', '--ff-only'], 'Updating old..new\n'),
    git(['rev-parse', 'HEAD'], 'new\n'),
    git(['diff', '--name-only', 'old', 'new'], 'src/index.ts\n'),
    npm(['run', 'build'], '', 1, 'tsc failed\n')
  ]);
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner,
    restartScheduler: () => {
      restartCalled = true;
      return { success: true };
    }
  });

  const result = await service.updateApplication();

  assert.equal(result.success, false);
  assert.equal(result.restartScheduled, false);
  assert.equal(restartCalled, false);
  assert.match(result.summary, /ビルド/);
});

test('ApplicationUpdateService: restartApplication は restartScheduler の結果を返す', () => {
  let restartCalled = false;
  const service = new ApplicationUpdateService({
    appDir: 'D:/Project/agent-chatbot',
    runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    restartScheduler: () => {
      restartCalled = true;
      return { success: true };
    }
  });

  const result = service.restartApplication();

  assert.deepEqual(result, { success: true });
  assert.equal(restartCalled, true);
});
