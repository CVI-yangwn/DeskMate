import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WikiItem, WikiPage, WikiPageType, WikiSource } from '../shared/types';

export const WIKI_SUMMARY_LIMIT = 1600;
export const WIKI_ITEMS_LIMIT = 20;
export const WIKI_SOURCES_LIMIT = 40;
export const WIKI_CHANGELOG_LIMIT = 20;

export interface WikiRef {
  label: string;
  excerpt?: string;
  at: number;
}

export interface WikiDraft {
  name: string;
  type: WikiPageType;
  aliases?: string[];
  summary: string;
  newItems?: string[];
  closeItems?: string[];
  sources?: string[];
  changeNote?: string;
}

export interface WikiApplyResult {
  page: WikiPage;
  notes: string[];
  created: boolean;
}

export class WikiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WikiValidationError';
  }
}

const TYPE_LABEL: Record<WikiPageType, string> = {
  project: '项目',
  contact: '人物',
  topic: '话题',
};

export function wikiTypeLabel(type: WikiPageType): string {
  return TYPE_LABEL[type];
}

export function isWikiPageType(value: unknown): value is WikiPageType {
  return value === 'project' || value === 'contact' || value === 'topic';
}

export function normalizeWikiName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function wikiNameKey(name: string): string {
  return normalizeWikiName(name).toLowerCase();
}

export function wikiDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'wiki');
}

export function wikiPageFile(userDataDir: string, page: Pick<WikiPage, 'type' | 'name'>): string {
  return path.join(wikiDirectory(userDataDir), page.type, `${slugifyWikiName(page.name)}.md`);
}

export function slugifyWikiName(name: string): string {
  const slug = normalizeWikiName(name)
    .replace(/[\\/:*?"<>|#%{}^[\]`]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return slug || `page-${randomUUID().slice(0, 8)}`;
}

function normalizeText(text: string, limit: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]]/g, '');
}

function citationRefs(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const ref = match[1]?.trim();
    if (ref) refs.push(ref);
  }
  return refs;
}

function validateRefs(text: string, refs: Map<string, WikiRef>): void {
  for (const ref of citationRefs(text)) {
    if (!refs.has(ref)) {
      throw new WikiValidationError(`引用了不存在的证据：${ref}`);
    }
  }
}

