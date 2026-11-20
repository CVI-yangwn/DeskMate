import type { ProactiveClue, ProactiveDecision, ProactiveRule } from '../shared/types';

export const PROACTIVE_KINDS = [
  'any',
  'test-pass',
  'test-fail',
  'observe',
  'idle',
  'return',
  'focus-milestone',
  'companion:morning',
  'companion:evening',
  'intent-predict',
] as const;

export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

const KIND_LABEL: Record<string, string> = {
  any: '所有主动消息',
  'test-pass': '测试通过',
  'test-fail': '测试失败',
  observe: '普通观察',
  idle: '离开/空闲提醒',
  return: '回来打招呼',
  'focus-milestone': '专注里程碑',
  'companion:morning': '早间问候',
  'companion:evening': '晚间收尾',
  'intent-predict': '下一步猜测',
};

const DECISION_LABEL: Record<ProactiveDecision, string> = {
  tell_now: '直接说',
  follow_up_later: '晚点再说',
  stay_silent: '别说',
};

export function decisionLabel(decision: ProactiveDecision): string {
  return DECISION_LABEL[decision];
}

export function eventKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function isProactiveKind(value: unknown): value is ProactiveKind {
  return typeof value === 'string' && (PROACTIVE_KINDS as readonly string[]).includes(value);
}

