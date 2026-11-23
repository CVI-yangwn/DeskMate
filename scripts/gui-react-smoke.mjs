#!/usr/bin/env node
/** 真实 ReAct 冒烟：Calculator 上让模型自己看屏幕、点按钮。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalMacEnvironment } from '../src/main/gui/environment.ts';
import { runGuiReact } from '../src/main/gui/react.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gui = path.join(root, 'native/gui');
const axdump = path.join(root, 'native/axdump');

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}
const envVars = loadEnv(path.join(root, '.env.local'));
const baseUrl = (envVars.DEEPSEEK_BASE_URL ?? '').replace(/\/+$/, '');
const apiKey = envVars.DEEPSEEK_API_KEY;
const model = 'DeepSeek-V4.1-Flash';

function capture() {
  const png = '/tmp/gui-react-smoke.png';
  const jpg = '/tmp/gui-react-smoke.jpg';
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
    case 'hotkey':
      run(['key', '--combo', params.keys.join('+')]);
      return { success: true, message: `pressed ${params.keys.join('+')}` };
    case 'scroll': {
      const args = ['scroll', '--dy', String(params.dy)];
      if (Number.isFinite(params.x)) args.push('--x', String(params.x), '--y', String(params.y));
      run(args);
      return { success: true, message: `scrolled ${params.dy}` };
    }
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

execFileSync('caffeinate', ['-u', '-t', '5']);
await new Promise((r) => setTimeout(r, 1500));
execFileSync('open', ['-b', 'com.apple.calculator']);
await new Promise((r) => setTimeout(r, 1800));
execFileSync('osascript', ['-e', 'tell application "Calculator" to activate']);
await new Promise((r) => setTimeout(r, 800));
let cleared = false;
for (let i = 0; i < 5 && !cleared; i += 1) {
  try {
    execFileSync(gui, ['press', '--bundle', 'com.apple.calculator', '--label', '清除'], { stdio: 'ignore' });
    cleared = true;
  } catch {
    await new Promise((r) => setTimeout(r, 600));
  }
}
console.log('cleared:', cleared);

const env = new LocalMacEnvironment({ capture, act, wait: (ms) => new Promise((r) => setTimeout(r, ms)) });
try {
  const result = await runGuiReact('点击计算器键盘上的数字 7 按钮，让显示区只显示 7', { env, model, complete, maxSteps: 4 });
  console.log('status:', result.status, 'steps:', result.steps, 'final:', result.final);
  console.table(result.transcript.map((e) => ({ step: e.step, action: e.action, args: JSON.stringify(e.args).slice(0, 60), result: e.text, image: e.hasImage })));
} catch (error) {
  console.error('FAILED:', String(error).slice(0, 500));
}

try {
  const ax = JSON.parse(execFileSync(axdump, ['--bundle', 'com.apple.calculator'], { encoding: 'utf8' }));
  const texts = ax.nodes.filter((n) => n.role === 'AXStaticText').map((n) => n.value).filter(Boolean);
  console.log('calculator display:', texts.join(' | '));
} catch (error) {
  console.log('axdump failed:', String(error).slice(0, 120));
}
