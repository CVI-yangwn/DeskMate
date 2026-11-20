/**
 * 文本变化检测：解决“每 60 秒看一帧、只看得到状态看不到变化”的问题。
 *
 * 输入是两次扫描的 OCR 文本（或光标附近文本），输出“新出现了什么”。
 * 纯函数，方便单测；不做任何 I/O。
 */

export interface LineDiff {
  /** 新增的行（只保留前几条用于展示/提示词） */
  added: string[];
  /** 消失的行（同上） */
  removed: string[];
  addedCount: number;
  removedCount: number;
  /** 中文短句，给日志/提示词用；没有变化时为空串 */
  summary: string;
  /** 是否值得当成一件事说出来 */
  significant: boolean;
  /** 两次文本是否还是同一个页面（避免把“切页”误判成“新增 200 行”） */
  sameContext: boolean;
}

const MIN_LINE_LENGTH = 4;
const MAX_LINES = 400;
const MAX_PREVIEW = 4;
// 注意词边界：代码里的 window.onerror 不该被当成“新报错”。
const ERROR_HINTS =
  /\b(error|exception|traceback|failed|failure|fatal|cannot|undefined)\b|失败|报错|错误|异常|崩溃|超时|未通过/i;

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH)
    .slice(0, MAX_LINES);
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

function difference(previous: Map<string, number>, next: Map<string, number>): string[] {
  const result: string[] = [];
  for (const [line, count] of next) {
    if (count > (previous.get(line) ?? 0)) result.push(line);
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function diffLines(previousText: string, nextText: string): LineDiff {
  const prevLines = toLines(previousText);
  const nextLines = toLines(nextText);

  if (prevLines.length === 0) {
    return {
      added: [],
      removed: [],
      addedCount: 0,
      removedCount: 0,
      summary: '',
      significant: false,
      sameContext: false,
    };
  }

  const prevCounts = countLines(prevLines);
  const nextCounts = countLines(nextLines);
  const added = difference(prevCounts, nextCounts);
  const removed = difference(nextCounts, prevCounts);

  const sameContext =
    jaccard(new Set(prevLines), new Set(nextLines)) >= 0.2 || added.length <= 2;

  const errorLines = added.filter((line) => ERROR_HINTS.test(line));
  // 整页换掉（滚动、切标签）不算“新增”，只有局部增量才值得说。
  const incremental = added.length <= Math.max(3, Math.floor(prevLines.length * 0.5));
  const significant =
    sameContext && incremental && (errorLines.length > 0 || added.length >= 3 || removed.length >= 5);

  const parts: string[] = [];
  if (added.length > 0) {
    const preview = (errorLines.length > 0 ? errorLines : added)
      .slice(0, 1)
      .map((line) => line.slice(0, 40))
      .join('');
    parts.push(`新增 ${added.length} 行${preview ? `：${preview}` : ''}`);
  }
  if (removed.length > 0) parts.push(`少了 ${removed.length} 行`);

  return {
    added: added.slice(0, MAX_PREVIEW),
    removed: removed.slice(0, MAX_PREVIEW),
    addedCount: added.length,
    removedCount: removed.length,
    summary: parts.join('；'),
    significant,
    sameContext,
  };
}

export interface TypingDelta {
  charsAdded: number;
  charsRemoved: number;
  typing: boolean;
}

/** 光标附近文本从 a 变到 b：用来判断“在打字”还是“在读”。 */
/** 只挑“值得立刻说”的那一行：报错优先，其次没有。 */
export function firstErrorLine(diff: LineDiff): string | null {
  return diff.added.find((line) => ERROR_HINTS.test(line)) ?? null;
}

export function emptyDiff(): LineDiff {
  return {
    added: [],
    removed: [],
    addedCount: 0,
    removedCount: 0,
    summary: '',
    significant: false,
    sameContext: true,
  };
}

export function typingDelta(previous: string, next: string): TypingDelta {
  if (!previous || !next) return { charsAdded: 0, charsRemoved: 0, typing: false };
  if (previous === next) return { charsAdded: 0, charsRemoved: 0, typing: false };

  // 去掉公共前缀/后缀，剩下的就是实际增删。
  let start = 0;
  const limit = Math.min(previous.length, next.length);
  while (start < limit && previous[start] === next[start]) start += 1;

  let endPrev = previous.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && previous[endPrev - 1] === next[endNext - 1]) {
    endPrev -= 1;
    endNext -= 1;
  }

  const charsAdded = endNext - start;
  const charsRemoved = endPrev - start;
  return {
    charsAdded,
    charsRemoved,
    typing: charsAdded + charsRemoved >= 2,
  };
}
