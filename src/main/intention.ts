import type { Intention } from '../shared/types';

/**
 * 意图层：把 DeskMate 每次扫描看到的一串“活动”压成一段可命名的意图。
 *
 * 借鉴 Act2Intention 的结构（动作 → 描述 → 意图段 → 预测 → 确认），
 * 但不照搬它的频率：那边是秒级的原子 GUI 动作，这边是 12–60 秒一次的活动快照，
 * 所以分段用本地规则而不是让模型切，只有“命名”和“预测”两步交给模型。
 */

export interface IntentionStep {
  at: number;
  app: string;
  title: string;
  activity: string;
  /** 正在处理的那个“东西”：文件名 / 页面标题 / URL。换它就算换了一件事 */
  entity?: string;
  /** 光标附近文本（辅助功能读取），可选 */
  focus?: string;
  /** 与上一次扫描相比的变化摘要，可选 */
  change?: string;
}

export interface SegmentAccumulator {
  app: string;
  entity?: string;
  title: string;
  startAt: number;
  lastAt: number;
  steps: IntentionStep[];
}

export interface FinishedSegment {
  app: string;
  entity?: string;
  title: string;
  startAt: number;
  endAt: number;
  steps: IntentionStep[];
}

export interface StepUpdate {
  acc: SegmentAccumulator;
  finished: FinishedSegment | null;
}

/** 超过这么久没有新的扫描，就认为上一件事已经结束了。 */
export const SEGMENT_GAP_MS = 8 * 60_000;
/** 单段超过这个长度，且语义已经漂移，就另起一段。 */
export const SEGMENT_MAX_MS = 45 * 60_000;
/** 硬上限：再长也切，避免一个“上午”被算成同一件事。 */
export const SEGMENT_HARD_MAX_MS = 70 * 60_000;
/** 一句话、一分钟的走神不值得记成意图。 */
export const MIN_STEPS = 2;
export const MIN_DURATION_MS = 60_000;
/** 低于这个把握就不说出口。与论文的 θ=0.60 对齐。 */
export const PUSH_THRESHOLD = 0.6;
// 40 字会把中文从词中间切断（实际跑出来见过「标识方」这种结尾），放宽到 60。
const MAX_INTENTION_LENGTH = 60;

