import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEveningFallback,
  buildMorningFallback,
  extractLocalSignals,
  isEveningWindow,
  isMorningWindow,
  isQuietHours,
  previousDay,
  recapDayFor,
} from '../src/main/companion.ts';

test('local signals keep one past anchor and one future commitment', () => {
  const signals = extractLocalSignals(
    '今天下午把 auth 的 race 修好了。今晚要把数字发给老王。',
  );
  assert.equal(signals.anchors.length, 1);
  assert.match(signals.anchors[0].text, /auth/);
  assert.equal(signals.anchors[0].kind, 'work');
  assert.equal(signals.commitments.length, 1);
  assert.equal(signals.commitments[0].dueHint, '今晚');
});

test('local signals ignore questions and generic chat', () => {
  assert.deepEqual(extractLocalSignals('你在吗？'), { anchors: [], commitments: [] });
  assert.deepEqual(extractLocalSignals('今天天气不错'), { anchors: [], commitments: [] });
  assert.deepEqual(extractLocalSignals('明天要开会吗'), { anchors: [], commitments: [] });
});

test('day helpers and companion fallbacks stay short and specific', () => {
  assert.equal(previousDay('2026-03-01'), '2026-02-28');

  const morning = buildMorningFallback([{ text: '修 auth' }], []);
  assert.match(morning, /修 auth/);
  assert.ok(morning.length <= 120);

  const evening = buildEveningFallback([{ text: '修 auth' }], [{ text: '发数字' }]);
  assert.match(evening, /修 auth/);
  assert.match(evening, /明天/);
  assert.ok(evening.length <= 120);
});

test('morning/evening windows and quiet hours are pure and testable', () => {
  const at = (hour, minute = 0) => new Date(2026, 10, 12, hour, minute);

  assert.equal(isMorningWindow(at(6)), true);
  assert.equal(isMorningWindow(at(13, 59)), true);
  assert.equal(isMorningWindow(at(14)), false);
  assert.equal(isEveningWindow(at(22)), true);
  assert.equal(isEveningWindow(at(1, 30)), true);
  assert.equal(isEveningWindow(at(12)), false);
  assert.equal(recapDayFor(at(0, 30)), '2026-11-11');

  assert.equal(isQuietHours(at(23, 45), true, '23:30', '08:00'), true);
  assert.equal(isQuietHours(at(7, 59), true, '23:30', '08:00'), true);
  assert.equal(isQuietHours(at(12), true, '23:30', '08:00'), false);
  assert.equal(isQuietHours(at(12), false, '23:30', '08:00'), false);
  assert.equal(isQuietHours(at(12), true, '09:00', '18:00'), true);
});
