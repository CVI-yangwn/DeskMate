import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSegment,
  extractEntity,
  sameEntity,
  buildBehaviorProfile,
  gatePrediction,
  isRepeatedPrediction,
  isWorthRecording,
  localIntentionText,
  sameApp,
  segmentToPrompt,
  textSimilarity,
} from '../src/main/intention.ts';

const MIN = 60_000;

function step(at, app, activity, title = '') {
  return { at, app, title, activity };
}

function feed(steps) {
  let acc = null;
  const all = [];
  for (const item of steps) {
    const update = advanceSegment(acc, item);
    acc = update.acc;
    if (update.finished) all.push(update.finished);
  }
  return { acc, all };
}

test('同一应用、连续的几步归成一段', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { acc, all } = feed([
    step(base, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + MIN, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + 2 * MIN, 'Xcode', '跑了一遍 auth 相关测试'),
  ]);
  assert.equal(all.length, 0);
  assert.equal(acc.steps.length, 3);
  assert.equal(acc.app, 'Xcode');
});

test('换应用就收尾，并把上一段交出来', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { all } = feed([
    step(base, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + MIN, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + 2 * MIN, 'Safari', '查 passport 的文档'),
  ]);
  assert.equal(all.length, 1);
  assert.equal(all[0].app, 'Xcode');
  assert.equal(all[0].endAt, base + MIN);
});

test('断档超过 8 分钟算上一件事结束', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { all } = feed([
    step(base, 'Cursor', '在写意图层的单测'),
    step(base + 9 * MIN, 'Cursor', '在写意图层的单测'),
  ]);
  assert.equal(all.length, 1);
  assert.equal(all[0].endAt, base);
});

test('同一应用待太久且内容变了，也会切开', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { all } = feed([
    step(base, 'Cursor', '在写意图层的数据结构与单测'),
    step(base + 50 * MIN, 'Cursor', '在剪一段视频并导出到桌面'),
  ]);
  assert.equal(all.length, 1);
  assert.equal(all[0].endAt, base);
});

test('八十秒的一瞥不记为意图，三步以上才记', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const brief = feed([step(base, 'Finder', '在找一份下载的 PDF')]).acc;
  assert.equal(isWorthRecording({ ...brief, endAt: brief.lastAt }), false);

  const real = feed([
    step(base, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + MIN, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + 2 * MIN, 'Xcode', '跑了一遍 auth 相关测试'),
  ]).acc;
  assert.equal(isWorthRecording({ ...real, endAt: real.lastAt }), true);
});

test('本地兜底意图带上应用名，且不超过 60 字', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { acc } = feed([
    step(base, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + MIN, 'Xcode', '在跑测试'),
  ]);
  const text = localIntentionText({ ...acc, endAt: acc.lastAt });
  assert.match(text, /Xcode/);
  assert.ok(text.length <= 60);
});

test('置信度门槛 0.6：空话和低分都不出声', () => {
  assert.equal(gatePrediction({ text: '继续工作', confidence: 0.9 }).push, false);
  assert.equal(gatePrediction({ text: '把 auth 的登录校验补上', confidence: 0.59 }).push, false);
  assert.equal(gatePrediction({ text: '把 auth 的登录校验补上', confidence: 0.6 }).push, true);
});

test('阈值可调：模型稳定停在 0.55 时可以调到 0.5 放行', () => {
  const prediction = { text: '在 Xcode 里补 auth 的单测', confidence: 0.55 };
  assert.equal(gatePrediction(prediction).push, false);
  assert.equal(gatePrediction(prediction, 0.5).push, true);
});

test('刚被否掉的猜测换个说法也别再猜', () => {
  const rejected = ['把 auth 的登录校验补上'];
  assert.equal(isRepeatedPrediction('把 auth 的登录校验补一下', rejected), true);
  assert.equal(isRepeatedPrediction('整理今天的周报', rejected), false);
});

