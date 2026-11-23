#!/usr/bin/env node
/** 不碰真实桌面：用 fixture 截图验证 ReAct 的 tool result 带图协议。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalMacEnvironment } from '../src/main/gui/environment.ts';
import { runGuiReact } from '../src/main/gui/react.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const vars = {};
for (const line of envFile.split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const baseUrl = vars.DEEPSEEK_BASE_URL.replace(/\/+$/, '');
const apiKey = vars.DEEPSEEK_API_KEY;
const model = 'DeepSeek-V4.1-Flash';

const shot = fs.readFileSync(path.join(root, 'evals/gui/current-screen/shot.jpg')).toString('base64');
const observation = {
  screenshot: `data:image/jpeg;base64,${shot}`,
  width: 1440,
  height: 900,
  screenWidth: 1440,
  screenHeight: 900,
  app: 'DeepSeek Harness',
  title: 'DSH',
};

const env = new LocalMacEnvironment({
  capture: async () => observation,
  act: async () => ({ success: true, message: 'noop (fixture)' }),
  wait: async () => {},
});

async function complete(body) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
}

try {
  const result = await runGuiReact('看一眼屏幕，用一句话说出当前是什么应用、在做什么。不要点击任何东西。', {
    env,
    model,
    complete,
    maxSteps: 2,
  });
  console.log('status:', result.status, 'steps:', result.steps);
  console.log('final:', result.final.slice(0, 300));
  console.log('transcript:', JSON.stringify(result.transcript));
} catch (error) {
  console.error('FAILED:', String(error).slice(0, 600));
}
