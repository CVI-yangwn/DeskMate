import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore, MEMORY_TABLES, CLEARABLE_TABLES } from '../src/main/memory.ts';
import { applyWikiDraft, wikiDirectory, wikiPageFile } from '../src/main/wiki.ts';
import { writeWikiFile } from '../src/main/dreaming.ts';

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-hardening-test-'));
  return { dir, store: new MemoryStore(dir) };
}

function pageDraft(name = 'DeskMate') {
  const refs = new Map([['msg:999', { label: '一条旧证据', excerpt: '旧证据内容', at: Date.now() }]]);
  return applyWikiDraft(
    null,
    { name, type: 'project', summary: '一个项目 [[msg:999]]', sources: ['msg:999'] },
    refs,
  ).page;
}

test('schema registry 与真实表一致，并写入 user_version', () => {
  const { dir, store } = createStore();
  try {
    const db = new DatabaseSync(path.join(dir, 'memory.db'));
    const actual = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name)
      .filter((name) => !name.includes('_fts'))
      .sort();
    db.close();

    assert.deepEqual(actual, [...MEMORY_TABLES].sort());
    assert.equal(CLEARABLE_TABLES.includes('settings'), false);
    assert.equal(CLEARABLE_TABLES.length, MEMORY_TABLES.length - 1);

    const check = new DatabaseSync(path.join(dir, 'memory.db'));
    const version = check.prepare('PRAGMA user_version').get();
    check.close();
    assert.equal(Number(version.user_version), 2);
    store.clear();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clear() 删表、删知识文件、保留 settings，并尽量清掉磁盘残留', () => {
  const { dir, store } = createStore();
  try {
    store.updateSettings({ voiceName: 'Samantha' });
    store.addFact('SECRET_TOKEN_SHOULD_DISAPPEAR', 'fact');
    const page = pageDraft();
    store.saveWikiPage(page);
    writeWikiFile(dir, page);
    fs.mkdirSync(path.join(dir, 'agent-memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent-memory', 'MEMORY.md'), 'secret', 'utf8');
    fs.writeFileSync(path.join(dir, 'memory.json.migrated'), '{"facts":[{"text":"secret"}]}', 'utf8');

    assert.equal(fs.existsSync(wikiPageFile(dir, page)), true);
    store.clear();

    assert.equal(store.getSettings().voiceName, 'Samantha');
    assert.equal(store.getFactCount(), 0);
    assert.equal(store.getWikiCount(), 0);
    assert.equal(fs.existsSync(wikiDirectory(dir)), false);
    assert.equal(fs.existsSync(path.join(dir, 'agent-memory')), false);
    assert.equal(fs.existsSync(path.join(dir, 'memory.json.migrated')), false);

    const raw = fs.readFileSync(path.join(dir, 'memory.db')).toString('utf8');
    assert.equal(raw.includes('SECRET_TOKEN_SHOULD_DISAPPEAR'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OCR 和光标全文不落盘，只保留活动摘要', () => {
  const { dir, store } = createStore();
  try {
    store.appendObservation({
      at: Date.now(),
      app: 'Xcode',
      title: 'DeskMate',
      activity: '修改 auth 校验',
      ocrText: 'super-secret-screen-text',
      focusText: 'super-secret-caret-text',
    });
    const db = new DatabaseSync(path.join(dir, 'memory.db'));
    const row = db
      .prepare('SELECT activity, ocr_text, focus_text FROM activity_log ORDER BY id DESC LIMIT 1')
      .get();
    db.close();
    assert.equal(row.activity, '修改 auth 校验');
    assert.equal(row.ocr_text, null);
    assert.equal(row.focus_text, null);
    store.clear();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('删除页面会 unlink 文件，tombstone 只存哈希', () => {
  const { dir, store } = createStore();
  try {
    const page = pageDraft('客户 A 续约');
    store.saveWikiPage(page);
    writeWikiFile(dir, page);
    assert.equal(fs.existsSync(wikiPageFile(dir, page)), true);

    store.deleteWikiPage(page.id);
    assert.equal(store.isWikiNameTombstoned('客户 A 续约'), true);
    assert.equal(fs.existsSync(wikiPageFile(dir, page)), false);

    const db = new DatabaseSync(path.join(dir, 'memory.db'));
    const tombstone = db.prepare('SELECT name_key, name FROM wiki_tombstones').get();
    db.close();
    assert.equal(tombstone.name, '');
    assert.match(tombstone.name_key, /^[0-9a-f]{64}$/);
    assert.equal(tombstone.name_key.includes('客户'), false);
    store.clear();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('记忆健康能数出无来源、过期来源和重复未完成', () => {
  const { dir, store } = createStore();
  try {
    const withSource = pageDraft('有来源');
    store.saveWikiPage(withSource);
    const noSource = applyWikiDraft(
      null,
      { name: '无来源', type: 'topic', summary: '没有引用', newItems: [] },
      new Map(),
    ).page;
    store.saveWikiPage(noSource);

    const health = store.getMemoryHealth(Date.now());
    assert.equal(health.pages, 2);
    // pageDraft 的 msg:999 在 messages 里不存在，算“已过期来源”。
    assert.equal(health.prunedSources, 1);
    assert.equal(health.unsourcedPages, 1);
    assert.equal(health.duplicateOpenItems, 0);
    store.clear();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('messages 按 7 天和 1000 条双上限保留', () => {
  const { dir, store } = createStore();
  try {
    const db = new DatabaseSync(path.join(dir, 'memory.db'));
    const insert = db.prepare('INSERT INTO messages (role, text, created_at) VALUES (?, ?, ?)');
    insert.run('user', '太老了', Date.now() - 8 * 24 * 60 * 60_000);
    for (let index = 0; index < 1001; index += 1) {
      insert.run('user', `消息 ${index}`, Date.now());
    }
    db.close();

    store.appendMessage('assistant', '最后一条');
    const check = new DatabaseSync(path.join(dir, 'memory.db'));
    const count = check.prepare('SELECT COUNT(*) AS count FROM messages').get();
    const oldest = check.prepare('SELECT MIN(created_at) AS at FROM messages').get();
    check.close();

    assert.equal(Number(count.count), 1000);
    assert.ok(Number(oldest.at) > Date.now() - 7 * 24 * 60 * 60_000);
    store.clear();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
