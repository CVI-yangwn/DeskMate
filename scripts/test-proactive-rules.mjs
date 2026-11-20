import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeRules,
  detectExplicitFeedback,
  gateProactive,
  inTimeWindow,
  promoteClues,
  sanitizeRuleDraft,
} from '../src/main/proactiveRules.ts';

function rule(overrides = {}) {
  return {
    id: 'r',
    kind: 'observe',
    label: '普通观察',
    decision: 'stay_silent',
    reason: '',
    source: 'explicit',
    seen: 1,
    active: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const at = (hour, minute = 0) => {
  const date = new Date(2026, 10, 20, hour, minute, 0, 0);
  return date.getTime();
};

test('时间窗支持跨夜', () => {
  assert.equal(inTimeWindow(at(23), '22:00', '08:00'), true);
  assert.equal(inTimeWindow(at(3), '22:00', '08:00'), true);
  assert.equal(inTimeWindow(at(12), '22:00', '08:00'), false);
  assert.equal(inTimeWindow(at(9), undefined, undefined), true);
});

test('规则越具体越优先：具体事件可覆盖 any', () => {
  const rules = [
    rule({ id: 'any', kind: 'any', decision: 'stay_silent' }),
    rule({ id: 'observe', kind: 'observe', decision: 'tell_now' }),
  ];
  assert.equal(gateProactive(rules, 'observe', at(10)).decision, 'allow');
  assert.equal(gateProactive(rules, 'idle', at(10)).decision, 'stay_silent');
});

test('晚点再说只在时间窗内压住', () => {
  const rules = [
    rule({
      id: 'later',
      decision: 'follow_up_later',
      windowStart: '21:00',
      windowEnd: '08:00',
    }),
  ];
  assert.equal(gateProactive(rules, 'observe', at(23)).decision, 'follow_up_later');
  assert.equal(gateProactive(rules, 'observe', at(12)).decision, 'allow');
});

test('带时间窗的规则优先于同类无窗口规则', () => {
  const rules = [
    rule({ id: 'all', windowStart: undefined, windowEnd: undefined, decision: 'stay_silent' }),
    rule({ id: 'night', windowStart: '21:00', windowEnd: '08:00', decision: 'tell_now' }),
  ];
  assert.equal(gateProactive(rules, 'observe', at(23)).decision, 'allow');
  assert.equal(gateProactive(rules, 'observe', at(12)).decision, 'stay_silent');
});

test('本地能识别明确的反馈表达', () => {
  const neg = detectExplicitFeedback('以后别提醒我测试了', 'test-pass');
  assert.ok(neg);
  assert.equal(neg.decision, 'stay_silent');
  assert.equal(neg.strong, true);

  const direct = detectExplicitFeedback('这种事以后直接说', 'observe');
  assert.ok(direct);
  assert.equal(direct.decision, 'tell_now');

  const night = detectExplicitFeedback('晚上别发这种提醒', 'observe');
  assert.ok(night);
  assert.equal(night.decision, 'stay_silent');
  assert.equal(night.windowStart, '21:00');
  assert.equal(night.windowEnd, '08:00');

  const later = detectExplicitFeedback('先记着，明天再说', 'observe');
  assert.ok(later);
  assert.equal(later.decision, 'follow_up_later');

  const hush = detectExplicitFeedback('先别说话', 'observe');
  assert.ok(hush);
  assert.equal(hush.decision, 'follow_up_later');
});

test('普通提问和内容评价不会被当成提醒反馈', () => {
  assert.equal(detectExplicitFeedback('明天要开会吗？', 'observe'), null);
  assert.equal(detectExplicitFeedback('这个提醒挺及时的', 'observe'), null);
  assert.equal(detectExplicitFeedback('我不喜欢这个方案', 'observe'), null);
  assert.equal(detectExplicitFeedback('不对，我刚才在写周报', 'observe'), null);
});

test('同类线索累计两次升级成规则', () => {
  const clues = [
    {
      id: 'c1',
      kind: 'idle',
      label: '离开提醒',
      decision: 'stay_silent',
      seen: 1,
      note: '',
      firstSeenAt: 1,
      lastSeenAt: 1,
    },
    {
      id: 'c2',
      kind: 'idle',
      label: '离开提醒',
      decision: 'stay_silent',
      seen: 1,
      note: '',
      firstSeenAt: 2,
      lastSeenAt: 2,
    },
  ];
  const promoted = promoteClues(clues, [], 100);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].kind, 'idle');
  assert.equal(promoted[0].decision, 'stay_silent');
});

test('规则清洗：未知 kind 落到 any，时钟规范化，去重', () => {
  const cleaned = sanitizeRuleDraft({
    kind: 'unknown-kind',
    label: '',
    decision: 'stay_silent',
    windowStart: '9:00',
    windowEnd: '18:00',
  });
  assert.ok(cleaned);
  assert.equal(cleaned.kind, 'any');
  assert.equal(cleaned.windowStart, '09:00');
  assert.equal(cleaned.label, '所有主动消息');

  const deduped = dedupeRules([
    rule({ id: 'a', updatedAt: 1 }),
    rule({ id: 'b', updatedAt: 2 }),
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'b');
});
