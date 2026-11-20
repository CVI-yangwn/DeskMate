import fs from 'node:fs';
import path from 'node:path';
import type {
  DreamRun,
  ProactiveClue,
  ProactiveRule,
  WikiPage,
} from '../shared/types';
import type {
  ProactiveClueDraft,
  RuleLearningResult,
  WikiEntityCandidate,
  WriteWikiPageInput,
} from './deepseek';
import { localDay, type MemoryStore } from './memory.ts';
import {
  dedupeRules,
  describeRule,
  eventKindLabel,
  promoteClues,
  sanitizeRuleDraft,
} from './proactiveRules.ts';
import {
  applyWikiDraft,
  formatWikiRegistry,
  pagesFromFacts,
  renderWikiMarkdown,
  slugifyWikiName,
  type WikiDraft,
} from './wiki.ts';

export interface DreamingLlm {
  readonly configured: boolean;
  routeWikiEntities(evidence: string, registry: string): Promise<WikiEntityCandidate[]>;
  writeWikiPage(input: WriteWikiPageInput): Promise<WikiDraft>;
  learnProactiveRules(input: {
    evidence: string;
    rules: string;
    clues: string;
  }): Promise<RuleLearningResult>;
  generateDailyDigest(input: {
    day: string;
    evidence: string;
    changes: string;
  }): Promise<string>;
  summarizeAgentMemory(input: {
    facts: string;
    pages: string;
    rules: string;
  }): Promise<string>;
}

export interface DreamingOptions {
  store: MemoryStore;
  client: DreamingLlm;
  userDataDir: string;
  now?: () => number;
  force?: boolean;
  maxPages?: number;
}

const MAX_PAGES = 5;

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function filterEvidence(text: string, refs: string[]): string {
  if (refs.length === 0) return text.slice(0, 7000);
  const lines = text.split('\n');
  const picked: string[] = [];
  let section = '';
  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line;
      continue;
    }
    if (refs.some((ref) => line.includes(`[${ref}]`))) {
      if (section && !picked.includes(section)) picked.push(section);
      picked.push(line);
    }
  }
  const body = picked.join('\n');
  return body.length > 0 ? body.slice(0, 7000) : text.slice(0, 5000);
}

function formatLearnedRules(rules: ProactiveRule[]): string {
  const learned = rules.filter((rule) => rule.source !== 'explicit' && rule.active);
  if (learned.length === 0) return '（暂无）';
  return learned
    .map(
      (rule) =>
        `- ${rule.kind} | ${rule.label} | ${rule.decision} | ${
          rule.windowStart && rule.windowEnd ? `${rule.windowStart}-${rule.windowEnd}` : 'all'
        } | seen ${rule.seen} | ${rule.reason}`,
    )
    .join('\n');
}

function formatClues(clues: ProactiveClue[]): string {
  if (clues.length === 0) return '（暂无）';
  return clues
    .map(
      (clue) =>
        `- ${clue.kind} | ${clue.label} | ${clue.decision} | seen ${clue.seen} | ${clue.note}`,
    )
    .join('\n');
}

function buildProactiveEvidence(store: MemoryStore, since: number): string {
  const deliveries = store
    .getDeliveriesSince(since, 40)
    .slice()
    .sort((a, b) => a.at - b.at);
  const messages = store.getMessageRowsSince(since, 120);
  const lines: string[] = [];

  if (deliveries.length === 0) {
    lines.push('（没有主动消息记录）');
  } else {
    for (const delivery of deliveries) {
      lines.push(
        `- ${clock(delivery.at)} 主动消息 [${delivery.eventType}]（${delivery.outcome}${
          delivery.suppressed ? '，已压住' : ''
        }）：${delivery.text}`,
      );
      const followUps = messages
        .filter(
          (message) =>
            message.role === 'user' &&
            message.created_at > delivery.at &&
            message.created_at <= delivery.at + 20 * 60_000,
        )
        .slice(0, 4);
      for (const message of followUps) {
        lines.push(`  - 用户随后 ${clock(message.created_at)}：${message.text.slice(0, 200)}`);
      }
    }
  }

  const feedback = messages.filter((message) =>
    /(提醒|别|不用|以后|晚点|直接|时间|吵|烦|知道|完成|收到|好)/.test(message.text),
  );
  const recent = feedback.slice(-20);
  if (recent.length) {
    lines.push('', '## 可能相关的用户原话');
    for (const message of recent) {
      lines.push(`- ${clock(message.created_at)}：${message.text.slice(0, 200)}`);
    }
  }

  return lines.join('\n').slice(0, 9000);
}

