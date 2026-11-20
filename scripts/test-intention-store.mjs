import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemoryStore } from '../src/main/memory.ts';

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-intention-test-'));
  return { dir, store: new MemoryStore(dir) };
}

test('意图按时间倒序存取，当前意图只认最近半小时', () => {
  const { dir, store } = createStore();
  try {
    const now = Date.now();
    const older = store.addIntention({
      app: 'Safari',
      text: '查 passport 的文档',
      startAt: now - 60 * 60_000,
      endAt: now - 55 * 60_000,
      stepCount: 3,
      confidence: 0.7,
    });
    const latest = store.addIntention({
      app: 'Xcode',
      text: '在 Xcode 修 auth 校验',
      startAt: now - 10 * 60_000,
      endAt: now - 5 * 60_000,
      stepCount: 4,
      confidence: 0.8,
      source: 'deepseek',
    });

    assert.ok(older && latest);
    const recent = store.getRecentIntentions(5);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].id, latest.id);
    assert.equal(recent[0].source, 'deepseek');
    assert.equal(store.getCurrentIntention()?.id, latest.id);
    assert.equal(store.countIntentionsSince(now - 2 * 60 * 60_000), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('超过半小时的意图不算“当前”', () => {
  const { dir, store } = createStore();
  try {
    const now = Date.now();
    store.addIntention({
      app: 'Xcode',
      text: '修 auth 校验',
      startAt: now - 90 * 60_000,
      endAt: now - 80 * 60_000,
    });
    assert.equal(store.getCurrentIntention(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('预测记录能标记被否，并出现在拒绝列表里', () => {
  const { dir, store } = createStore();
  try {
    const pushed = store.addIntentionPrediction({
      text: '把 auth 的登录校验补上',
      app: 'Xcode',
      confidence: 0.72,
      decision: 'push',
      reason: '置信度 0.72',
    });
    assert.equal(store.getLatestPrediction().id, pushed.id);
    assert.equal(store.getLatestPrediction().outcome, undefined);

    store.setIntentionOutcome(pushed.id, 'rejected');
    const latest = store.getLatestPrediction();
    assert.equal(latest.outcome, 'rejected');
    assert.ok(latest.outcomeAt);

    const rejected = store.getRejectedPredictions(Date.now() - 60_000);
    assert.deepEqual(rejected, ['把 auth 的登录校验补上']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