export function normalizeClock(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 支持跨夜窗口，例如 22:00 → 08:00。起止相同视为全天。 */
export function inTimeWindow(at: number, start?: string, end?: string): boolean {
  const from = normalizeClock(start);
  const to = normalizeClock(end);
  if (!from || !to) return true;
  if (from === to) return true;

  const date = new Date(at);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const parse = (clock: string): number => {
    const [hour, minute] = clock.split(':').map(Number);
    return hour * 60 + minute;
  };
  const fromMinutes = parse(from);
  const toMinutes = parse(to);
  if (fromMinutes < toMinutes) return minutes >= fromMinutes && minutes < toMinutes;
  return minutes >= fromMinutes || minutes < toMinutes;
}

export function ruleMatches(rule: ProactiveRule, kind: string, at: number): boolean {
  if (!rule.active) return false;
  if (rule.kind !== 'any' && rule.kind !== kind) return false;
  return inTimeWindow(at, rule.windowStart, rule.windowEnd);
}

function specificity(rule: ProactiveRule): number {
  return (rule.kind === 'any' ? 0 : 4) + (rule.windowStart && rule.windowEnd ? 2 : 0);
}

/**
 * 决定这条主动消息是否该被压住。
 * 规则越具体越优先：具体事件类型 > any，带时间窗 > 不带。
 */
export function gateProactive(
  rules: ProactiveRule[],
  kind: string,
  at: number,
): { decision: ProactiveDecision | 'allow'; rule?: ProactiveRule } {
  const matches = rules
    .filter((rule) => ruleMatches(rule, kind, at))
    .sort((a, b) => specificity(b) - specificity(a) || b.updatedAt - a.updatedAt);
  const rule = matches[0];
  if (!rule) return { decision: 'allow' };
  if (rule.decision === 'tell_now') return { decision: 'allow', rule };
  return { decision: rule.decision, rule };
}

export function describeRule(rule: ProactiveRule): string {
  const kind = eventKindLabel(rule.kind);
  const window =
    rule.windowStart && rule.windowEnd ? ` ${rule.windowStart}–${rule.windowEnd}` : '';
  return `${kind}${window} → ${decisionLabel(rule.decision)}`;
}

export interface FeedbackSignal {
  decision: ProactiveDecision;
  kind: string;
  label: string;
  windowStart?: string;
  windowEnd?: string;
  strong: boolean;
  reason: string;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function chineseHour(text: string): number | undefined {
  const match = /([零一二两三四五六七八九十]{1,2})\s*点/.exec(text);
  if (!match) return undefined;
  const raw = match[1];
  if (raw === '十') return 10;
  if (raw.length === 1) return CN_DIGITS[raw];
  if (raw.startsWith('十')) return 10 + (CN_DIGITS[raw[1]] ?? 0);
  if (raw.endsWith('十')) return (CN_DIGITS[raw[0]] ?? 0) * 10;
  return undefined;
}

export function windowFromText(text: string): { start?: string; end?: string } {
  const explicit = /(\d{1,2})\s*点(?:以后|之后|后)?/.exec(text) ?? /(\d{1,2}):(\d{2})\s*(?:以后|之后|后)/.exec(text);
  if (explicit) {
    let hour = Number(explicit[1]);
    if (/晚上|夜里|半夜|深夜/.test(text) && hour > 0 && hour < 12) hour += 12;
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      return { start: `${String(hour).padStart(2, '0')}:00`, end: '08:00' };
    }
  }
  const cn = chineseHour(text);
  if (cn !== undefined) return { start: `${String(cn).padStart(2, '0')}:00`, end: '08:00' };

  if (/晚上|夜里|半夜|深夜|睡前/.test(text)) return { start: '21:00', end: '08:00' };
  if (/早上|上午|一大早/.test(text)) return { start: '08:00', end: '12:00' };
  if (/中午/.test(text)) return { start: '12:00', end: '14:00' };
  if (/下午/.test(text)) return { start: '14:00', end: '18:00' };
  if (/工作时间|上班|白天/.test(text)) return { start: '09:00', end: '18:00' };
  return {};
}

function windowFields(text: string): { windowStart?: string; windowEnd?: string } {
  const window = windowFromText(text);
  return window.start && window.end
    ? { windowStart: window.start, windowEnd: window.end }
    : {};
}

export function kindFromText(text: string, fallback: string): string {
  if (/测试|单测|CI|红绿|build/i.test(text)) return fallback === 'test-fail' ? 'test-fail' : 'test-pass';
  if (/猜|预测|下一步|意图/.test(text)) return 'intent-predict';
  if (/专注|连续工作/.test(text)) return 'focus-milestone';
  if (/早间|早上问|早安/.test(text)) return 'companion:morning';
  if (/晚间|收尾|晚安/.test(text)) return 'companion:evening';
  if (/观察|正在做|在干嘛/.test(text)) return 'observe';
  if (/离开|空闲|久坐/.test(text)) return 'idle';
  return fallback || 'any';
}

/**
 * 先用本地规则抓“明确的偏好表达”。抓不准时再交给模型。
 * 返回 null 表示这句话不像是对提醒方式的反馈。
 */
export function detectExplicitFeedback(text: string, eventType: string): FeedbackSignal | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 200) return null;
  if (/(不对|不是|你搞错|纠正)/.test(clean)) return null;

  const deferPattern =
    /(晚点|回头|明天|等会|过会|先记着|以后再说|晚些|一会儿)[^。！？\n]{0,12}(再说|提醒|告诉我|提)?/;
  const deferNegative = /(现在|这会儿|这时候)[^。！？\n]{0,8}(别|不要|不用)(说|提醒|发)/;
  const negativePattern =
    /(以后|下次|以后都|从今以后|今后)?[^。！？\n]{0,16}(别|不要|不用|无需|甭)(再)?(提醒|告诉|说|发|弹|打扰)/;
  const tellNowPattern =
    /(以后|下次|以后都|从今以后)?[^。！？\n]{0,12}(直接|马上|立刻|第一时间)(说|告诉|提醒|发)/;
  const earlierPattern = /(早点|提前|第一时间)(告诉|说|提醒)/;
  const strong = /(以后|下次|从今以后|今后|从现在起)/.test(clean);
  const deferCue =
    deferPattern.test(clean) && /(说|提|告诉|提醒|别|不用|先记)/.test(clean) && !negativePattern.test(clean);

  if (deferNegative.test(clean) || deferCue) {
    return {
      decision: 'follow_up_later',
      kind: kindFromText(clean, eventType),
      label: clean.slice(0, 60),
      windowStart: windowFromText(clean).start,
      windowEnd: windowFromText(clean).end,
      strong,
      reason: clean.slice(0, 120),
    };
  }

  if (negativePattern.test(clean)) {
    // “现在/先/暂时别说话”是临时收声，不要升级成永久规则。
    if (/(现在|这会儿|暂时|先别|先不要)/.test(clean) && !strong) {
      return {
        decision: 'follow_up_later',
        kind: kindFromText(clean, eventType),
        label: clean.slice(0, 60),
        strong: false,
        reason: clean.slice(0, 120),
      };
    }
    return {
      decision: 'stay_silent',
      kind: kindFromText(clean, eventType),
      label: clean.slice(0, 60),
      ...windowFields(clean),
      strong: strong || /^(别|不要|不用)/.test(clean),
      reason: clean.slice(0, 120),
    };
  }

  if (tellNowPattern.test(clean) || earlierPattern.test(clean)) {
    return {
      decision: 'tell_now',
      kind: kindFromText(clean, eventType),
      label: clean.slice(0, 60),
      ...windowFields(clean),
      strong,
      reason: clean.slice(0, 120),
    };
  }

  return null;
}