function localDigest(store: MemoryStore, day: string): string {
  const anchors = store.getAnchors(day, 12);
  const commitments = store.getCommitments('all', 20);
  const startOfDay = new Date(`${day}T00:00:00`).getTime();
  const intentions = store.getIntentionsSince(startOfDay, 20);
  const open = commitments.filter((item) => item.status === 'open');
  const done = commitments.filter(
    (item) => item.status === 'done' && Date.now() - item.at <= 24 * 60 * 60_000,
  );

  const progress = [
    ...anchors.filter((anchor) => anchor.kind !== 'open_loop').map((anchor) => anchor.text),
    ...intentions.slice(-4).map((intention) => intention.text),
  ].slice(0, 4);
  const stuck = [
    ...anchors.filter((anchor) => anchor.kind === 'open_loop').map((anchor) => anchor.text),
    ...open.map((item) => item.text),
  ].slice(0, 4);
  const next = open[0]?.text || '—';

  return [
    '**今天推进了**',
    ...(progress.length ? progress.map((item) => `- ${item}`) : ['- —']),
    '',
    '**卡住 / 没做完**',
    ...(stuck.length ? stuck.map((item) => `- ${item}`) : ['- —']),
    '',
    '**明天先做**',
    `- ${next}`,
    ...(done.length ? ['', `（今天完成了 ${done.length} 件答应过的事。）`] : []),
  ].join('\n');
}

function localAgentSummary(store: MemoryStore, pages: WikiPage[], rules: ProactiveRule[]): string {
  const facts = store.getFacts(60);
  const preferences = facts.filter((fact) => fact.kind === 'preference').slice(0, 8);
  const projects = facts.filter((fact) => fact.kind === 'project').slice(0, 6);
  const lines: string[] = ['# 关于你', ''];

  const about = facts.filter((fact) => fact.kind === 'fact').slice(0, 6);
  if (about.length) {
    lines.push('## 基本信息', ...about.map((fact) => `- ${fact.text}`), '');
  }
  if (preferences.length) {
    lines.push('## 长期偏好', ...preferences.map((fact) => `- ${fact.text}`), '');
  }
  const activePages = pages.filter((page) => page.type === 'project').slice(0, 6);
  if (activePages.length) {
    lines.push(
      '## 正在做的事',
      ...activePages.map((page) => `- ${page.name}：${page.summary.replace(/\[\[[^\]]+\]\]/g, '').slice(0, 100)}`),
      '',
    );
  } else if (projects.length) {
    lines.push('## 正在做的事', ...projects.map((fact) => `- ${fact.text}`), '');
  }
  const people = pages.filter((page) => page.type === 'contact').slice(0, 6);
  if (people.length) {
    lines.push(
      '## 重要的人',
      ...people.map((page) => `- ${page.name}：${page.summary.replace(/\[\[[^\]]+\]\]/g, '').slice(0, 80)}`),
      '',
    );
  }
  const learned = rules.filter((rule) => rule.active && rule.source !== 'explicit');
  if (learned.length) {
    lines.push('## 提醒偏好', ...learned.map((rule) => `- ${describeRule(rule)}`), '');
  }
  return lines.join('\n').slice(0, 3000);
}

function writeFileSafe(file: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (error) {
    console.warn('写入知识文件失败', file, error);
  }
}

export function wikiDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'wiki');
}

export function writeWikiFile(userDataDir: string, page: WikiPage): string {
  const file = path.join(wikiDirectory(userDataDir), page.type, `${slugifyWikiName(page.name)}.md`);
  writeFileSafe(file, renderWikiMarkdown(page));
  return file;
}

export function writeAgentMemoryFiles(
  userDataDir: string,
  store: MemoryStore,
  summary: string,
): void {
  const dir = path.join(userDataDir, 'agent-memory');
  const facts = store.getFacts(100);
  const groups: Array<[string, string]> = [
    ['project', '项目'],
    ['preference', '偏好'],
    ['fact', '事实'],
  ];
  const lines = ['# DeskMate 记忆', ''];
  for (const [kind, label] of groups) {
    const items = facts.filter((fact) => fact.kind === kind);
    if (items.length === 0) continue;
    lines.push(`## ${label}`, ...items.map((fact) => `- ${fact.text}`), '');
  }
  writeFileSafe(path.join(dir, 'MEMORY.md'), `${lines.join('\n')}\n`);
  writeFileSafe(path.join(dir, 'summary.md'), `${summary.trim()}\n`);
}

