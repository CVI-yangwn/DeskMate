#!/usr/bin/env node
/**
 * Zoom refine 对比：同一批目标，先整屏定位，再裁 3x 区域放大重定位，比较两者。
 *
 *   node --experimental-strip-types scripts/gui-refine-eval.mjs
 *   node --experimental-strip-types scripts/gui-refine-eval.mjs --limit 5
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centerOf, containsPoint, iou } from '../src/main/gui/geometry.ts';
import { buildGroundingPrompt, parseGroundingReply } from '../src/main/gui/prompt.ts';
import { buildRefinePrompt, expandForZoom, mapCropTarget } from '../src/main/gui/refine.ts';
import { cropImage } from './lib/crop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'evals/gui/current-screen');
const zoomDir = path.join(dir, 'zoom');
fs.mkdirSync(zoomDir, { recursive: true });

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = { ...loadEnv(path.join(root, '.env.local')), ...process.env };
const apiKey = env.DEEPSEEK_API_KEY;
const baseUrl = (env.DEEPSEEK_BASE_URL ?? '').replace(/\/+$/, '');
const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const model = argValue('--model', 'DeepSeek-V4.1-Flash');
const limit = Number(argValue('--limit', '0'));
const outName = argValue('--out', 'results-refine.json');
if (!apiKey || !baseUrl) {
  console.error('缺少 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
const imagePath = path.join(dir, spec.image);
const imageDataUrl = `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}`;
const observation = { id: 'current-screen', width: spec.width, height: spec.height, capturedAt: Date.now() };
const tasks = limit > 0 ? spec.tasks.slice(0, limit) : spec.tasks;

async function callVision(system, user, dataUrl) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    : String(content ?? '');
  return { text, elapsed };
}

function cropToFile(source, crop, outPath) {
  const W = spec.width;
  const H = spec.height;
  const x = Math.max(0, Math.min(W - 1, Math.round(crop.x * W)));
  const y = Math.max(0, Math.min(H - 1, Math.round(crop.y * H)));
  const w = Math.max(1, Math.min(W - x, Math.round(crop.width * W)));
  const h = Math.max(1, Math.min(H - y, Math.round(crop.height * H)));
  const targetW = Math.max(600, Math.min(1100, w * 3));
  const targetH = Math.max(1, Math.round((h * targetW) / w));
  cropImage(source, outPath, { x, y, w, h }, targetW, targetH);
  return { x, y, w, h, targetW, targetH };
}

function score(prediction, truth) {
  if (!prediction) return { result: 'miss', iou: 0 };
  const hit = containsPoint(truth, centerOf(prediction));
  return { result: hit ? 'hit' : 'wrong', iou: iou(prediction, truth) };
}

const rows = [];
for (const task of tasks) {
  const prompt = buildGroundingPrompt(task, observation, {
    hint: '这是 macOS 桌面应用 DeepSeek Harness 的截图，界面以中文为主；坐标原点在左上角。',
    coordScale: '999',
  });
  const baseCall = await callVision(prompt.system, prompt.user, imageDataUrl);
  const baseTarget = parseGroundingReply(baseCall.text, '999');
  const base = score(baseTarget?.bbox, task.truth);

  let refined = { result: 'miss', iou: 0 };
  let refinedTarget = null;
  let cropInfo = null;
  let refineMs = 0;
  let refineError = null;

  if (baseTarget) {
    const crop = expandForZoom(baseTarget.bbox, 3, 0.12);
    const cropPath = path.join(zoomDir, `${task.id}.jpg`);
    cropInfo = cropToFile(imagePath, crop, cropPath);
    const refinePrompt = buildRefinePrompt(task, crop, observation, cropInfo.targetW);
    const refineCall = await callVision(
      refinePrompt.system,
      refinePrompt.user,
      `data:image/jpeg;base64,${fs.readFileSync(cropPath).toString('base64')}`,
    );
    refineMs = refineCall.elapsed;
    const inner = parseGroundingReply(refineCall.text, 'unit');
    if (inner) {
      refinedTarget = mapCropTarget(crop, inner.bbox);
      refined = score(refinedTarget, task.truth);
    } else {
      refineError = '解析失败';
    }
  }

  const improved =
    base.result !== 'hit' && refined.result === 'hit'
      ? 'fixed'
      : base.result === 'hit' && refined.result !== 'hit'
        ? 'broke'
        : 'same';

  rows.push({
    id: task.id,
    instruction: task.instruction,
    truth: task.truth,
    base,
    refined,
    improved,
    baseTarget: baseTarget?.bbox ?? null,
    refinedTarget,
    crop: cropInfo,
    latencyBase: baseCall.elapsed,
    latencyRefine: refineMs,
    refineError,
  });

  console.log(
    `${task.id} base=${base.result.padEnd(5)} refine=${refined.result.padEnd(5)} ${improved.padEnd(5)} ` +
      `iou ${base.iou.toFixed(2)}→${refined.iou.toFixed(2)}  ${task.instruction}`,
  );
}

const hits = (key) => rows.filter((row) => row[key].result === 'hit').length;
const small = rows.filter((row) => row.truth.width * row.truth.height < 0.001);
const smallHits = (key) => small.filter((row) => row[key].result === 'hit').length;
const meanIou = (key) => rows.reduce((sum, row) => sum + row[key].iou, 0) / rows.length;
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '0%');

const summary = {
  model,
  tasks: rows.length,
  baseHit: hits('base') / rows.length,
  refineHit: hits('refined') / rows.length,
  fixed: rows.filter((row) => row.improved === 'fixed').length,
  broke: rows.filter((row) => row.improved === 'broke').length,
  baseIou: meanIou('base'),
  refineIou: meanIou('refined'),
  smallTasks: small.length,
  smallBaseHit: small.length ? smallHits('base') / small.length : 0,
  smallRefineHit: small.length ? smallHits('refined') / small.length : 0,
  avgLatencyBase: rows.reduce((s, r) => s + r.latencyBase, 0) / rows.length,
  avgLatencyRefine: rows.reduce((s, r) => s + r.latencyRefine, 0) / rows.filter((r) => r.latencyRefine).length,
};

console.log('\n=== 汇总 ===');
console.log(
  `整屏 ${pct(hits('base'), rows.length)} → zoom ${pct(hits('refined'), rows.length)} · ` +
    `修好 ${summary.fixed} · 弄坏 ${summary.broke} · IoU ${summary.baseIou.toFixed(2)}→${summary.refineIou.toFixed(2)}`,
);
console.log(
  `小目标（<0.001 面积）${pct(smallHits('base'), small.length)} → ${pct(smallHits('refined'), small.length)} · ` +
    `延迟 ${Math.round(summary.avgLatencyBase)}ms + ${Math.round(summary.avgLatencyRefine)}ms`,
);

fs.writeFileSync(path.join(dir, outName), JSON.stringify({ summary, rows }, null, 2));
console.log(`\n结果写入 evals/gui/current-screen/${outName}`);