test('行为画像只描述看得见的事', () => {
  const now = Date.UTC(2026, 10, 13, 8, 0);
  const base = {
    title: '',
    endAt: now,
    stepCount: 3,
    confidence: 0.8,
    source: 'deepseek',
    at: now,
  };
  const profile = buildBehaviorProfile(
    [
      { ...base, id: '1', app: 'Xcode', text: '修 auth 校验', startAt: now },
      { ...base, id: '2', app: 'Xcode', text: '跑测试', startAt: now + 1000 },
      { ...base, id: '3', app: 'Safari', text: '查 passport 文档', startAt: now + 2000 },
    ],
    now,
  );
  assert.match(profile, /常用：Xcode 2 次/);
  assert.match(profile, /修 auth 校验/);
});

test('应用名容忍 Chrome / Google Chrome 这类写法', () => {
  assert.equal(sameApp('Google Chrome', 'Chrome'), true);
  assert.equal(sameApp('Xcode', 'Safari'), false);
});

test('给模型的段描述只包含步骤，不包含坐标和截图', () => {
  const base = Date.UTC(2026, 10, 13, 2, 0);
  const { acc } = feed([
    step(base, 'Xcode', '在改 auth 模块的登录校验'),
    step(base + MIN, 'Xcode', '在跑测试', 'auth.test.ts'),
  ]);
  const prompt = segmentToPrompt({ ...acc, endAt: acc.lastAt });
  assert.match(prompt, /应用：Xcode/);
  assert.match(prompt, /auth\.test\.ts/);
  assert.match(prompt, /步骤：/);
  assert.ok(textSimilarity('在改 auth 登录校验', '在改 auth 的登录校验') > 0.5);
});


test('从标题和 URL 里剥出“正在处理的东西”', () => {
  assert.equal(extractEntity({ app: 'iDev', title: '预览 README.md — code [instance-x]' }), 'README.md');
  assert.equal(extractEntity({ app: 'Chrome', title: 'Proposal - Google Chrome' }), 'Proposal');
  // 标题优先；只有没标题时才用 URL
  assert.equal(
    extractEntity({ app: 'Chrome', title: '', doc: 'https://example.com/a/b?x=1' }),
    'example.com/a/b',
  );
  assert.equal(
    extractEntity({ app: 'Chrome', title: '新标签页 — Google Chrome', doc: 'https://example.com/a/b' }),
    'example.com/a/b',
  );
  assert.equal(extractEntity({ app: 'Xcode', title: '', doc: '' }), 'Xcode');
  assert.equal(sameEntity('README.md', 'README.md — 预览'), true);
  assert.equal(sameEntity('README.md', 'known-issues.md'), false);
});

test('同一个应用里换了文件，就看成一件事', () => {
  const base = Date.UTC(2026, 10, 16, 8, 0);
  const { acc, all } = feed([
    { at: base, app: 'iDev', title: '预览 README.md', activity: '在读 README', entity: 'README.md' },
    { at: base + 60_000, app: 'iDev', title: '预览 README.md', activity: '在读 README', entity: 'README.md' },
    { at: base + 120_000, app: 'iDev', title: '编辑 known-issues.md', activity: '在写 known-issues', entity: 'known-issues.md' },
  ]);
  assert.equal(all.length, 1);
  assert.equal(all[0].entity, 'README.md');
  assert.equal(all[0].steps.length, 2);
  assert.equal(acc.entity, 'known-issues.md');
});

test('刚开段的十几秒内不因为标题抖动而切段', () => {
  const base = Date.UTC(2026, 10, 16, 8, 0);
  const { all } = feed([
    { at: base, app: 'iDev', title: '预览 README.md', activity: '在读 README', entity: 'README.md' },
    { at: base + 8_000, app: 'iDev', title: '预览 README.md — 2', activity: '在读 README', entity: 'README-v2' },
  ]);
  assert.equal(all.length, 0);
});
