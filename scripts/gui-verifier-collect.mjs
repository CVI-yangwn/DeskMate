#!/usr/bin/env node
/**
 * 采集验证器的前后截图对（受控 App：Calculator / Finder / Spotlight）。
 * 不碰 DSH 窗口；结束时恢复 DSH 前台。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'evals/gui/verifier');
fs.mkdirSync(outDir, { recursive: true });
const gui = path.join(root, 'native/gui');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, allowFail = false) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch (error) {
    if (!allowFail) throw error;
  }
}

const G = (args) => [gui, args];
const press = (label) => G(['press', '--bundle', 'com.apple.calculator', '--label', label]);
const calc = (labels) => labels.map(press);
const key = (combo, bundle) =>
  bundle ? G(['key', '--combo', combo, '--bundle', bundle]) : G(['key', '--combo', combo]);

const cases = [
  {
    id: 'v01-calc-open',
    expect: '屏幕上出现计算器窗口',
    positive: true,
    setup: [key('cmd+q', 'com.apple.calculator')],
    action: [['open', ['-a', 'Calculator']]],
    wait: 4000,
  },
  {
    id: 'v02-calc-add',
    expect: '计算器的显示区出现结果 3',
    positive: true,
    setup: [
      G(['activate', '--bundle', 'com.apple.calculator']),
      ...calc(['清除', '清除', '清除']),
    ],
    action: calc(['1', '加', '2', '等于']),
  },
  {
    id: 'v03-calc-clear',
    expect: '计算器的显示区变成 0',
    positive: true,
    setup: [G(['activate', '--bundle', 'com.apple.calculator']), ...calc(['1', '加', '2', '等于'])],
    action: calc(['清除']),
  },
  {
    id: 'v04-calc-wrong-noop',
    expect: '计算器的显示区出现结果 7',
    positive: false,
    setup: [G(['activate', '--bundle', 'com.apple.calculator']), ...calc(['清除', '1', '加', '2', '等于'])],
    action: [],
  },
  {
    id: 'v05-calc-wrong-partial',
    expect: '计算器的显示区出现结果 3',
    positive: false,
    setup: [G(['activate', '--bundle', 'com.apple.calculator']), ...calc(['清除'])],
    action: calc(['1', '加', '2']),
  },
  {
    id: 'v06-calc-close',
    expect: '计算器窗口从屏幕上消失',
    positive: true,
    setup: [['open', ['-a', 'Calculator']], G(['activate', '--bundle', 'com.apple.calculator'])],
    action: [['osascript', ['-e', 'tell application "Calculator" to quit']]],
    wait: 2200,
  },
  {
    id: 'v10-finder-open',
    expect: '屏幕上出现一个访达（Finder）窗口',
    positive: true,
    setup: [
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
    ],
    action: [key('cmd+n', 'com.apple.finder')],
  },
  {
    id: 'v11-finder-close',
    expect: '访达（Finder）窗口从屏幕上消失',
    positive: true,
    setup: [
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+n', 'com.apple.finder'),
    ],
    action: [key('cmd+w', 'com.apple.finder')],
  },
  {
    id: 'v12-finder-negative',
    expect: '访达（Finder）窗口从屏幕上消失',
    positive: false,
    setup: [
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+w', 'com.apple.finder'),
      key('cmd+n', 'com.apple.finder'),
    ],
    action: [],
  },
];

function shootPng(target) {
  run('screencapture', ['-x', target]);
}

function toJpeg(png, jpg) {
  run('sips', ['-Z', '1440', '-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', jpg]);
}

const records = [];
for (const item of cases) {
  for (const [command, args] of item.setup) run(command, args, true);
  await sleep(700);

  const beforePng = path.join(outDir, `${item.id}-before.png`);
  const afterPng = path.join(outDir, `${item.id}-after.png`);
  const beforeJpg = path.join(outDir, `${item.id}-before.jpg`);
  const afterJpg = path.join(outDir, `${item.id}-after.jpg`);

  shootPng(beforePng);
  for (const [command, args] of item.action) run(command, args, true);
  await sleep(item.wait ?? 900);
  shootPng(afterPng);
  toJpeg(beforePng, beforeJpg);
  toJpeg(afterPng, afterJpg);
  fs.rmSync(beforePng, { force: true });
  fs.rmSync(afterPng, { force: true });

  records.push({
    id: item.id,
    expect: item.expect,
    positive: item.positive,
    before: path.basename(beforeJpg),
    after: path.basename(afterJpg),
  });
  console.log(`captured ${item.id} (${item.positive ? 'positive' : 'negative'})`);
}

fs.writeFileSync(
  path.join(outDir, 'cases.json'),
  JSON.stringify({ width: 1440, height: 900, cases: records }, null, 2),
);

// 收尾：关掉实验窗口，恢复 DSH
run('open', ['-b', 'com.deepseek.dsh'], true);
console.log(`\n${records.length} 组前后截图写入 evals/gui/verifier/`);
