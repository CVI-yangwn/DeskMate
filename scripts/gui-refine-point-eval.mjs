#!/usr/bin/env node
/**
 * Zoom refine v2：方形裁剪 + 只问中心点。
 *
 *   node --experimental-strip-types scripts/gui-refine-point-eval.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centerOf, containsPoint } from '../src/main/gui/geometry.ts';
import { buildGroundingPrompt, parseGroundingReply } from '../src/main/gui/prompt.ts';
import { buildRefinePointPrompt, mapCropPoint, squareCrop } from '../src/main/gui/refine.ts';
import { cropImage } from './lib/crop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'evals/gui/current-screen');
const zoomDir = path.join(dir, 'zoom-point');
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
const outName = argValue('--out', 'results-refine-point.json');
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

function parsePoint(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj?.found !== true) return null;
    if (Array.isArray(obj.point) && obj.point.length === 2) {
      const [rawX, rawY] = obj.point.map(Number);
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
      return { x: rawX > 1 ? rawX / 1000 : rawX, y: rawY > 1 ? rawY / 1000 : rawY };
    }
    if (Array.isArray(obj.bbox) && obj.bbox.length === 4) {
      const box = parseGroundingReply(text, 'unit');
      if (box) return centerOf(box.bbox);
    }
  } catch {
    return null;
  }
  return null;
}

function cropSquare(source, crop, outPath, size = 900) {
  const W = spec.width;
  const H = spec.height;
  const side = Math.max(1, Math.min(W, H, Math.round(crop.width * W)));
  const x = Math.max(0, Math.min(W - side, Math.round((crop.x + crop.width / 2) * W - side / 2)));
  const y = Math.max(0, Math.min(H - side, Math.round((crop.y + crop.height / 2) * H - side / 2)));
  cropImage(source, outPath, { x, y, w: side, h: side }, size, size);
  return { x, y, side };
}

const rows = [];
for (const task of tasks) {
  const basePrompt = buildGroundingPrompt(task, observation, {
    hint: '这是 macOS 桌面应用 DeepSeek Harness 的截图，界面以中文为主；坐标原点在左上角。',
    coordScale: '999',
  });
  const baseCall = await callVision(basePrompt.system, basePrompt.user, imageDataUrl);
  const baseTarget = parseGroundingReply(baseCall.text, '999');
  const basePoint = baseTarget ? centerOf(baseTarget.bbox) : null;

  const crop = baseTarget ? squareCrop(baseTarget.bbox, spec.width, spec.height, 4, 220) : null;
  let point = null;
  let cropPx = null;
  let refineMs = 0;
  let error = null;
  if (crop) {
    const cropPath = path.join(zoomDir, `${task.id}.jpg`);
    cropPx = cropSquare(imagePath, crop, cropPath);
    const prompt = buildRefinePointPrompt(task, crop, observation, 900);
    const call = await callVision(prompt.system, prompt.user, `data:image/jpeg;base64,${fs.readFileSync(cropPath).toString('base64')}`);
    refineMs = call.elapsed;
    const inner = parsePoint(call.text);
    if (inner) point = mapCropPoint(crop, inner);
    else error = '解析失败';
  }

  const truthCenter = centerOf(task.truth);
  const judge = (p, truth) => (p ? (containsPoint(truth, p) ? 'hit' : 'wrong') : 'miss');
  const dist = (p) => (p ? Math.hypot((p.x - truthCenter.x) * spec.width, (p.y - truthCenter.y) * spec.height) : null);
  const base = judge(basePoint, task.truth);
  const refined = judge(point, task.truth);
  const improved = base !== 'hit' && refined === 'hit' ? 'fixed' : base === 'hit' && refined !== 'hit' ? 'broke' : 'same';

  rows.push({
    id: task.id,
    instruction: task.instruction,
    truth: task.truth,
    base,
    refined,
    improved,
    basePoint,
    point,
    crop,
    cropPx,
    baseDist: dist(basePoint),
    refineDist: dist(point),
    latencyBase: baseCall.elapsed,
    latencyRefine: refineMs,
    error,
  });

  console.log(
    `${task.id} base=${base.padEnd(5)} point=${refined.padEnd(5)} ${improved.padEnd(5)} ` +
      `dist ${Math.round(dist(basePoint) ?? -1)}→${Math.round(dist(point) ?? -1)}px  ${task.instruction}`,
  );
}

const hits = (key) => rows.filter((row) => row[key] === 'hit').length;
const small = rows.filter((row) => row.truth.width * row.truth.height < 0.001);
const smallHits = (key) => small.filter((row) => row[key] === 'hit').length;
const meanDist = (key) => {
  const vals = rows.map((row) => row[key]).filter((v) => v !== null);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '0%');

const summary = {
  model,
  tasks: rows.length,
  baseHit: hits('base') / rows.length,
  pointHit: hits('refined') / rows.length,
  fixed: rows.filter((row) => row.improved === 'fixed').length,
  broke: rows.filter((row) => row.improved === 'broke').length,
  baseDistPx: meanDist('baseDist'),
  pointDistPx: meanDist('refineDist'),
  smallTasks: small.length,
  smallBaseHit: small.length ? smallHits('base') / small.length : 0,
  smallPointHit: small.length ? smallHits('refined') / small.length : 0,
  avgLatencyBase: rows.reduce((s, r) => s + r.latencyBase, 0) / rows.length,
  avgLatencyRefine: rows.reduce((s, r) => s + r.latencyRefine, 0) / rows.filter((r) => r.latencyRefine).length,
};

console.log('\n=== 汇总 ===');
console.log(
  `整屏点 ${pct(hits('base'), rows.length)} → 方形裁剪点 ${pct(hits('refined'), rows.length)} · ` +
    `修好 ${summary.fixed} · 弄坏 ${summary.broke}`,
);
console.log(
  `中心误差 ${Math.round(summary.baseDistPx)}px → ${Math.round(summary.pointDistPx)}px · ` +
    `小目标 ${pct(smallHits('base'), small.length)} → ${pct(smallHits('refined'), small.length)} · ` +
    `延迟 +${Math.round(summary.avgLatencyRefine)}ms`,
);

fs.writeFileSync(path.join(dir, outName), JSON.stringify({ summary, rows }, null, 2));
console.log(`\n结果写入 evals/gui/current-screen/${outName}`);