function nextItemId(items: WikiItem[]): string {
  let max = 0;
  for (const item of items) {
    const match = /^i(\d+)$/.exec(item.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `i${max + 1}`;
}

function findItem(items: WikiItem[], key: string): WikiItem | undefined {
  const clean = key.trim();
  if (!clean) return undefined;
  const byId = items.find((item) => item.id === clean);
  if (byId) return byId;
  const exact = items.find((item) => compact(item.text) === compact(clean));
  if (exact) return exact;
  const needle = compact(clean);
  const partial = items.filter(
    (item) => compact(item.text).includes(needle) || needle.includes(compact(item.text)),
  );
  // 只在唯一命中时按包含匹配，避免一个短词关掉多条。
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * 把模型给出的“只写变化”草稿合并进已有页面。
 * 没被提到的条目一律保留；引用必须来自本次证据，避免模型编造来源。
 */
export function applyWikiDraft(
  existing: WikiPage | null,
  draft: WikiDraft,
  refs: Map<string, WikiRef>,
  now = Date.now(),
): WikiApplyResult {
  const name = normalizeWikiName(draft.name);
  if (!name) throw new WikiValidationError('页面名称为空');
  if (!isWikiPageType(draft.type)) throw new WikiValidationError('页面类型无效');

  // 旧页面已经引用过的证据仍然有效；新引用必须来自本次整理。
  const allowedRefs = new Map(refs);
  for (const source of existing?.sources ?? []) {
    if (!allowedRefs.has(source.ref)) {
      allowedRefs.set(source.ref, { label: source.label, at: source.at });
    }
  }
  for (const ref of citationRefs(existing?.summary ?? '')) {
    if (!allowedRefs.has(ref)) allowedRefs.set(ref, { label: '旧页面引用', at: existing?.updatedAt ?? now });
  }
  for (const item of existing?.items ?? []) {
    for (const ref of citationRefs(item.text)) {
      if (!allowedRefs.has(ref)) allowedRefs.set(ref, { label: '旧条目引用', at: item.at });
    }
  }

  const summary = normalizeText(draft.summary, WIKI_SUMMARY_LIMIT);
  if (!summary) throw new WikiValidationError('页面摘要为空');
  validateRefs(summary, allowedRefs);

  const aliases = [
    ...new Set(
      [...(existing?.aliases ?? []), ...(draft.aliases ?? [])]
        .map(normalizeWikiName)
        .filter(Boolean),
    ),
  ]
    .filter((alias) => wikiNameKey(alias) !== wikiNameKey(name))
    .slice(0, 8);

  const items: WikiItem[] = (existing?.items ?? []).map((item) => ({ ...item }));
  const notes: string[] = [];

  let closed = 0;
  for (const key of draft.closeItems ?? []) {
    const target = findItem(items, String(key));
    if (!target || target.status === 'done') continue;
    target.status = 'done';
    closed += 1;
  }

  let added = 0;
  for (const raw of draft.newItems ?? []) {
    const text = normalizeText(String(raw), 300);
    if (!text) continue;
    validateRefs(text, allowedRefs);
    if (items.some((item) => compact(item.text) === compact(text) && item.status === 'open')) continue;
    items.push({
      id: nextItemId(items),
      text,
      status: 'open',
      at: now,
    });
    added += 1;
  }

  // 超过上限时把最老的未完成项收进历史，而不是丢掉。
  const open = items.filter((item) => item.status === 'open');
  if (open.length > WIKI_ITEMS_LIMIT) {
    const overflow = open
      .slice()
      .sort((a, b) => a.at - b.at)
      .slice(0, open.length - WIKI_ITEMS_LIMIT);
    for (const item of overflow) item.status = 'done';
    notes.push(`归档 ${overflow.length} 条较早的未完成项`);
  }

  validateRefs(items.map((item) => item.text).join('\n'), allowedRefs);

  const nextSources: WikiSource[] = [...(existing?.sources ?? [])];
  for (const ref of draft.sources ?? []) {
    const clean = String(ref).trim();
    if (!clean) continue;
    const evidence = refs.get(clean);
    if (!evidence) throw new WikiValidationError(`引用了不存在的证据：${clean}`);
    if (nextSources.some((source) => source.ref === clean)) continue;
    nextSources.push({
      ref: clean,
      label: normalizeText(evidence.label, 120),
      ...(evidence.excerpt ? { excerpt: normalizeText(evidence.excerpt, 300) } : {}),
      at: evidence.at,
    });
  }
  // 模型偶尔会漏填 sources；从正文引用里补齐，保证页面上的来源和正文一致。
  for (const ref of [
    ...citationRefs(summary),
    ...items.flatMap((item) => citationRefs(item.text)),
  ]) {
    if (nextSources.some((source) => source.ref === ref)) continue;
    const evidence = allowedRefs.get(ref);
    if (!evidence) continue;
    nextSources.push({
      ref,
      label: normalizeText(evidence.label, 120),
      ...(evidence.excerpt ? { excerpt: normalizeText(evidence.excerpt, 300) } : {}),
      at: evidence.at,
    });
  }
  nextSources.sort((a, b) => b.at - a.at);

  const changed = !existing || summary !== existing.summary || added > 0 || closed > 0;
  const changeNote =
    normalizeText(draft.changeNote ?? '', 160) ||
    (existing
      ? [added ? `新增 ${added} 条` : '', closed ? `完成 ${closed} 条` : ''].filter(Boolean).join('，') ||
        '更新页面'
      : '新建页面');

  const changeLog = [...(existing?.changeLog ?? [])];
  if (changed) changeLog.unshift({ at: now, note: changeNote });

  const page: WikiPage = {
    id: existing?.id ?? randomUUID(),
    type: draft.type,
    name,
    aliases,
    summary,
    items,
    sources: nextSources.slice(0, WIKI_SOURCES_LIMIT),
    changeLog: changeLog.slice(0, WIKI_CHANGELOG_LIMIT),
    createdAt: existing?.createdAt ?? now,
    updatedAt: changed ? now : existing?.updatedAt ?? now,
    lastDreamedAt: now,
  };

  return { page, notes, created: !existing };
}

export function renderWikiMarkdown(page: WikiPage): string {
  const lines: string[] = [
    '---',
    `type: ${page.type}`,
    `name: ${page.name}`,
    `aliases: ${page.aliases.join(', ')}`,
    `updated: ${new Date(page.updatedAt).toISOString()}`,
    '---',
    '',
    `# ${page.name}`,
    '',
    page.summary,
    '',
    '## 未完成 / 已记录',
  ];

  if (page.items.length === 0) {
    lines.push('（暂无）');
  } else {
    for (const item of page.items) {
      lines.push(`- [${item.status === 'open' ? ' ' : 'x'}] ${item.text}`);
    }
  }

  lines.push('', '## Change Log');
  if (page.changeLog.length === 0) {
    lines.push('（暂无）');
  } else {
    for (const change of page.changeLog) {
      lines.push(`- ${new Date(change.at).toLocaleString('zh-CN')} · ${change.note}`);
    }
  }

  lines.push('', '## Sources');
  if (page.sources.length === 0) {
    lines.push('（暂无）');
  } else {
    for (const source of page.sources.slice(0, 12)) {
      lines.push(`- ${source.label} (${source.ref})`);
      if (source.excerpt && source.excerpt !== source.label) {
        lines.push(`  - ${source.excerpt}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function searchWikiPages(pages: WikiPage[], query: string, limit = 6): WikiPage[] {
  const clean = query
    .toLowerCase()
    .replace(/[「」“”"'‘’？?！!。，,、；;：:\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return pages.slice(0, limit);
  const stop = new Set([
    '现在',
    '什么',
    '状态',
    '哪些',
    '还有',
    '没做完',
    '怎么样',
    '怎么',
    '如何',
    '是否',
    '一下',
    '这个',
    '那个',
  ]);
  const terms = clean.split(' ').filter((term) => term.length >= 2 && !stop.has(term));

  const scored = pages
    .map((page) => {
      const name = page.name.toLowerCase();
      const aliases = page.aliases.join(' ').toLowerCase();
      const summary = page.summary.toLowerCase();
      const items = page.items.map((item) => item.text.toLowerCase()).join(' ');
      let score = 0;
      if (name === clean) score += 20;
      if (name.includes(clean)) score += 12;
      if (aliases.includes(clean)) score += 8;
      for (const term of terms) {
        if (name.includes(term)) score += 8;
        if (aliases.includes(term)) score += 5;
        if (summary.includes(term)) score += 3;
        if (items.includes(term)) score += 2;
      }
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt);

  return scored.slice(0, Math.max(1, limit)).map((item) => item.page);
}

export function findWikiPage(pages: WikiPage[], key: string): WikiPage | undefined {
  const clean = key.trim();
  if (!clean) return undefined;
  const lower = clean.toLowerCase();
  return pages.find(
    (page) =>
      page.id === clean ||
      page.name.toLowerCase() === lower ||
      page.aliases.some((alias) => alias.toLowerCase() === lower),
  );
}

export function formatWikiPage(page: WikiPage): string {
  const items = page.items
    .filter((item) => item.status === 'open')
    .slice(0, 8)
    .map((item) => `- ${item.text.replace(/\[\[[^\]]+\]\]/g, '')}`)
    .join('\n');
  return [
    `### ${page.name}（${wikiTypeLabel(page.type)}）`,
    page.summary.replace(/\[\[[^\]]+\]\]/g, ''),
    items ? `未完成：\n${items}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800);
}

export function formatWikiContext(pages: WikiPage[], limit = 4): string {
  if (pages.length === 0) return '';
  return pages
    .slice(0, limit)
    .map(formatWikiPage)
    .join('\n\n')
    .slice(0, 3000);
}

export function formatWikiRegistry(pages: WikiPage[]): string {
  if (pages.length === 0) return '（暂无）';
  return pages
    .slice(0, 80)
    .map((page) => {
      const open = page.items.filter((item) => item.status === 'open').length;
      return `- ${page.id} | ${page.type} | ${page.name}${
        page.aliases.length ? `（别名：${page.aliases.join('、')}）` : ''
      } | 未完成 ${open} | ${page.summary.slice(0, 120)}`;
    })
    .join('\n');
}

/** 本地兜底：没有模型时，也从已有的项目类事实里生成一页最简 wiki。 */
export function pagesFromFacts(
  pages: WikiPage[],
  facts: Array<{ text: string; kind: string }>,
): WikiDraft[] {
  const existingKeys = new Set(pages.flatMap((page) => [wikiNameKey(page.name), ...page.aliases.map(wikiNameKey)]));
  const drafts: WikiDraft[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.kind !== 'project') continue;
    const cleaned = fact.text.replace(/^(我的|当前)?(项目|产品|仓库|代码库)(是|叫|：|:)?\s*/, '');
    const name = normalizeWikiName(cleaned.split(/[，,。；;：:]/)[0] ?? '');
    if (name.length < 2 || name.length > 40) continue;
    const key = wikiNameKey(name);
    if (existingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    drafts.push({
      name,
      type: 'project',
      summary: fact.text.slice(0, WIKI_SUMMARY_LIMIT),
      newItems: [],
      sources: [],
      changeNote: '从长期记忆迁移',
    });
    if (drafts.length >= 3) break;
  }
  return drafts;
}