const PUNCTUATION = /[\s，。、；：！？,.;:!?'"“”‘’（）()【】[\]<>《》~-]/g;

function compact(text: string): string {
  return text.replace(PUNCTUATION, '');
}

function bigrams(text: string): Set<string> {
  const clean = compact(text);
  const grams = new Set<string>();
  if (clean.length <= 2) {
    if (clean) grams.add(clean);
    return grams;
  }
  for (let i = 0; i < clean.length - 1; i += 1) grams.add(clean.slice(i, i + 2));
  return grams;
}

/** 中文字符二元组 Jaccard 相似度：够便宜，也够区分“同一件事”和“换了一件事”。 */
export function textSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function sameApp(a: string, b: string): boolean {
  const left = compact(a).toLowerCase();
  const right = compact(b).toLowerCase();
  if (!left || !right) return left === right;
  if (left === right) return true;
  return (left.includes(right) || right.includes(left)) && Math.abs(left.length - right.length) >= 3;
}

function latestActivity(acc: SegmentAccumulator): string {
  for (let i = acc.steps.length - 1; i >= 0; i -= 1) {
    const activity = acc.steps[i].activity.trim();
    if (activity) return activity;
  }
  return '';
}

export function startSegment(step: IntentionStep): SegmentAccumulator {
  return {
    app: step.app,
    ...(step.entity ? { entity: step.entity } : {}),
    title: step.title,
    startAt: step.at,
    lastAt: step.at,
    steps: [step],
  };
}

/**
 * “正在做的事”的实体：优先用文件路径/URL，其次从窗口标题里剥出来。
 *
 * 这一步是为了解决“同一个浏览器里看了十个不同文档，却被拼成一件事”。
 * 换实体就换段，比只看 App 细一档。
 */
export function extractEntity(input: { app: string; title: string; doc?: string }): string {
  const title = input.title.replace(/\s+/g, ' ').trim();
  const head = title ? (title.split(/\s+[—–\-|]\s+/)[0] ?? title) : '';
  const titleEntity = head
    .replace(/^(预览|preview|编辑|edit|查看|view)\s*/i, '')
    .trim();

  // 标题优先：它一直都有，而且同一页面稳定；AXDocument 时有时无，
  // 一会儿用 URL、一会儿用标题会让同一页被判成两件事。
  if (titleEntity && !/^(untitled|未命名|无标题|新标签页|new tab)$/i.test(titleEntity)) {
    return titleEntity.slice(0, 80);
  }

  const doc = (input.doc ?? '').trim();
  if (/^https?:\/\//i.test(doc)) {
    try {
      const url = new URL(doc);
      return `${url.hostname}${url.pathname}`.replace(/\/+$/, '').slice(0, 120);
    } catch {
      // 落到下面
    }
  }
  if (doc && !doc.startsWith('file://')) {
    const base = doc.split('/').filter(Boolean).pop() ?? doc;
    if (base.length >= 3) return base.slice(0, 80);
  }

  return (titleEntity || input.app).slice(0, 80);
}

/** 同一个东西的不同写法（带后缀、大小写、轻微改写）算同一个。 */
export function sameEntity(a?: string, b?: string): boolean {
  const left = (a ?? '').trim().toLowerCase();
  const right = (b ?? '').trim().toLowerCase();
  if (!left || !right) return true;
  if (left === right) return true;
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return textSimilarity(left, right) >= 0.6;
}

export function shouldStartNewSegment(acc: SegmentAccumulator, step: IntentionStep): boolean {
  if (step.at - acc.lastAt > SEGMENT_GAP_MS) return true;
  if (!sameApp(acc.app, step.app)) return true;

  // 同一个 App 里换了文件/页面，就是换了件事——这是“别把看过的十样东西拼成一件”的关键。
  if (step.entity && acc.entity && !sameEntity(acc.entity, step.entity)) {
    const elapsed = step.at - acc.startAt;
    // 只挡“秒级抖动”：跨一次扫描（≥20s）的实体变化就是真的换东西了。
    if (elapsed >= 20_000) return true;
  }

  const duration = step.at - acc.startAt;
  if (duration > SEGMENT_HARD_MAX_MS) return true;
  if (duration > SEGMENT_MAX_MS) {
    // 同一 App 待太久，只有“还是同一件事”才继续算一段。
    return textSimilarity(latestActivity(acc), step.activity) < 0.25;
  }
  return false;
}

/** 累积一步；需要收尾时把 finished 交给调用方去命名。 */
export function advanceSegment(
  acc: SegmentAccumulator | null,
  step: IntentionStep,
): StepUpdate {
  if (!acc) return { acc: startSegment(step), finished: null };
  if (shouldStartNewSegment(acc, step)) {
    return { acc: startSegment(step), finished: finalizeSegment(acc) };
  }
  return {
    acc: {
      ...acc,
      entity: acc.entity ?? step.entity,
      title: step.title || acc.title,
      lastAt: step.at,
      steps: [...acc.steps, step],
    },
    finished: null,
  };
}

export function finalizeSegment(acc: SegmentAccumulator): FinishedSegment {
  return {
    app: acc.app,
    ...(acc.entity ? { entity: acc.entity } : {}),
    title: acc.title,
    startAt: acc.startAt,
    endAt: acc.lastAt,
    steps: acc.steps,
  };
}

export function isWorthRecording(segment: FinishedSegment): boolean {
  const duration = segment.endAt - segment.startAt;
  // 换实体会让段变短：看过两眼（两次扫描、至少一分钟）就记，
  // 只瞥了一眼的东西要两分钟以上才记。
  if (segment.steps.length < MIN_STEPS) return duration >= MIN_DURATION_MS * 2;
  return duration >= MIN_DURATION_MS || segment.steps.length >= 3;
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 给模型的步骤行：`- 10:12 [Xcode] 在改 auth 模块的登录校验` */
export function describeStep(step: IntentionStep): string {
  const activity = step.activity.replace(/\s+/g, ' ').trim();
  return `- ${formatClock(step.at)} [${step.app || '未知应用'}] ${activity}`;
}

export function segmentToPrompt(segment: FinishedSegment): string {
  // 只取最近的、非空的光标/变化信息：它们最能说明“这段时间到底在干什么”。
  const focus = [...segment.steps]
    .reverse()
    .map((step) => step.focus?.trim())
    .find((text) => text && text.length > 0);
  const changes = segment.steps
    .map((step) => step.change?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(-3);

  return [
    `应用：${segment.app || '未知'}`,
    ...(segment.entity ? [`对象：${segment.entity}`] : []),
    `窗口：${segment.title || '未记录'}`,
    `时间：${formatClock(segment.startAt)}–${formatClock(segment.endAt)}（${Math.max(
      1,
      Math.round((segment.endAt - segment.startAt) / 60_000),
    )} 分钟）`,
    '步骤：',
    ...segment.steps.slice(0, 12).map(describeStep),
    ...(focus ? [`光标附近：${focus.slice(0, 300)}`] : []),
    ...(changes.length ? [`期间变化：${changes.join(' / ')}`] : []),
  ].join('\n');
}

const GENERIC_ACTIVITY = /^(在)?(看|用|弄|搞|做|处理|忙|工作|操作|浏览)/;

/** 没有模型时的兜底：宁可说得粗一点，也不要编。 */
export function localIntentionText(segment: FinishedSegment): string {
  const activities = segment.steps
    .map((step) => step.activity.replace(/\s+/g, ' ').trim())
    .filter((text) => text && !/^（mock）/.test(text) && !/暂时看不清|屏幕已锁定/.test(text));

  const scored = activities
    .map((text) => ({
      text,
      score: compact(text).length - (GENERIC_ACTIVITY.test(text) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.text ?? segment.title ?? '';
  const head = segment.app ? `在 ${segment.app}：` : '';
  return `${head}${best}`.replace(/\s+/g, ' ').trim().slice(0, MAX_INTENTION_LENGTH);
}

export function sanitizeIntentionText(text: string): string {
  return text
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_INTENTION_LENGTH);
}

const EMPTY_PREDICTION = /^(继续工作|继续使用|使用电脑|打开应用|做点事情|工作|无|未知|暂无)$/;

export interface PredictionGateInput {
  text: string;
  app?: string;
  confidence: number;
}

export interface PredictionGateResult {
  push: boolean;
  reason: string;
}

/**
 * 论文里的“置信度回退”落到这儿：模型自评不够、话太空、或没有可执行落点时，
 * 只记录不打扰。宁可不猜，也不要猜错还说出来。
 *
 * 阈值可传：实际跑起来发现模型会稳定停在某个分数（比如 0.55），
 * 硬编码 0.60 会让功能看起来“没生效”，所以留一个可调的口子。
 */
export function gatePrediction(
  input: PredictionGateInput,
  threshold = PUSH_THRESHOLD,
): PredictionGateResult {
  const text = sanitizeIntentionText(input.text ?? '');
  if (!text || text.length < 4) return { push: false, reason: '预测为空' };
  if (EMPTY_PREDICTION.test(text)) return { push: false, reason: '预测太泛' };
  if (!Number.isFinite(input.confidence)) return { push: false, reason: '没有置信度' };
  if (input.confidence < threshold) {
    return { push: false, reason: `置信度 ${input.confidence.toFixed(2)} 低于 ${threshold}` };
  }
  return { push: true, reason: `置信度 ${input.confidence.toFixed(2)}` };
}

/**
 * 行为画像：论文用 DeepSeek-R1 从意图轨迹反推 persona，这里先用确定性统计，
 * 便宜、可解释、不会编造。
 */
export function buildBehaviorProfile(intentions: Intention[], now = Date.now()): string {
  if (intentions.length === 0) return '';

  const appCount = new Map<string, number>();
  const buckets: Record<string, number> = { 上午: 0, 下午: 0, 晚上: 0, 深夜: 0 };
  for (const item of intentions) {
    const app = item.app?.trim();
    if (app) appCount.set(app, (appCount.get(app) ?? 0) + 1);
    const hour = new Date(item.startAt || item.at || now).getHours();
    if (hour >= 5 && hour < 12) buckets['上午'] += 1;
    else if (hour >= 12 && hour < 18) buckets['下午'] += 1;
    else if (hour >= 18 && hour < 23) buckets['晚上'] += 1;
    else buckets['深夜'] += 1;
  }

  const topApps = [...appCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([app, count]) => `${app} ${count} 次`)
    .join('、');
  const peak = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  const recent = intentions
    .slice(0, 3)
    .map((item) => item.text)
    .filter(Boolean)
    .join('；');

  const parts = [
    topApps ? `常用：${topApps}` : '',
    peak && peak[1] > 0 ? `主要在${peak[0]}` : '',
    recent ? `最近做过：${recent}` : '',
  ].filter(Boolean);

  return parts.join('；').slice(0, 220);
}

/** 用户刚说过“不是”，短时间内别把差不多的话再猜一遍。 */
export function isRepeatedPrediction(text: string, rejected: string[]): boolean {
  const candidate = sanitizeIntentionText(text);
  if (!candidate) return false;
  return rejected.some((item) => textSimilarity(candidate, item) >= 0.55);
}
