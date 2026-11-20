import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemoryStore } from '../src/main/memory.ts';
import { runDreaming } from '../src/main/dreaming.ts';
import { wikiDirectory } from '../src/main/wiki.ts';
import { applyWikiDraft } from '../src/main/wiki.ts';

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-dream-test-'));
  return { dir, store: new MemoryStore(dir) };
}

function seed(store) {
  store.appendMessage('user', '今天在给 DeskMate 接个人 wiki，已经能写页面了。');
  store.appendMessage('assistant', '听起来像是一个长期项目。');
  store.appendMessage('user', '明天把知识面板补上，测试也别落下。');
  store.addAnchor('给 DeskMate 接上个人 wiki', 'work', { source: 'auto', confidence: 0.8 });
  store.addCommitment('补知识面板', '明天');
  store.recordProactiveDelivery({ eventType: 'test-pass', text: '测试绿了。' });
  store.markDeliveryOutcome('dismissed');
}

function fakeClient(messages) {
  const ref = `msg:${messages[0].id}`;
  const second = `msg:${messages[2].id}`;
  return {
    configured: true,
    async routeWikiEntities() {
      return [{ type: 'project', name: 'DeskMate', note: '个人桌面搭子', refs: [ref, second] }];
    },
    async writeWikiPage() {
      return {
        name: 'DeskMate',
        type: 'project',
        aliases: ['同桌'],
        summary: `DeskMate 是一个桌面搭子，正在接个人 wiki [[${ref}]]。`,
        newItems: [`补知识面板 [[${second}]]`],
        closeItems: [],
        sources: [ref, second],
        changeNote: '新建项目页',
      };
    },
    async learnProactiveRules() {
      return {
        rules: [
          {
            kind: 'test-pass',
            label: '测试通过',
            decision: 'stay_silent',
            reason: '用户说别提醒测试',
          },
        ],
        clues: [
          {
            kind: 'idle',
            label: '离开提醒',
            decision: 'stay_silent',
            note: '被忽略',
            seen: 1,
          },
        ],
        changeNote: '学到一条规则',
      };
    },
    async generateDailyDigest() {
      return '**今天推进了**\n- 接入 wiki\n\n**卡住 / 没做完**\n- —\n\n**明天先做**\n- 补知识面板';
    },
    async summarizeAgentMemory() {
      return '# 关于你\n\n- 在做 DeskMate\n\n## 正在做的事\n- DeskMate：桌面搭子';
    },
  };
}

test('夜间整理写入 wiki、规则、日结、摘要和文件', async () => {
  const { dir, store } = createStore();
  try {
    seed(store);
    const messages = store.getMessageRowsSince(0);
    const now = Date.now();
    const run = await runDreaming({
      store,
      client: fakeClient(messages),
      userDataDir: dir,
      now: () => now,
      force: true,
    });

    assert.equal(run.status, 'ok');
    assert.equal(run.pages, 1);
    assert.equal(run.rules, 1);

    const pages = store.listWikiPages();
    assert.equal(pages.length, 1);
    assert.equal(pages[0].name, 'DeskMate');
    assert.match(pages[0].items[0].text, /^补知识面板/);
    assert.equal(store.getDailyReports()[0].day, run.day);
    assert.match(store.getAgentMemory(), /DeskMate/);
    assert.equal(store.getRules().some((rule) => rule.decision === 'stay_silent'), true);

    const file = path.join(wikiDirectory(dir), 'project', 'DeskMate.md');
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.existsSync(path.join(dir, 'agent-memory', 'summary.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'agent-memory', 'MEMORY.md')), true);

    const again = await runDreaming({
      store,
      client: fakeClient(messages),
      userDataDir: dir,
      now: () => now,
      force: false,
    });
    assert.equal(again.status, 'skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('没有模型时仍生成本地日结和记忆摘要', async () => {
  const { dir, store } = createStore();
  try {
    seed(store);
    const run = await runDreaming({
      store,
      client: { configured: false },
      userDataDir: dir,
      now: () => Date.now(),
      force: true,
    });

    assert.equal(run.status, 'ok');
    assert.match(store.getDailyReports()[0].text, /今天推进了/);
    assert.match(store.getAgentMemory(), /关于你|正在做的事/);
    assert.equal(fs.existsSync(path.join(dir, 'agent-memory', 'MEMORY.md')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('夜间证据把连续活动压成段，并保留引用', () => {
  const { dir, store } = createStore();
  try {
    const base = Date.now() - 60 * 60_000;
    for (let index = 0; index < 5; index += 1) {
      store.appendObservation({
        at: base + index * 60_000,
        app: 'Xcode',
        title: 'DeskMate',
        activity: '修改 auth 校验',
      });
    }
    const evidence = store.getDreamEvidence(base - 1000);
    assert.match(evidence.text, /## 屏幕活动/);
    assert.match(evidence.text, /Xcode/);
    assert.match(evidence.text, /activity:/);
    assert.ok(evidence.refs.size >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同名页面在数据库层被拒绝，不会产生两个实体', () => {
  const { dir, store } = createStore();
  try {
    const refs = new Map([['msg:1', { label: '证据', at: Date.now() }]]);
    const first = applyWikiDraft(
      null,
      { name: 'DeskMate', type: 'project', summary: '第一页 [[msg:1]]', sources: ['msg:1'] },
      refs,
    ).page;
    store.saveWikiPage(first);
    const second = applyWikiDraft(
      null,
      { name: 'deskmate', type: 'project', summary: '第二个同名页 [[msg:1]]', sources: ['msg:1'] },
      refs,
    ).page;
    assert.throws(() => store.saveWikiPage(second));
    assert.equal(store.listWikiPages().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('删除页面会留 tombstone，夜间整理不会自动复活', () => {
  const { dir, store } = createStore();
  try {
    const refs = new Map([['msg:1', { label: '证据', at: Date.now() }]]);
    const page = applyWikiDraft(
      null,
      { name: '临时项目', type: 'project', summary: '先建再删 [[msg:1]]', sources: ['msg:1'] },
      refs,
    ).page;
    store.saveWikiPage(page);
    store.deleteWikiPage(page.id);
    assert.equal(store.listWikiPages().length, 0);
    assert.equal(store.isWikiNameTombstoned('临时项目'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
