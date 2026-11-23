#!/usr/bin/env node
/**
 * 真实 grounding 校准：用当前屏幕 + 20 个目标，量“单步定位率”。
 *
 *   node --experimental-strip-types scripts/gui-grounding-eval.mjs
 *   node --experimental-strip-types scripts/gui-grounding-eval.mjs --limit 3
 *
 * 需要 .env.local 里的 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_VISION_MODEL。
 * 不会打印 key。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centerOf, containsPoint, iou } from '../src/main/gui/geometry.ts';
import { buildGroundingPrompt } from '../src/main/gui/prompt.ts';
import { parseGroundingReply } from '../src/main/gui/prompt.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'evals/gui/current-screen');

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
const model = argValue('--model', env.DEEPSEEK_VISION_MODEL);
const coord = argValue('--coord', '999');
if (coord !== 'unit' && coord !== '999') {
  console.error('--coord 只能是 unit 或 999');
  process.exit(1);
}
const outName = argValue('--out', coord === '999' ? 'results-999.json' : 'results.json');
if (!apiKey || !baseUrl || !model) {
  console.error('缺少 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_VISION_MODEL');
  process.exit(1);
}

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 0;

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
const imagePath = path.join(dir, spec.image);
const imageB64 = fs.readFileSync(imagePath).toString('base64');
const dataUrl = `data:image/jpeg;base64,${imageB64}`;
const observation = {
  id: 'current-screen',
  width: spec.width,
  height: spec.height,
  capturedAt: Date.now(),
};

const tasks = limit > 0 ? spec.tasks.slice(0, limit) : spec.tasks;

async function callVision(systemText, userText) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemText },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = await response.json();
  if (process.env.DEBUG) {
    const message = body?.choices?.[0]?.message ?? {};
    console.error(
      JSON.stringify({
        finish: body?.choices?.[0]?.finish_reason,
        usage: body?.usage,
        keys: Object.keys(message),
        contentLen: String(message.content ?? '').length,
        reasoningLen: String(message.reasoning_content ?? '').length,
      }),
    );
  }
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    : String(content ?? '');
  return { text, elapsed };
}

const rows = [];
for (const task of tasks) {
  const prompt = buildGroundingPrompt(task, observation, {
    hint: '这是 macOS 桌面应用 DeepSeek Harness 的截图，界面以中文为主；坐标原点在左上角。',
    coordScale: coord,
  });
  try {
    const { text, elapsed } = await callVision(prompt.system, prompt.user);
    const target = parseGroundingReply(text, coord);
    const score = target ? iou(target.bbox, task.truth) : 0;
    // 点击是否命中，看中心点是否落在真值框内；IoU 另算，作为严格指标
    const centerHit = target ? containsPoint(task.truth, centerOf(target.bbox)) : false;
    const strictHit = score >= 0.5;
    const result = target ? (centerHit ? 'hit' : 'wrong') : 'miss';
    rows.push({
      id: task.id,
      instruction: task.instruction,
      result,
      centerHit,
      strictHit,
      iou: Number(score.toFixed(3)),
      confidence: target?.confidence ?? null,
      prediction: target?.bbox ?? null,
      truth: task.truth,
      latencyMs: elapsed,
      reply: text.slice(0, 200),
    });
    console.log(
      `${task.id} ${result.padEnd(5)} iou=${score.toFixed(2)} ${elapsed}ms  ${task.instruction}`,
    );
  } catch (error) {
    rows.push({
      id: task.id,
      instruction: task.instruction,
      result: 'error',
      iou: 0,
      confidence: null,
      prediction: null,
      truth: task.truth,
      latencyMs: null,
      reply: String(error).slice(0, 200),
    });
    console.log(`${task.id} error  ${String(error).slice(0, 120)}`);
  }
}

const ok = rows.filter((row) => row.result !== 'error');
const hits = rows.filter((row) => row.result === 'hit');
const wrong = rows.filter((row) => row.result === 'wrong');
const miss = rows.filter((row) => row.result === 'miss');
const latencies = ok.map((row) => row.latencyMs ?? 0).sort((a, b) => a - b);
const pct = (n) => (rows.length ? ((n / rows.length) * 100).toFixed(1) + '%' : '0%');

const strict = rows.filter((row) => row.strictHit);
const padHit = (pad) =>
  rows.filter((row) => {
    if (!row.prediction) return false;
    const t = row.truth;
    const cx = row.prediction.x + row.prediction.width / 2;
    const cy = row.prediction.y + row.prediction.height / 2;
    const px = pad / spec.width;
    const py = pad / spec.height;
    return (
      cx >= t.x - px && cx <= t.x + t.width + px && cy >= t.y - py && cy <= t.y + t.height + py
    );
  }).length;
const summary = {
  image: spec.image,
  model,
  tasks: rows.length,
  hitRate: rows.length ? hits.length / rows.length : 0,
  strictRate: rows.length ? strict.length / rows.length : 0,
  pad4Rate: rows.length ? padHit(4) / rows.length : 0,
  pad8Rate: rows.length ? padHit(8) / rows.length : 0,
  wrongRate: rows.length ? wrong.length / rows.length : 0,
  missRate: rows.length ? miss.length / rows.length : 0,
  errorRate: rows.length ? (rows.length - ok.length) / rows.length : 0,
  meanIou: ok.length ? ok.reduce((sum, row) => sum + row.iou, 0) / ok.length : 0,
  latencyP50: latencies[Math.floor(latencies.length * 0.5)] ?? null,
  latencyP90: latencies[Math.floor(latencies.length * 0.9)] ?? null,
};

console.log('\n=== 汇总 ===');
console.log(`任务 ${summary.tasks} · 严格点击命中 ${pct(hits.length)} · ±4px ${pct(padHit(4))} · ±8px ${pct(padHit(8))} · IoU≥0.5 ${pct(strict.length)} · 点错 ${pct(wrong.length)} · 未找到 ${pct(miss.length)}`);
console.log(`平均 IoU ${summary.meanIou.toFixed(3)} · 延迟 p50 ${summary.latencyP50}ms p90 ${summary.latencyP90}ms`);

fs.writeFileSync(
  path.join(dir, outName),
  JSON.stringify({ summary: { ...summary, model, coord }, rows }, null, 2),
);
console.log(`\n模型 ${model} · 坐标 ${coord} · 结果写入 evals/gui/current-screen/${outName}`);
