import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_GATE, gateActivity } from '../src/main/salience.ts';

test('第一次扫描直接确认', () => {
  const decision = gateActivity(EMPTY_GATE, { activity: '在 Xcode 里改 auth 校验', app: 'Xcode' });
  assert.equal(decision.stable, true);
  assert.equal(decision.activity, '在 Xcode 里改 auth 校验');
});

test('换应用立刻接受，不用等第二帧', () => {
  const first = gateActivity(EMPTY_GATE, { activity: '在 Xcode 里改 auth 校验', app: 'Xcode' });
  const switched = gateActivity(first.state, { activity: '在 Chrome 里查 passport 文档', app: 'Google Chrome' });
  assert.equal(switched.stable, true);
  assert.equal(switched.activity, '在 Chrome 里查 passport 文档');
});

test('同一个应用里冒出的新说法，第一帧不采纳', () => {
  let gate = gateActivity(EMPTY_GATE, { activity: '在 Xcode 里改 auth 校验', app: 'Xcode' });
  // 屏幕上弹了一条无关信息，模型把它写进了 activity
  const noise = gateActivity(gate.state, { activity: '在 Xcode 里看群里的周报讨论', app: 'Xcode' });
  assert.equal(noise.stable, false);
  assert.equal(noise.activity, '在 Xcode 里改 auth 校验');

  // 同样的说法再来一次，才认为真的换了事
  const second = gateActivity(noise.state, { activity: '在 Xcode 里看群里的周报讨论', app: 'Xcode' });
  assert.equal(second.stable, true);
  assert.equal(second.activity, '在 Xcode 里看群里的周报讨论');
});

test('换个说法描述同一件事不算打断', () => {
  const first = gateActivity(EMPTY_GATE, { activity: '在 Xcode 里改 auth 模块的登录校验', app: 'Xcode' });
  const rephrased = gateActivity(first.state, {
    activity: '在 Xcode 里改 auth 模块的登录校验逻辑',
    app: 'Xcode',
  });
  assert.equal(rephrased.stable, true);
});

test('空活动不会把上一句冲掉', () => {
  const first = gateActivity(EMPTY_GATE, { activity: '在 Xcode 里改 auth 校验', app: 'Xcode' });
  const empty = gateActivity(first.state, { activity: '   ', app: 'Xcode' });
  assert.equal(empty.stable, false);
  assert.equal(empty.activity, '在 Xcode 里改 auth 校验');
});

test('中间插一条噪声，不会打断后面的真实确认', () => {
  let gate = gateActivity(EMPTY_GATE, { activity: '在写周报', app: '飞书' });
  gate = gateActivity(gate.state, { activity: '群里有人发了新消息', app: '飞书' });
  assert.equal(gate.stable, false);
  // 恢复成同一件事的另一种说法
  gate = gateActivity(gate.state, { activity: '在写周报', app: '飞书' });
  assert.equal(gate.stable, true);
  assert.equal(gate.activity, '在写周报');
});

test('模型每帧都换说法时，第三帧接受而不是永远冻结', () => {
  let gate = gateActivity(EMPTY_GATE, { activity: '在写周报', app: '飞书' });
  const first = gateActivity(gate.state, { activity: '在整理周报里的数据', app: '飞书' });
  assert.equal(first.stable, false);
  const second = gateActivity(first.state, { activity: '在核对周报的图表', app: '飞书' });
  assert.equal(second.stable, false);
  const third = gateActivity(second.state, { activity: '在补周报的结论', app: '飞书' });
  assert.equal(third.stable, true);
  assert.equal(third.activity, '在补周报的结论');
});

test('确认之后计数清零，不会一直放行', () => {
  let gate = gateActivity(EMPTY_GATE, { activity: '在写周报', app: '飞书' });
  gate = gateActivity(gate.state, { activity: '在整理周报里的数据', app: '飞书' });
  gate = gateActivity(gate.state, { activity: '在核对周报的图表', app: '飞书' });
  gate = gateActivity(gate.state, { activity: '在补周报的结论', app: '飞书' });
  assert.equal(gate.stable, true);
  assert.equal(gate.state.rejects, 0);

  const next = gateActivity(gate.state, { activity: '在查昨天的测试结果', app: '飞书' });
  assert.equal(next.stable, false);
});
