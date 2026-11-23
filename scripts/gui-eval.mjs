#!/usr/bin/env node
/**
 * GUI loop 的离线评测：不接模型、不碰鼠标，只扫“单步定位准确率”对任务成功率的影响。
 *
 *   node --experimental-strip-types scripts/gui-eval.mjs
 *   SIMS=100 node --experimental-strip-types scripts/gui-eval.mjs
 *   node --experimental-strip-types scripts/gui-eval.mjs --json
 */
import { SCENARIOS } from '../src/main/gui/scenarios.ts';
import { DEFAULT_SIM, perTask, sweep } from '../src/main/gui/simulate.ts';

const sims = Number(process.env.SIMS ?? 200);
const json = process.argv.includes('--json');
const rates = [0.6, 0.7, 0.8, 0.9, 0.95];

const rows = await sweep(SCENARIOS, rates, sims);

if (json) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

console.log(
  `\nGUI loop 离线评测 · ${SCENARIOS.length} 条任务 × 每条 ${sims} 次模拟（固定种子，可复现）\n`,
);
console.table(
  rows.map((r) => ({
    单步定位: pct(r.hitRate),
    任务成功率: pct(r.taskSuccess),
    假成功: pct(r.falseSuccess),
    单步成功率: pct(r.stepSuccess),
    平均尝试: r.attemptPerTask.toFixed(2),
    定位落空: pct(r.missRate),
    点错目标: pct(r.wrongTargetRate),
  })),
);

const base = rows.find((r) => r.hitRate === 0.8) ?? rows[0];
console.log('\n80% 定位率下的中止原因：');
console.table(
  Object.entries(base.aborts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ 原因: reason, 次数: count, 占比: pct(count / base.tasks) })),
);

const tasks = await perTask(
  SCENARIOS,
  { ...DEFAULT_SIM, hitRate: 0.8, seed: 20261123 },
  sims,
);
console.log('\n逐任务（80% 定位率）：');
console.table(
  tasks.map((t) => ({
    任务: t.id,
    名称: t.title,
    成功率: pct(t.success),
    假成功: pct(t.falseSuccess),
    平均尝试: t.avgAttempts.toFixed(2),
    主要中止: t.topAbort,
  })),
);
