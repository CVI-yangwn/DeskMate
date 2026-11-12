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
