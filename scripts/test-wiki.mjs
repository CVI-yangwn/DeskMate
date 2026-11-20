import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWikiDraft,
  formatWikiContext,
  renderWikiMarkdown,
  searchWikiPages,
  slugifyWikiName,
  WikiValidationError,
} from '../src/main/wiki.ts';

const refs = new Map([
  ['msg:1', { label: '10:00 用户：我在做 DeskMate', at: 1000 }],
  ['msg:2', { label: '10:05 用户：今天把 wiki 接上', at: 2000 }],
]);

test('新建页面保留来源、条目和 change log', () => {
  const { page, created } = applyWikiDraft(
    null,
    {
      name: 'DeskMate',
      type: 'project',
      aliases: ['同桌'],
      summary: 'DeskMate 是一个 Electron 桌面搭子 [[msg:1]]。',
      newItems: ['接入个人 wiki [[msg:2]]'],
      sources: ['msg:1', 'msg:2'],
      changeNote: '新建项目页',
    },
    refs,
    5000,
  );

  assert.equal(created, true);
  assert.equal(page.name, 'DeskMate');
  assert.deepEqual(page.aliases, ['同桌']);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].status, 'open');
  assert.equal(page.sources.length, 2);
  assert.equal(page.changeLog[0].note, '新建项目页');
  assert.match(renderWikiMarkdown(page), /## Change Log/);
});

test('更新只合并提到的变化，没提到的条目原样保留', () => {
  const first = applyWikiDraft(
    null,
    {
      name: 'DeskMate',
      type: 'project',
      summary: '第一版 [[msg:1]]',
      newItems: ['接入个人 wiki', '补单测'],
      sources: ['msg:1'],
    },
    refs,
    1000,
  ).page;

  const second = applyWikiDraft(
    first,
    {
      name: 'DeskMate',
      type: 'project',
      summary: '第二版，wiki 已接上 [[msg:2]]',
      newItems: ['补单测', '做知识面板'],
      closeItems: ['接入个人 wiki'],
      sources: ['msg:2'],
      changeNote: '完成 wiki',
    },
    refs,
    2000,
  );

  assert.equal(second.page.items.length, 3);
  assert.equal(second.page.items.find((item) => item.text === '补单测')?.id, first.items[1].id);
  assert.equal(second.page.items.find((item) => item.text === '接入个人 wiki')?.status, 'done');
  assert.equal(second.page.items.find((item) => item.text === '做知识面板')?.status, 'open');
  assert.equal(second.page.sources.length, 2);
  assert.equal(second.page.changeLog[0].note, '完成 wiki');
});

test('引用不存在的证据会被拒绝', () => {
  assert.throws(
    () =>
      applyWikiDraft(
        null,
        {
          name: 'X',
          type: 'topic',
          summary: '编造 [[msg:99]]',
        },
        refs,
      ),
    (error) => error instanceof WikiValidationError,
  );
});

test('未完成条目超过上限时归档最老的，而不是丢弃', () => {
  const items = Array.from({ length: 25 }, (_, index) => `事项 ${index}`);
  const { page } = applyWikiDraft(
    null,
    {
      name: '大页',
      type: 'project',
      summary: '很多条目 [[msg:1]]',
      newItems: items,
      sources: ['msg:1'],
    },
    refs,
  );
  assert.equal(page.items.length, 25);
  assert.equal(page.items.filter((item) => item.status === 'open').length, 20);
  assert.equal(page.items[0].status, 'done');
});

test('搜索优先命中页面名，slug 处理中文与非法字符', () => {
  const desk = applyWikiDraft(
    null,
    { name: 'DeskMate', type: 'project', summary: '桌面搭子 [[msg:1]]' },
    refs,
  ).page;
  const other = applyWikiDraft(
    null,
    { name: '周报', type: 'topic', summary: '每周整理 [[msg:2]]' },
    refs,
  ).page;

  const found = searchWikiPages([other, desk], 'DeskMate');
  assert.equal(found[0].id, desk.id);
  const natural = searchWikiPages([other, desk], '「DeskMate」现在是什么状态？');
  assert.equal(natural[0]?.id, desk.id);
  assert.match(formatWikiContext([desk]), /DeskMate/);
  assert.equal(slugifyWikiName('DeskMate / 同桌'), 'DeskMate-同桌');
});
