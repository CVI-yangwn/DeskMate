#!/usr/bin/env node
/**
 * 零模型的记忆检索体检。
 *
 * 用法：
 *   node --experimental-strip-types --no-warnings scripts/eval-memory.mjs --auto
 *   node --experimental-strip-types --no-warnings scripts/eval-memory.mjs \
 *     --questions evals/memory-questions.json --out /tmp/memory-eval.md
 *
 * 默认复制一份 memory.db 到临时目录再读，不碰线上库；加 --live 才直接打开原库。
 * --auto 会拿当前 wiki 页面生成“这页现在是什么状态 / 还有什么没做完”两类问题，
 * 只验证名称/摘要/条目检索能不能把正确的页捞进 top-4；不验证模型回答质量。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/main/memory.ts';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

const userData = arg(
  '--user-data',
  path.join(os.homedir(), 'Library', 'Application Support', 'DeskMate'),
);
const questionsFile = arg('--questions', '');
const outFile = arg('--out', '');
const live = process.argv.includes('--live');
const auto = process.argv.includes('--auto') || !questionsFile;
const tempDir = live
  ? ''
  : fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-eval-'));

try {
  if (tempDir) {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = path.join(userData, `memory.db${suffix}`);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(tempDir, `memory.db${suffix}`));
    }
  }
  const store = new MemoryStore(tempDir || userData);
  const pages = store.listWikiPages(500);
  const pageById = new Map(pages.map((page) => [page.id, page]));

  let questions = [];
  if (!auto && questionsFile) {
    const raw = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));
    questions = (Array.isArray(raw) ? raw : raw.questions ?? []).map((item, index) => {
      if (typeof item === 'string') return { question: item, goldPage: '', index };
      return {
        question: String(item.question ?? ''),
        goldPage: String(item.goldPage ?? item.gold ?? ''),
        index,
      };
    });
  } else {
    for (const page of pages) {
      questions.push({
        question: `「${page.name}」现在是什么状态？`,
        goldPage: page.id,
        index: questions.length,
      });
      questions.push({
        question: `「${page.name}」还有哪些没做完？`,
        goldPage: page.id,
        index: questions.length,
      });
    }
    questions = questions.slice(0, 30);
  }

  const rows = [];
  let hit1 = 0;
  let hit4 = 0;
  let zero = 0;
  let injectionTotal = 0;
  for (const item of questions) {
    const matches = store.searchWiki(item.question, 6);
    const ids = matches.map((page) => page.id);
    const top1 = matches[0]?.name ?? '—';
    const gold = item.goldPage ? pageById.get(item.goldPage) : null;
    const goldName = gold?.name ?? item.goldPage ?? '—';
    const isHit1 = Boolean(gold && ids[0] === gold.id);
    const isHit4 = Boolean(gold && ids.slice(0, 4).includes(gold.id));
    if (isHit1) hit1 += 1;
    if (isHit4) hit4 += 1;
    if (matches.length === 0) zero += 1;
    const injection = store.getWikiContext(item.question, 4).length;
    injectionTotal += injection;
    rows.push({
      question: item.question,
      gold: goldName,
      top1,
      hit4: gold ? (isHit4 ? '✓' : '✗') : '—',
      injection,
    });
  }

  const total = Math.max(1, rows.length);
  const pct = (value) => `${Math.round((value / total) * 100)}%`;
  const lines = [
    '# DeskMate 记忆检索体检',
    '',
    `- 时间：${new Date().toLocaleString('zh-CN')}`,
    `- 数据：${userData}${live ? '（live）' : '（临时副本）'}`,
    `- 页面：${pages.length}`,
    `- 问题：${rows.length}${auto ? '（auto：每页 2 题）' : ''}`,
    `- Recall@1：${pct(hit1)}`,
    `- Recall@4：${pct(hit4)}`,
    `- 零命中率：${pct(zero)}`,
    `- 注入字符均值：${Math.round(injectionTotal / total)}`,
    '',
    '| # | 问题 | gold | top1 | hit@4 | 注入字 |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (row, index) =>
        `| ${index + 1} | ${row.question.replace(/\|/g, '\\|')} | ${row.gold.replace(/\|/g, '\\|')} | ${row.top1.replace(/\|/g, '\\|')} | ${row.hit4} | ${row.injection} |`,
    ),
    '',
    '> auto 模式只测“能不能找到已有页面”，不代表模型回答正确；真实评测请用最近 30 个问题 + 人工 gold。',
  ];

  const output = `${lines.join('\n')}\n`;
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, output, { encoding: 'utf8', mode: 0o600 });
    console.log(`wrote ${outFile}`);
  } else {
    process.stdout.write(output);
  }
} finally {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
