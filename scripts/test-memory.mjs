import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemoryStore } from '../src/main/memory.ts';

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-memory-test-'));
  return { dir, store: new MemoryStore(dir) };
}

test('remember / search keeps source, confidence and usage metadata', () => {
  const { dir, store } = createStore();
  try {
    const fact = store.remember('用户偏好用 TypeScript 写 Electron 桌面应用', 'preference', {
      source: 'auto',
      confidence: 0.72,
    });
    assert.ok(fact);

    const [found] = store.search('TypeScript');
    assert.equal(found.id, fact.id);
    assert.equal(found.source, 'auto');
    assert.equal(found.confidence, 0.72);

    store.getContext('TypeScript');
    const [used] = store.search('TypeScript');
    assert.equal(used.useCount, 1);
    assert.ok(used.lastUsedAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('similar memories merge without overwriting a conflicting negation', () => {
  const { dir, store } = createStore();
  try {
    const first = store.remember('我的项目是 DeskMate', 'project');
    assert.ok(first);

    const merged = store.remember('我的项目是 DeskMate，主要用 Electron 和 React', 'project');
    assert.equal(merged?.id, first.id);
    assert.match(merged?.text ?? '', /Electron/);

    const positive = store.remember('我喜欢 TypeScript', 'preference');
    const negative = store.remember('我不喜欢 TypeScript', 'preference');
    assert.ok(positive);
    assert.ok(negative);
    assert.notEqual(positive.id, negative.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('editing a fact reindexes FTS and clear removes everything', () => {
  const { dir, store } = createStore();
  try {
    const fact = store.remember('当前项目使用旧技术栈', 'project');
    assert.ok(fact);

    store.updateFact(fact.id, '当前项目使用 Rust 和 Tauri', 'project');
    assert.equal(store.search('旧技术栈').length, 0);
    assert.equal(store.search('Rust').length, 1);

    store.appendMessage('user', '你好');
    store.appendMessage('assistant', '我在');
    assert.equal(store.getMessages().length, 2);

    store.clear();
    assert.equal(store.getFactCount(), 0);
    assert.equal(store.getMessages().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('companion anchors, commitments and day markers persist', () => {
  const { dir, store } = createStore();
  try {
    const anchor = store.addAnchor('今天修好了 auth 的 race condition', 'work', {
      source: 'auto',
      confidence: 0.8,
    });
    assert.ok(anchor);
    assert.equal(store.getAnchors(anchor.day).length, 1);

    const commitment = store.addCommitment('今晚把数字发给老王', '今晚');
    assert.ok(commitment);
    assert.equal(store.getCommitments('open').length, 1);

    store.markCallback(anchor.day, 123);
    store.markRecap(anchor.day, '今天修好了 auth。', 456);
    const today = store.getCompanionToday(new Date(`${anchor.day}T12:00:00`));
    assert.equal(today.anchors.length, 1);
    assert.equal(today.callbackAt, 123);
    assert.equal(today.recapAt, 456);
    assert.match(today.recapText ?? '', /auth/);

    store.completeCommitment(commitment.id);
    assert.equal(store.getCommitments('open').length, 0);
    assert.equal(store.getCommitments('done').length, 1);

    store.clear();
    assert.equal(store.getCompanionToday().anchors.length, 0);
    assert.equal(store.getCommitments('all').length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('anchor editing, tombstones, auto events, feedback mutes and export', () => {
  const { dir, store } = createStore();
  try {
    const anchor = store.addAnchor('原始锚点', 'work', { source: 'auto' });
    assert.ok(anchor);

    const updated = store.updateAnchor(anchor.id, '改过的锚点', 'feeling');
    assert.equal(updated?.text, '改过的锚点');
    assert.equal(updated?.kind, 'feeling');
    assert.equal(updated?.source, 'explicit');

    const tombstone = store.addAnchor('删掉不要再生成', 'work', { source: 'auto' });
    assert.ok(tombstone);
    store.deleteAnchor(tombstone.id);
    assert.equal(store.getAnchors(tombstone.day).some((item) => item.id === tombstone.id), false);
    assert.equal(store.addAnchor('删掉不要再生成', 'work', { source: 'auto' }), null);
    assert.ok(store.addAnchor('删掉不要再生成', 'work', { source: 'explicit' }));

    assert.equal(store.countAutoAnchors(anchor.day), 0);
    const auto = store.addAnchor('另一个自动锚点', 'work', { source: 'auto' });
    assert.ok(auto);
    assert.equal(store.countAutoAnchors(anchor.day), 1);
    assert.equal(store.hasAutoAnchorEvent(anchor.day, 'focus-60'), false);
    store.markAutoAnchorEvent(anchor.day, 'focus-60', auto.id);
    assert.equal(store.hasAutoAnchorEvent(anchor.day, 'focus-60'), true);

    store.recordBubbleFeedback('observe', 'dismiss');
    assert.equal(store.isEventMuted('observe'), false);
    store.recordBubbleFeedback('observe', 'dismiss');
    assert.equal(store.isEventMuted('observe'), true);
    store.recordBubbleFeedback('observe', 'open');
    assert.equal(store.isEventMuted('observe'), false);

    const data = store.exportData();
    assert.ok(data.anchors.length >= 2);
    assert.equal(data.exportedAt > 0, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('voice, persona and quiet hours are persisted with clamps', () => {
  const { dir, store } = createStore();
  try {
    store.updateSettings({
      voiceName: 'Samantha',
      speechRate: 999,
      persona: 'x'.repeat(3000),
      quietHoursEnabled: true,
      quietStart: '25:00',
      quietEnd: '08:00',
    });
    const settings = store.getSettings();
    assert.equal(settings.voiceName, 'Samantha');
    assert.equal(settings.speechRate, 260);
    assert.equal(settings.persona.length, 2000);
    assert.equal(settings.quietHoursEnabled, true);
    assert.equal(settings.quietStart, '23:30');
    assert.equal(settings.quietEnd, '08:00');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('activity timeline applies user corrections', () => {
  const { dir, store } = createStore();
  try {
    const now = Date.now();
    store.appendObservation({
      at: now - 20 * 60_000,
      app: 'Visual Studio Code',
      title: 'auth.spec.ts',
      activity: '在排查 auth 的 race condition',
    });
    store.appendObservation({
      at: now - 15 * 60_000,
      app: 'Visual Studio Code',
      title: 'auth.spec.ts',
      activity: '在排查 auth 的 race condition',
    });
    assert.match(store.getActivityContext(30), /排查 auth/);

    store.addCorrection({
      startAt: now - 25 * 60_000,
      endAt: now,
      wrongText: '在排查 auth 的 race condition',
      correctedText: '在写周报',
      confidence: 1,
    });
    store.addCorrection({
      startAt: now - 50 * 60_000,
      endAt: now - 40 * 60_000,
      correctedText: '在开会',
      confidence: 0.9,
    });

    const context = store.getActivityContext(60);
    assert.match(context, /在写周报/);
    assert.match(context, /在开会/);
    assert.doesNotMatch(context, /排查 auth/);
    assert.equal(store.getCorrectionCount(), 2);
    assert.match(store.getRecentCorrectionContext(), /用户纠正：在写周报/);

    store.clear();
    assert.equal(store.getActivityContext(60), '');
    assert.equal(store.getCorrectionCount(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
