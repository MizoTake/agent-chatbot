import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConversationSessionService } from './ConversationSessionService';

test('ConversationSessionService: clear 後は resume が無効になる', () => {
  const service = new ConversationSessionService();
  assert.equal(service.shouldResumeConversation('C001'), true);
  assert.equal(service.clearConversationState('C001'), 1);
  assert.equal(service.shouldResumeConversation('C001'), false);
});

test('ConversationSessionService: markConversationActive で resume を再有効化する', () => {
  const service = new ConversationSessionService();
  service.clearConversationState('C001');
  service.markConversationActive('C001');
  assert.equal(service.shouldResumeConversation('C001'), true);
});

test('ConversationSessionService: clear 時にチャンネル配下の session を削除する', () => {
  const service = new ConversationSessionService();
  service.storeSessionId('C001', 'claude', 'ses1');
  service.storeSessionId('C001', 'codex', 'ses2');
  service.storeSessionId('C002', 'claude', 'ses3');

  service.clearConversationState('C001');

  assert.equal(service.getSessionId('C001', 'claude'), undefined);
  assert.equal(service.getSessionId('C001', 'codex'), undefined);
  assert.equal(service.getSessionId('C002', 'claude'), 'ses3');
});
