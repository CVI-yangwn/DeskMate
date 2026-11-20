import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLines, firstErrorLine, typingDelta } from '../src/main/change.ts';

test('同一页新增了三行，算值得说的变化', () => {
  const prev = ['npm test', 'PASS  src/auth.test.ts', 'Tests: 12 passed'].join('\n');
  const next = [
    'npm test',
    'PASS  src/auth.test.ts',
    'Tests: 12 passed',
    'FAIL  src/token.test.ts',
    'error: expected 200 but got 401',
    'at token.spec.ts:42',
  ].join('\n');

  const diff = diffLines(prev, next);
  assert.equal(diff.sameContext, true);
  assert.equal(diff.addedCount, 3);
  assert.equal(diff.significant, true);
  assert.match(diff.summary, /新增 3 行/);
  assert.match(diff.summary, /error|FAIL/);
});

test('页面没变就不报变化', () => {
  const text = '第一行内容够长\n第二行内容也够长';
  const diff = diffLines(text, text);
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.summary, '');
  assert.equal(diff.significant, false);
});

test('切到另一个页面不算“新增”，也不算显著变化', () => {
  const prev = '文档标题\n第一章 引言\n第二章 方法';
  const next = '聊天窗口\n张三: 明天开会\n李四: 收到';
  const diff = diffLines(prev, next);
  assert.equal(diff.sameContext, false);
  assert.equal(diff.significant, false);
});

test('两行短改动不打扰', () => {
  const prev = '在改 auth 的登录校验\n顺便看了一眼日志';
  const next = '在改 auth 的登录校验\n顺便看了一眼日志\n补了一行注释';
  const diff = diffLines(prev, next);
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.significant, false);
});

test('打字增量能区分输入和只读', () => {
  const before = 'fix: 修正 token 过期判断';
  const after = 'fix: 修正 token 过期判断，并补上单测';

  const typing = typingDelta(before, after);
  assert.equal(typing.typing, true);
  assert.ok(typing.charsAdded >= 6);

  const idle = typingDelta(before, before);
  assert.equal(idle.typing, false);
});

test('只有新出现的报错才算“值得说的变化”', () => {
  const prev = 'build ok\nrunning tests\n12 passed';
  const next = 'build ok\nrunning tests\n12 passed\nerror TS2345: Argument of type string';
  const diff = diffLines(prev, next);
  assert.match(firstErrorLine(diff) ?? '', /error TS2345/);

  const quiet = diffLines('abc 很长的一行\ndef 也很长的一行', 'abc 很长的一行\ndef 也很长的一行\n加了一行无关紧要的说明');
  assert.equal(firstErrorLine(quiet), null);
});

test('第一次扫描没有上一帧时保持安静', () => {
  const diff = diffLines('', '一大堆第一次看到的文本\n第二行\n第三行');
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.summary, '');
});
