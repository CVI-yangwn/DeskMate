import assert from 'node:assert/strict';
import test from 'node:test';
import { runGuiTask } from '../src/main/gui/loop.ts';
import { iou } from '../src/main/gui/geometry.ts';
import { buildGroundingPrompt, parseGroundingReply } from '../src/main/gui/prompt.ts';
import { buildRefinePrompt, expandForZoom, mapCropTarget } from '../src/main/gui/refine.ts';
import { findActionableAt, matchByLabels, parseAxSnapshot, snapTargetToAx } from '../src/main/gui/ax.ts';
import { findScenario, SCENARIOS } from '../src/main/gui/scenarios.ts';
import { runScenario } from '../src/main/gui/simulate.ts';

const obs = () => ({ id: 'o', width: 100, height: 100, capturedAt: 0 });
const target = () => ({ label: '按钮', bbox: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, confidence: 0.9 });

function task(steps) {
  return { id: 't', title: '测试任务', app: 'Test', steps };
}

function step(overrides = {}) {
  return {
    id: 's1',
    instruction: '点击按钮',
    action: { type: 'click' },
    risk: 'safe',
    expect: '按钮被按下',
    ...overrides,
  };
}

test('定位命中且验证通过，任务完成', async () => {
  const trace = await runGuiTask(task([step()]), {
    observe: async () => obs(),
    locate: async () => target(),
    act: async () => ({ delivered: true, note: '' }),
    verify: async () => ({ result: 'confirmed', evidence: 'ok' }),
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.status, 'done');
  assert.equal(trace.reason, undefined);
  assert.equal(trace.steps[0].status, 'done');
  assert.equal(trace.steps[0].attempts.length, 1);
});

test('一直找不到目标：走完尝试次数后报 no_target', async () => {
  let acted = 0;
  const trace = await runGuiTask(task([step()]), {
    observe: async () => obs(),
    locate: async () => null,
    act: async () => {
      acted += 1;
      return { delivered: true, note: '' };
    },
    verify: async () => ({ result: 'confirmed', evidence: 'ok' }),
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.status, 'aborted');
  assert.equal(trace.reason, 'no_target');
  assert.equal(acted, 0);
  assert.equal(trace.steps[0].attempts.length, 3);
});

test('第一次验证失败，第二次成功；动作按阶梯从 ax 降到 bg_pixel', async () => {
  const deliveries = [];
  let verifyCount = 0;
  const trace = await runGuiTask(task([step()]), {
    observe: async () => obs(),
    locate: async () => target(),
    act: async (_step, _target, delivery) => {
      deliveries.push(delivery);
      return { delivered: true, note: '' };
    },
    verify: async () => {
      verifyCount += 1;
      return verifyCount === 1
        ? { result: 'failed', evidence: '没变化' }
        : { result: 'confirmed', evidence: '变了' };
    },
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.status, 'done');
  assert.deepEqual(deliveries, ['ax', 'bg_pixel']);
});

test('不可逆动作没有确认时默认拒绝', async () => {
  let acted = 0;
  const trace = await runGuiTask(task([step({ risk: 'irreversible' })]), {
    observe: async () => obs(),
    locate: async () => target(),
    act: async () => {
      acted += 1;
      return { delivered: true, note: '' };
    },
    verify: async () => ({ result: 'confirmed', evidence: 'ok' }),
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.status, 'aborted');
  assert.equal(trace.reason, 'guard_denied');
  assert.equal(acted, 0);
});

test('确认被拒绝时不执行动作', async () => {
  let acted = 0;
  const trace = await runGuiTask(task([step({ risk: 'irreversible' })]), {
    observe: async () => obs(),
    locate: async () => target(),
    act: async () => {
      acted += 1;
      return { delivered: true, note: '' };
    },
    verify: async () => ({ result: 'confirmed', evidence: 'ok' }),
    confirm: async () => false,
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.reason, 'guard_denied');
  assert.equal(acted, 0);
});

test('同一个目标连续失败：报 loop_detected，而不是继续点', async () => {
  const trace = await runGuiTask(task([step()]), {
    observe: async () => obs(),
    locate: async () => target(),
    act: async () => ({ delivered: true, note: '' }),
    verify: async () => ({ result: 'failed', evidence: '没变化' }),
    wait: async () => {},
    now: () => 0,
  });
  assert.equal(trace.status, 'aborted');
  assert.equal(trace.reason, 'loop_detected');
  assert.equal(trace.steps[0].attempts.length, 3);
});

test('定位预算用完就停，不无限重试', async () => {
  const steps = [step({ id: 's1' }), step({ id: 's2' }), step({ id: 's3' })];
  const trace = await runGuiTask(
    task(steps),
    {
      observe: async () => obs(),
      locate: async () => null,
      act: async () => ({ delivered: true, note: '' }),
      verify: async () => ({ result: 'confirmed', evidence: 'ok' }),
      wait: async () => {},
      now: () => 0,
    },
    { maxLocateCalls: 2 },
  );
  assert.equal(trace.status, 'aborted');
  assert.equal(trace.reason, 'budget');
  assert.equal(trace.locateCalls, 2);
});

test('IoU 能区分重叠与不重叠', () => {
  const a = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }), 0);
  const shifted = { x: 0.1, y: 0.1, width: 0.1, height: 0.2 };
  assert.ok(iou(a, shifted) > 0.4 && iou(a, shifted) < 0.6);
});

test('定位提示把指令放在图片之前，并带 JSON 约束', () => {
  const prompt = buildGroundingPrompt(step(), obs(), { grid: 20 });
  assert.ok(prompt.user.startsWith('目标：点击按钮'));
  assert.match(prompt.user, /20x20/);
  assert.match(prompt.user, /"found":true/);
  assert.match(prompt.user, /0\.\.999/);
  assert.doesNotMatch(prompt.user, /1440x900|屏幕：\d+x\d+/);
  assert.equal(prompt.imagePosition, 'after_text');
});

test('解析定位回复：兼容代码块、缺字段、像素坐标', () => {
  const ok = parseGroundingReply('```json\n{"found":true,"label":"保存","bbox":[0.8,0.9,0.1,0.05],"confidence":0.9}\n```');
  assert.equal(ok?.label, '保存');
  assert.ok(ok && Math.abs(ok.bbox.x - 0.8) < 1e-9);

  assert.equal(parseGroundingReply('{"found":false,"reason":"看不到"}'), null);
  assert.equal(parseGroundingReply('没有 JSON'), null);
  assert.equal(parseGroundingReply('{"found":true,"bbox":[0.5]}'), null);

  const pixels = parseGroundingReply('{"found":true,"label":"x","bbox":[800,900,100,50],"confidence":2}');
  assert.ok(pixels && Math.abs(pixels.bbox.x - 800 / 999) < 1e-9);
  assert.equal(pixels?.confidence, 1);
});

test('zoom 裁剪：小目标至少裁到 minSize，边缘不越界', () => {
  const crop = expandForZoom({ x: 0.04, y: 0.07, width: 0.011, height: 0.018 }, 3, 0.12);
  assert.equal(crop.width, 0.12);
  assert.equal(crop.height, 0.12);
  assert.ok(crop.x >= 0 && crop.x + crop.width <= 1 + 1e-9);
  const edge = expandForZoom({ x: 0.95, y: 0.95, width: 0.04, height: 0.04 }, 3, 0.12);
  assert.ok(edge.x + edge.width <= 1 + 1e-9);
  assert.ok(edge.y + edge.height <= 1 + 1e-9);
});

test('zoom 映射：裁剪图内的框能还原回整屏', () => {
  const crop = { x: 0.4, y: 0.6, width: 0.2, height: 0.2 };
  const inner = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const full = mapCropTarget(crop, inner);
  assert.ok(Math.abs(full.x - 0.45) < 1e-9);
  assert.ok(Math.abs(full.y - 0.65) < 1e-9);
  assert.ok(Math.abs(full.width - 0.1) < 1e-9);
  assert.ok(Math.abs(full.height - 0.1) < 1e-9);
});

test('refine prompt 明确要求裁剪图内坐标，并带裁剪区域', () => {
  const crop = { x: 0.4, y: 0.6, width: 0.2, height: 0.2 };
  const prompt = buildRefinePrompt(step(), crop, obs(), 1000);
  assert.match(prompt.system, /裁剪图内/);
  assert.match(prompt.user, /裁剪区域/);
  assert.match(prompt.user, /x=0\.4000/);
  assert.match(prompt.user, /1000px/);
});

test('0..999 约定：提示词和解析都按 999 缩放', () => {
  const prompt = buildGroundingPrompt(step(), obs(), { coordScale: '999' });
  assert.match(prompt.user, /0\.\.999/);
  assert.match(prompt.user, /右下角是 \(999,999\)/);
  const parsed = parseGroundingReply(
    '{"found":true,"label":"x","bbox":[500,450,100,50],"confidence":0.9}',
    '999',
  );
  assert.ok(parsed);
  assert.ok(Math.abs(parsed.bbox.x - 500 / 999) < 1e-9);
  assert.ok(Math.abs(parsed.bbox.width - 100 / 999) < 1e-9);
});

test('模拟器：单步全错但验证全盲，会产出“假成功”', async () => {
  const scenario = findScenario('t01');
  assert.ok(scenario);
  const result = await runScenario(scenario, {
    hitRate: 0,
    missRate: 0,
    noopRate: 0,
    verifyBlindRate: 1,
    deliveryFailRate: 0,
    confirmDenyRate: 0,
    stickyRate: 0,
    seed: 1,
  });
  assert.equal(result.trace.status, 'done');
  assert.equal(result.falseSuccess, true);
  assert.ok(result.wrongTargets > 0);
});

test('模拟器：定位全中时任务完成且没有假成功', async () => {
  const scenario = findScenario('t14');
  assert.ok(scenario);
  const result = await runScenario(scenario, {
    hitRate: 1,
    missRate: 0,
    noopRate: 0,
    verifyBlindRate: 0,
    deliveryFailRate: 0,
    confirmDenyRate: 0,
    stickyRate: 0,
    seed: 2,
  });
  assert.equal(result.trace.status, 'done');
  assert.equal(result.falseSuccess, false);
  assert.equal(result.wrongTargets, 0);
});

test('20 条场景 id 唯一，且每条最多 3 步', () => {
  assert.equal(SCENARIOS.length, 20);
  const ids = new Set(SCENARIOS.map((s) => s.id));
  assert.equal(ids.size, SCENARIOS.length);
  for (const scenario of SCENARIOS) {
    assert.ok(scenario.steps.length >= 1 && scenario.steps.length <= 3);
    for (const s of scenario.steps) {
      assert.ok(s.truth.width > 0 && s.truth.height > 0);
    }
  }
});


const AX_NODES = [
  { path: '0', role: 'AXWindow', frame: [55, 45, 1280, 780], actions: ['AXRaise'] },
  { path: '0.1', role: 'AXButton', desc: '新建会话', frame: [69, 149, 252, 38], actions: ['AXPress'] },
  { path: '0.2', role: 'AXButton', subrole: 'AXCloseButton', frame: [70, 62, 16, 16], actions: ['AXPress'] },
  { path: '0.3', role: 'AXGroup', desc: '全局面板', frame: [67, 199, 256, 112], actions: ['AXPress'] },
  { path: '0.4', role: 'AXGroup', frame: [0, 0, 1440, 900], actions: ['AXPress'] },
];

test('AX：只把有动作的元素当作可操作，组不算', () => {
  const hit = findActionableAt(AX_NODES, { x: 78, y: 70 });
  assert.equal(hit?.subrole, 'AXCloseButton');
  assert.equal(findActionableAt(AX_NODES, { x: 120, y: 220 }), null);
});

test('AX 吸附：视觉中心落在按钮内就换成精确 frame', () => {
  const target = {
    label: '关闭',
    bbox: { x: 0.049, y: 0.072, width: 0.014, height: 0.022 },
    confidence: 0.7,
  };
  const result = snapTargetToAx(target, AX_NODES, 1440, 900);
  assert.equal(result.snapped, true);
  assert.ok(Math.abs(result.target.bbox.x - 70 / 1440) < 1e-9);
  assert.ok(result.target.confidence >= 0.95);
});

test('AX 吸附：没有可操作元素时保持原样', () => {
  const target = {
    label: '内容区',
    bbox: { x: 0.5, y: 0.5, width: 0.05, height: 0.05 },
    confidence: 0.6,
  };
  const result = snapTargetToAx(target, AX_NODES, 1440, 900);
  assert.equal(result.snapped, false);
  assert.deepEqual(result.target, target);
});

test('AX 文本匹配与坏 JSON', () => {
  assert.equal(matchByLabels(AX_NODES, ['新建会话'])?.path, '0.1');
  assert.equal(matchByLabels(AX_NODES, ['不存在']), null);
  assert.equal(parseAxSnapshot('not json'), null);
  const snapshot = parseAxSnapshot(JSON.stringify({ app: 'x', bundle: 'b', pid: 1, nodes: AX_NODES }));
  assert.equal(snapshot?.nodes.length, 5);
});
