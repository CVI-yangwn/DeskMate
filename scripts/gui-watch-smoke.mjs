#!/usr/bin/env node
/** 真实 watcher：盯着计算器显示区，看到 7 就点清除。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalMacEnvironment } from '../src/main/gui/environment.ts';
import { runGuiReact } from '../src/main/gui/react.ts';
import { runWatcher } from '../src/main/gui/watcher.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gui = path.join(root, 'native/gui');
const axdump = path.join(root, 'native/axdump');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vars = {};
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const baseUrl = vars.DEEPSEEK_BASE_URL.replace(/\/+$/, '');
const apiKey = vars.DEEPSEEK_API_KEY;
const model = 'DeepSeek-V4.1-Flash';

const keepAwake = spawn('caffeinate', ['-d', '-u', '-t', '300'], { stdio: 'ignore' });

function capture() {
  const png = '/tmp/gui-watch.png';
  const jpg = '/tmp/gui-watch.jpg';
  execFileSync('screencapture', ['-x', png]);
  execFileSync('sips', ['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', jpg], { stdio: 'ignore' });
  return {
    screenshot: `data:image/jpeg;base64,${fs.readFileSync(jpg).toString('base64')}`,
    width: 1600,
    height: 1000,
    screenWidth: 1440,
    screenHeight: 900,
    app: 'Desktop',
    title: '',
  };
}

async function act(action, params) {
  const run = (args) => execFileSync(gui, args, { timeout: 8000 });
  switch (action) {
    case 'click':
      run(['click', '--x', String(params.x), '--y', String(params.y)]);
      return { success: true, message: `clicked (${params.x}, ${params.y})` };
    case 'type':
      run(['type', '--text', String(params.text)]);
      return { success: true, message: `typed ${params.text}` };
    case 'press_key':
      run(['key', '--combo', String(params.key)]);
      return { success: true, message: `pressed ${params.key}` };
    default:
      return { success: false, message: `unsupported ${action}`, error: 'unsupported' };
  }
}

async function complete(body) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function judge(condition, observation) {
  const data = await complete({
    model,
    temperature: 0,
    max_tokens: 800,
    messages: [
      {
        role: 'system',
        content:
          '你是屏幕条件判断器。只根据当前截图判断条件是否成立，不要推测。' +
          '只输出 JSON：{"match":true|false,"evidence":"一句话"}。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `条件：${condition}\n当前截图是否满足？` },
          { type: 'image_url', image_url: { url: observation.screenshot } },
        ],
      },
    ],
  });
  const text = String(data.choices?.[0]?.message?.content ?? '');
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return { match: false, evidence: 'judge 无 JSON' };
  try {
    const parsed = JSON.parse(match[0]);
    return { match: parsed.match === true, evidence: String(parsed.evidence ?? '') };
  } catch {
    return { match: false, evidence: 'judge JSON 解析失败' };
  }
}

execFileSync('open', ['-b', 'com.apple.calculator']);
await sleep(2000);
execFileSync('osascript', ['-e', 'tell application "Calculator" to activate']);
await sleep(800);

for (let i = 0; i < 5; i += 1) {
  try {
    execFileSync(gui, ['press', '--bundle', 'com.apple.calculator', '--label', '清除'], { stdio: 'ignore' });
    break;
  } catch {
    await sleep(600);
  }
}
execFileSync(gui, ['press', '--bundle', 'com.apple.calculator', '--label', '7'], { stdio: 'ignore' });
await sleep(500);

const env = new LocalMacEnvironment({ capture, act, wait: sleep });
const condition = '计算器的显示区当前是否显示数字 7';
const task = '点击计算器上的清除按钮，让显示区变成 0';

const result = await runWatcher({
  check: async () => judge(condition, await env.observe()),
  act: async () => {
    const r = await runGuiReact(task, { env, model, complete, maxSteps: 3 });
    return { status: r.status, final: r.final };
  },
  sleep,
  intervalMs: 1500,
  maxChecks: 4,
});

console.log('watch status:', result.status, 'checks:', result.checks);
for (const event of result.events) console.log(' ', event.check, event.match, event.evidence);
if (result.action) console.log('action:', result.action.status, result.action.final);

try {
  const ax = JSON.parse(execFileSync(axdump, ['--bundle', 'com.apple.calculator'], { encoding: 'utf8' }));
  const texts = ax.nodes.filter((n) => n.role === 'AXStaticText').map((n) => n.value).filter(Boolean);
  console.log('calculator display:', texts.join(' | '));
} catch {
  console.log('axdump failed');
}

keepAwake.kill();