function mergeRules(
  learned: RuleLearningResult['rules'],
  clues: ProactiveClueDraft[],
  existingRules: ProactiveRule[],
  store: MemoryStore,
  now: number,
): { rules: number; clues: ProactiveClue[] } {
  const drafts = learned
    .map((rule) =>
      sanitizeRuleDraft(
        {
          kind: rule.kind,
          label: rule.label,
          decision: rule.decision,
          windowStart: rule.windowStart,
          windowEnd: rule.windowEnd,
          reason: rule.reason,
          source: 'dreaming',
        },
        now,
      ),
    )
    .filter((rule): rule is ProactiveRule => Boolean(rule));

  // 同类线索累计两次也升级，避免完全依赖模型的一次判断。
  const clueRecords: ProactiveClue[] = clues.map((clue) => {
    const key = `${clue.kind}|${clue.decision}`;
    return {
      id: `clue-${key}`,
      kind: clue.kind,
      label: clue.label || eventKindLabel(clue.kind),
      decision: clue.decision,
      seen: clue.seen,
      note: clue.note,
      firstSeenAt: now,
      lastSeenAt: now,
    };
  });
  const promoted = promoteClues(clueRecords, [...existingRules, ...drafts], now);
  const finalRules = dedupeRules([...drafts, ...promoted]);
  const saved = store.replaceDreamingRules(finalRules);
  store.replaceClues(clueRecords);
  return { rules: saved, clues: clueRecords };
}

/**
 * 夜间整理：把今天的对话、活动、锚点、意图和主动消息反馈，
 * 收敛成可检索的 wiki 页面、主动提醒规则、日结和一份“关于你”的摘要。
 * 每个模型调用都可失败；失败时保留本地兜底，不阻断整轮。
 */
