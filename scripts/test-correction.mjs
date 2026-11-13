import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackCorrection, isCorrectionCue } from '../src/main/correction.ts';

test('correction cues distinguish questions from corrections', () => {
  assert.equal(isCorrectionCue('我刚才在干嘛？'), false);
  assert.equal(isCorrectionCue('对不对？'), false);
  assert.equal(isCorrectionCue('这个函数不是这样写的，是 async 的'), false);
  assert.equal(isCorrectionCue('你答错了，我刚才在写周报'), true);
  assert.equal(isCorrectionCue('不对，我那段时间在开会'), true);
  assert.equal(isCorrectionCue('不是看代码，是在写周报'), true);
});

test('fallback correction extracts activity and time window', () => {
  assert.equal(fallbackCorrection('我刚才在干嘛？'), null);
  assert.deepEqual(fallbackCorrection('你答错了，我刚才在写周报'), {
    correctedActivity: '写周报',
    minutes: 30,
    timeHint: '刚才',
  });
  assert.equal(fallbackCorrection('不对，我那段时间在开会')?.correctedActivity, '开会');
  assert.equal(fallbackCorrection('不是看代码，是在写周报')?.correctedActivity, '写周报');
  assert.deepEqual(fallbackCorrection('你记错了，我刚才在跟产品过需求，大概过去20分钟'), {
    correctedActivity: '跟产品过需求',
    minutes: 20,
    timeHint: '刚才',
  });
  assert.deepEqual(fallbackCorrection('不是这样，我上午一直在写周报'), {
    correctedActivity: '写周报',
    minutes: 180,
    timeHint: '上午',
  });
});