export function clampDecision(value: unknown): ProactiveDecision {
  return value === 'stay_silent' || value === 'follow_up_later' ? value : 'tell_now';
}

export interface RuleDraft {
  kind: string;
  label: string;
  decision: ProactiveDecision;
  windowStart?: string;
  windowEnd?: string;
  reason?: string;
  source?: ProactiveRule['source'];
}

export function sanitizeRuleDraft(draft: RuleDraft, now = Date.now()): ProactiveRule | null {
  const kind = isProactiveKind(draft.kind) ? draft.kind : 'any';
  const decision = clampDecision(draft.decision);
  const windowStart = normalizeClock(draft.windowStart);
  const windowEnd = normalizeClock(draft.windowEnd);
  const label = (draft.label || eventKindLabel(kind)).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!label) return null;
  return {
    id: `rule-${kind}-${decision}-${windowStart ?? 'all'}-${windowEnd ?? 'all'}`,
    kind,
    label,
    decision,
    ...(windowStart && windowEnd ? { windowStart, windowEnd } : {}),
    reason: (draft.reason ?? '').slice(0, 200),
    source: draft.source ?? 'dreaming',
    seen: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function clueKey(clue: Pick<ProactiveClue, 'kind' | 'decision'>): string {
  return `${clue.kind}|${clue.decision}`;
}

/**
 * 同类线索累计到 2 次才升级成规则；用户明确命名过的情况由调用方直接建规则。
 */
export function promoteClues(
  clues: ProactiveClue[],
  existingRules: ProactiveRule[],
  now = Date.now(),
): ProactiveRule[] {
  const promoted: ProactiveRule[] = [];
  const groups = new Map<string, ProactiveClue[]>();
  for (const clue of clues) {
    if (!clue.kind) continue;
    const key = clueKey(clue);
    groups.set(key, [...(groups.get(key) ?? []), clue]);
  }

  for (const group of groups.values()) {
    const seen = group.reduce((sum, clue) => sum + clue.seen, 0);
    if (seen < 2) continue;
    const sample = group[0];
    if (
      existingRules.some(
        (rule) =>
          rule.kind === sample.kind &&
          rule.decision === sample.decision &&
          !rule.windowStart,
      )
    ) {
      continue;
    }
    const rule = sanitizeRuleDraft(
      {
        kind: sample.kind,
        label: sample.label,
        decision: sample.decision,
        reason: group.map((clue) => clue.note).filter(Boolean).join('；'),
        source: 'dreaming',
      },
      now,
    );
    if (rule) promoted.push(rule);
  }

  return promoted;
}

export function dedupeRules(rules: ProactiveRule[]): ProactiveRule[] {
  const map = new Map<string, ProactiveRule>();
  for (const rule of rules) {
    const key = `${rule.kind}|${rule.decision}|${rule.windowStart ?? ''}|${rule.windowEnd ?? ''}`;
    const previous = map.get(key);
    if (!previous || rule.updatedAt >= previous.updatedAt) map.set(key, rule);
  }
  return [...map.values()];
}