export async function runDreaming(options: DreamingOptions): Promise<DreamRun> {
  const { store, client, userDataDir } = options;
  const now = options.now?.() ?? Date.now();
  const day = localDay(new Date(now));
  const last = store.getLastDreamRun();

  if (!options.force && last?.day === day && last.status === 'ok') {
    return {
      ...last,
      status: 'skipped',
      message: '今天已经整理过了',
    };
  }

  const run = store.startDreamRun(day);
  const since = Math.max(now - 7 * 24 * 60 * 60_000, last?.finishedAt ?? now - 24 * 60 * 60_000);
  const pages = store.listWikiPages(200);
  const existingRules = store.getRules();
  const notes: string[] = [];
  let touched = 0;
  let learnedCount = 0;

  try {
    const evidence = store.getDreamEvidence(since, now);
    const registry = formatWikiRegistry(pages);
    const hasEvidence = evidence.refs.size >= 3;

    const hasProjectFacts = store.getFacts(100).some((fact) => fact.kind === 'project');
    if (!hasEvidence && pages.length === 0 && !hasProjectFacts) {
      return (
        store.finishDreamRun(run.id, {
          status: 'skipped',
          message: '今天没有可整理的对话、活动或锚点',
        }) ?? { ...run, status: 'skipped', message: '没有可整理的记录' }
      );
    }

    if (!hasEvidence) {
      notes.push('证据较少，本次只做规则和摘要维护');
    }

    if (client.configured && hasEvidence) {
      let candidates: WikiEntityCandidate[] = [];
      try {
        candidates = await client.routeWikiEntities(evidence.text, registry);
      } catch (error) {
        notes.push(`实体路由失败：${error instanceof Error ? error.message.slice(0, 100) : '未知错误'}`);
      }

      const hasUserSignal = [...evidence.refs.keys()].some(
        (ref) => ref.startsWith('msg:') || ref.startsWith('anchor:') || ref.startsWith('intent:'),
      );
      for (const candidate of candidates.slice(0, options.maxPages ?? MAX_PAGES)) {
        try {
          const existing =
            (candidate.existingPageId ? store.getWikiPage(candidate.existingPageId) : null) ??
            store.getWikiPageByName(candidate.name);
          // 只有屏幕活动、没有用户自己说过/做过的事时，不新建页面，避免把每个 App 都变成项目。
          if (!existing && !hasUserSignal) continue;
          // 用户手动删掉的页面不在第二天自动复活。
          if (!existing && store.isWikiNameTombstoned(candidate.name)) continue;
          const subset = filterEvidence(evidence.text, candidate.refs);
          const draft = await client.writeWikiPage({
            candidate,
            evidence: subset,
            existing,
            registry,
          });
          const result = applyWikiDraft(existing, draft, evidence.refs, now);
          const saved = store.saveWikiPage(result.page);
          writeWikiFile(userDataDir, saved);
          touched += 1;
          notes.push(`${result.created ? '新建' : '更新'}「${saved.name}」：${draft.changeNote || '已更新'}`);
        } catch (error) {
          notes.push(
            `「${candidate.name}」写入失败：${
              error instanceof Error ? error.message.slice(0, 100) : '未知错误'
            }`,
          );
        }
      }

      if (touched === 0 && pages.length === 0) {
        // 模型没路由出实体时，用长期记忆里的项目事实兜底建页，避免知识库一直是空的。
        for (const draft of pagesFromFacts(pages, store.getFacts(100))) {
          if (store.isWikiNameTombstoned(draft.name)) continue;
          try {
            const result = applyWikiDraft(null, draft, evidence.refs, now);
            const saved = store.saveWikiPage(result.page);
            writeWikiFile(userDataDir, saved);
            touched += 1;
          } catch {
            // ignore bootstrap errors
          }
        }
      }

      const deliveries = store.getDeliveriesSince(since, 40);
      if (deliveries.length === 0 && store.getClues().length === 0) {
        // 没有主动消息就没有反馈可学；不要用空结果覆盖已有规则。
        notes.push('今天没有主动消息，规则保持不变');
      } else {
        try {
          const proactiveEvidence = buildProactiveEvidence(store, since);
          const learning = await client.learnProactiveRules({
            evidence: proactiveEvidence,
            rules: formatLearnedRules(existingRules),
            clues: formatClues(store.getClues()),
          });
          const hasLearned = existingRules.some(
            (rule) => rule.source !== 'explicit' && rule.active,
          );
          if (!hasLearned || learning.rules.length > 0 || learning.clues.length > 0) {
            const merged = mergeRules(learning.rules, learning.clues, existingRules, store, now);
            learnedCount = merged.rules;
          } else {
            notes.push('这一晚没有新的规则变化');
          }
          if (learning.changeNote) notes.push(`规则：${learning.changeNote}`);
        } catch (error) {
          notes.push(`规则学习失败：${error instanceof Error ? error.message.slice(0, 100) : '未知错误'}`);
        }
      }
    } else {
      // 没有 key：至少把长期记忆里的项目迁移成 wiki 页，并生成本地日结。
      for (const draft of pagesFromFacts(pages, store.getFacts(100))) {
        if (store.isWikiNameTombstoned(draft.name)) continue;
        try {
          const result = applyWikiDraft(null, draft, evidence.refs, now);
          const saved = store.saveWikiPage(result.page);
          writeWikiFile(userDataDir, saved);
          touched += 1;
        } catch {
          // ignore
        }
      }
    }

    const updatedPages = store.listWikiPages(200);
    const updatedRules = store.getRules();

    let digest = localDigest(store, day);
    if (client.configured && hasEvidence) {
      try {
        digest = await client.generateDailyDigest({
          day,
          evidence: evidence.text,
          changes: notes.join('\n'),
        });
      } catch (error) {
        notes.push(`日结生成失败，已用本地整理：${error instanceof Error ? error.message.slice(0, 80) : ''}`);
      }
    }
    store.saveDailyReport(day, digest);

    let summary = localAgentSummary(store, updatedPages, updatedRules);
    if (client.configured) {
      try {
        summary = await client.summarizeAgentMemory({
          facts: store.getFacts(60).map((fact) => `- [${fact.kind}] ${fact.text}`).join('\n'),
          pages: updatedPages
            .slice(0, 8)
            .map((page) => `- [${page.type}] ${page.name}：${page.summary.replace(/\[\[[^\]]+\]\]/g, '').slice(0, 160)}`)
            .join('\n'),
          rules: updatedRules.map((rule) => `- ${describeRule(rule)}`).join('\n'),
        });
      } catch (error) {
        notes.push(`记忆摘要生成失败，已用本地整理：${error instanceof Error ? error.message.slice(0, 80) : ''}`);
      }
    }
    store.setAgentMemory(summary);
    writeAgentMemoryFiles(userDataDir, store, summary);

    const message = notes.length
      ? notes.join('；').slice(0, 480)
      : touched
        ? `整理了 ${touched} 页`
        : '没有需要改的页面';

    return (
      store.finishDreamRun(run.id, {
        status: 'ok',
        pages: touched,
        rules: learnedCount,
        message,
      }) ?? { ...run, status: 'ok', pages: touched, rules: learnedCount, message }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : '整理失败';
    return (
      store.finishDreamRun(run.id, {
        status: 'error',
        pages: touched,
        rules: learnedCount,
        message,
      }) ?? { ...run, status: 'error', pages: touched, rules: learnedCount, message }
    );
  }
}
