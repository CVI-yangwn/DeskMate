#!/usr/bin/env node
/**
 * AX 覆盖与吸附评估（离线，不点击任何东西）。
 *
 *   node --experimental-strip-types scripts/gui-ax-eval.mjs
 *   node --experimental-strip-types scripts/gui-ax-eval.mjs --bundle com.deepseek.dsh
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findActionableAt, parseAxSnapshot, snapTargetToAx } from '../src/main/gui/ax.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'evals/gui/current-screen');
const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const bundle = argValue('--bundle', 'com.deepseek.dsh');
const binary = path.join(root, 'native/axdump');

if (!fs.existsSync(binary)) {
  console.error('缺少 native/axdump，先运行：swiftc -O native/axdump.swift -o native/axdump');
  process.exit(1);
}

const raw = execFileSync(binary, ['--bundle', bundle], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const snapshot = parseAxSnapshot(raw);
if (!snapshot) {
  console.error('AX dump 解析失败');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
const W = spec.width;
const H = spec.height;

const label = (node) => node?.desc || node?.title || node?.value || node?.role || '';
const rows = spec.tasks.map((task) => {
  const center = {
    x: (task.truth.x + task.truth.width / 2) * W,
    y: (task.truth.y + task.truth.height / 2) * H,
  };
  const node = findActionableAt(snapshot.nodes, center);
  return { id: task.id, instruction: task.instruction, node, hit: Boolean(node) };
});

console.log(`\nAX 快照：${snapshot.app} · ${snapshot.nodes.length} 个节点\n`);
console.table(
  rows.map((row) => ({
    任务: row.id,
    AX: row.hit ? '✓' : '—',
    角色: row.node?.role ?? '',
    标签: label(row.node).slice(0, 18),
    说明: row.instruction.slice(0, 28),
  })),
);

const covered = rows.filter((row) => row.hit).length;
console.log(`\n目标中心命中可操作 AX 元素：${covered}/${rows.length}（${((covered / rows.length) * 100).toFixed(0)}%）`);

const hit = (prediction, truth) => {
  if (!prediction) return false;
  const cx = prediction.x + prediction.width / 2;
  const cy = prediction.y + prediction.height / 2;
  return (
    cx >= truth.x &&
    cx <= truth.x + truth.width &&
    cy >= truth.y &&
    cy <= truth.y + truth.height
  );
};

console.log('\n吸附对已有预测的影响（离线）：');
for (const name of ['results-fixed-run1.json', 'results-fixed-run2.json', 'results-fixed-run3.json']) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let before = 0;
  let after = 0;
  let snapped = 0;
  let fixed = 0;
  let broke = 0;
  for (const row of data.rows) {
    if (!row.prediction) continue;
    const b = hit(row.prediction, row.truth);
    const result = snapTargetToAx(
      { label: row.instruction, bbox: row.prediction, confidence: 0.8 },
      snapshot.nodes,
      W,
      H,
    );
    const a = hit(result.target.bbox, row.truth);
    if (b) before += 1;
    if (a) after += 1;
    if (result.snapped) snapped += 1;
    if (!b && a) fixed += 1;
    if (b && !a) broke += 1;
  }
  console.log(
    `${name}: ${before}→${after}/20 · 吸附 ${snapped} · 修好 ${fixed} · 弄坏 ${broke}`,
  );
}
