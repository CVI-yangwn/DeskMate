#!/usr/bin/env node
/**
 * 验证器评测：给“动作前/动作后”两张图 + 预期结果，量漏判率。
 *
 *   node --experimental-strip-types scripts/gui-verifier-eval.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVerificationPrompt } from '../src/main/gui/prompt.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'evals/gui/verifier');

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
if (!apiKey || !baseUrl) {
  console.error('缺少 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
const observation = { id: 'verifier', width: spec.width, height: spec.height, capturedAt: Date.now() };

function dataUrl(name) {
  return `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, name)).toString('base64')}`;
}

function parseVerdict(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!['confirmed', 'unverifiable', 'failed'].includes(obj.result)) return null;
    return { result: obj.result, evidence: String(obj.evidence ?? '').slice(0, 200) };
  } catch {
    return null;
  }
}

async function verify(item) {
  const step = {
    id: item.id,
    instruction: '执行受控动作',
    action: { type: 'click' },
    risk: 'safe',
    expect: item.expect,
  };
  const prompt = buildVerificationPrompt(step, observation);
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt.user },
            { type: 'image_url', image_url: { url: dataUrl(item.before) } },
            { type: 'text', text: '动作后的截图：' },
            { type: 'image_url', image_url: { url: dataUrl(item.after) } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    : String(content ?? '');
  return { verdict: parseVerdict(text), raw: text.slice(0, 200), elapsed };
}

const rows = [];
for (const item of spec.cases) {
  try {
    const { verdict, raw, elapsed } = await verify(item);
    const result = verdict?.result ?? 'parse-error';
    const correct = item.positive ? result === 'confirmed' : result !== 'confirmed';
    const blind = !item.positive && result === 'confirmed';
    rows.push({
      id: item.id,
      expect: item.expect,
      positive: item.positive,
      result,
      correct,
      blind,
      evidence: verdict?.evidence ?? raw,
      latencyMs: elapsed,
    });
    console.log(
      `${item.id} ${item.positive ? 'P' : 'N'} → ${result.padEnd(12)} ${correct ? 'ok ' : 'ERR'} ${elapsed}ms  ${item.expect}`,
    );
  } catch (error) {
    rows.push({
      id: item.id,
      expect: item.expect,
      positive: item.positive,
      result: 'error',
      correct: false,
      blind: false,
      evidence: String(error).slice(0, 200),
      latencyMs: null,
    });
    console.log(`${item.id} error ${String(error).slice(0, 120)}`);
  }
}

const positive = rows.filter((row) => row.positive);
const negative = rows.filter((row) => !row.positive);
const confirmedPositive = positive.filter((row) => row.result === 'confirmed').length;
const rejectedNegative = negative.filter((row) => row.result !== 'confirmed').length;
const blind = negative.filter((row) => row.result === 'confirmed').length;
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '0%');

const summary = {
  model,
  total: rows.length,
  positive: positive.length,
  negative: negative.length,
  positiveConfirmRate: positive.length ? confirmedPositive / positive.length : 0,
  negativeRejectRate: negative.length ? rejectedNegative / negative.length : 0,
  blindRate: negative.length ? blind / negative.length : 0,
  accuracy: rows.filter((row) => row.correct).length / rows.length,
};

console.log('\n=== 验证器 ===');
console.log(
  `正例确认 ${pct(confirmedPositive, positive.length)} · 反例拒绝 ${pct(rejectedNegative, negative.length)} · ` +
    `漏判（反例被确认）${pct(blind, negative.length)} · 总准确 ${pct(rows.filter((r) => r.correct).length, rows.length)}`,
);
console.log(rows.filter((row) => !row.correct).map((row) => `  ✗ ${row.id} ${row.result} ${row.evidence}`).join('\n'));

fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ summary, rows }, null, 2));
console.log('\n结果写入 evals/gui/verifier/results.json');
