import type { AnchorKind } from '../shared/types';

export interface LocalAnchorSignal {
  text: string;
  kind: AnchorKind;
  confidence: number;
}

export interface LocalCommitmentSignal {
  text: string;
  dueHint?: string;
  confidence: number;
}

export interface LocalSignals {
  anchors: LocalAnchorSignal[];
  commitments: LocalCommitmentSignal[];
}

const TIME_WORDS = /(今天|今日|刚刚|刚才|上午|下午|晚上|昨天|昨晚|这周|周末)/;
const PAST_ACTIONS =
  /(做了|做完|写完|修好|搞定|弄完|卡在|在弄|在改|在查|跑通|过了|失败|通过|见了|开了|吃了|去了|看完|学完|上线|发布|提交|合并)/;
const FUTURE_WORDS = /(今晚|明天|明早|等会|待会|回头|稍后|下周|下周[一二三四五六日天])/;
const INTENT_WORDS = /(要|会|得|需要|给|发|做|问|查|修|看|约|回|交|写|改|准备)/;
const FEELING_WORDS = /(累|烦|难受|开心|爽|焦虑|崩|困|兴奋|沮丧|踏实|紧张)/;

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((sentence) => sentence.replace(/^[\s，,、；;：:]+|[\s，,、；;：:]+$/g, '').trim())
    .filter(Boolean);
}

function cleanSentence(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 没有模型时的本地兜底：只抓“今天/刚刚 + 做了什么”和“今晚/明天 + 要做什么”。
 * 宁可不记，也不要记错。
 */
export function extractLocalSignals(text: string): LocalSignals {
  const anchors: LocalAnchorSignal[] = [];
  const commitments: LocalCommitmentSignal[] = [];

  for (const raw of splitSentences(text).slice(0, 6)) {
    const sentence = cleanSentence(raw);
    if (sentence.length < 6 || sentence.length > 120) continue;
    if (/[?？]$/.test(sentence) || /(吗|呢|吧)$/.test(sentence)) continue;
    if (/^(要不要|是否|能不能|可不可以)/.test(sentence)) continue;

    const future = sentence.match(FUTURE_WORDS)?.[1];
    if (future && INTENT_WORDS.test(sentence) && commitments.length < 1) {
      commitments.push({
        text: sentence,
        dueHint: future,
        confidence: 0.55,
      });
      continue;
    }

    if (TIME_WORDS.test(sentence) && PAST_ACTIONS.test(sentence) && anchors.length < 1) {
      anchors.push({
        text: sentence,
        kind: FEELING_WORDS.test(sentence) ? 'feeling' : 'work',
        confidence: 0.55,
      });
    }
  }

  return { anchors, commitments };
}

export function localDay(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return localDay();
  const value = new Date(year, month - 1, date);
  value.setDate(value.getDate() - 1);
  return localDay(value);
}

function firstText(items: Array<{ text: string }>): string | undefined {
  return items.find((item) => item.text.trim())?.text.trim();
}

export function buildMorningFallback(
  anchors: Array<{ text: string }>,
  commitments: Array<{ text: string }>,
): string {
  const commitment = firstText(commitments);
  if (commitment) return `昨天你说「${commitment}」，还惦记着吗？`;
  const anchor = firstText(anchors);
  if (anchor) return `昨天你在「${anchor}」。今天想从哪儿接上？`;
  return '昨天还有些没收尾的事。今天先处理哪个？';
}

export function buildEveningFallback(
  anchors: Array<{ text: string }>,
  commitments: Array<{ text: string }>,
): string {
  const anchor = firstText(anchors);
  const commitment = firstText(commitments);
  const head = anchor ? `今天你「${anchor}」。` : '今天先到这儿。';
  const tail = commitment ? `还记着「${commitment}」。` : '';
  return `${head}${tail}明天想先做什么？`.slice(0, 120);
}

export function isMorningWindow(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 14;
}

export function isEveningWindow(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 2;
}

export function recapDayFor(date = new Date()): string {
  return isEveningWindow(date) && date.getHours() < 2
    ? previousDay(localDay(date))
    : localDay(date);
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isQuietHours(
  date: Date,
  enabled: boolean,
  start: string,
  end: string,
): boolean {
  if (!enabled) return false;
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;

  const minutes = date.getHours() * 60 + date.getMinutes();
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
}
