export interface CorrectionHint {
  correctedActivity: string;
  minutes: number;
  timeHint?: string;
}

const QUESTION_PREFIX = /^(对不对|是不是|好不好|行不行|能不能|可以吗)/;
const ACTIVITY_CONTEXT = /(我|刚才|那会|这段时间|刚才那|在干嘛|在做什么|在忙|活动|屏幕)/;
const STRONG_CUE =
  /(答错|说错|搞错|记错|纠正|更正|不是这样|说得不对|说的不对|讲得不对|不对[，,。！!\s]|其实我|实际上我)/;
const CONTRAST = /不是.{0,40}?(?:而是|是)/s;

/**
 * 只在“看起来确实在纠正过去的观察”时返回 true。
 * 普通提问（我刚才在干嘛）和一般否定（这个函数不是这样）不触发。
 */
export function isCorrectionCue(message: string): boolean {
  const text = message.trim();
  if (!text || QUESTION_PREFIX.test(text)) return false;
  if (CONTRAST.test(text) && /(我|刚才|那会|这段时间|在|代码|周报|开会|屏幕)/.test(text)) {
    return true;
  }
  return ACTIVITY_CONTEXT.test(text) && STRONG_CUE.test(text);
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(720, Math.max(5, Math.round(value)));
}

function parseMinutes(message: string): number {
  if (/半小时/.test(message)) return 30;
  if (/一上午|半天/.test(message)) return 240;
  if (/一小时|1\s*小时/.test(message)) return 60;
  const match = message.match(/(\d+)\s*(分钟|小时)/);
  if (match) {
    const value = Number(match[1]);
    return clampMinutes(match[2] === '小时' ? value * 60 : value);
  }
  if (/上午/.test(message)) return 180;
  if (/下午/.test(message)) return 240;
  return 30;
}

/**
 * 模型不可用时的本地纠正解析。宁可只存用户原话，也不要编造。
 */
export function fallbackCorrection(message: string): CorrectionHint | null {
  if (/[?？]\s*$/.test(message) || /(在干嘛|做什么|在忙什么)/.test(message)) return null;
  let text = message
    .replace(
      /^(?:不对|你答错(?:了)?|你说错(?:了)?|你搞错(?:了)?|你记错(?:了)?|不是这样|纠正一下|更正一下)[，,。！!\s]*/,
      '',
    )
    .trim();

  if (!text) return null;

  const contrast = text.match(/不是.{0,40}?[，,]\s*(?:而是|是)\s*(.+)$/s);
  if (contrast?.[1]) {
    text = contrast[1].trim();
  } else {
    const actual = text.match(/(?:其实|实际上)[，,：:\s]*(?:我)?(?:刚才|那会|这段时间)?(?:是)?在?\s*(.+)$/s);
    if (actual?.[1]) text = actual[1].trim();
  }

  text = text
    .replace(
      /^(?:我)?(?:刚才|那会|那段时间|这段时间|刚才那段时间|上午|下午|晚上)?(?:一直|其实|实际上)?(?:是)?在[：:，,\s]*/,
      '',
    )
    .replace(/^[：:，,\s]+/, '')
    .replace(/[，,]\s*(?:大概|大约|差不多)?\s*(?:过去|最近)?\s*\d+\s*(?:分钟|小时).*$/, '')
    .replace(/[。！？!?]+$/, '')
    .trim();

  if (text.length < 2) return null;
  return {
    correctedActivity: text.slice(0, 160),
    minutes: parseMinutes(message),
    timeHint: /上午|下午|刚才|那会|这段时间|分钟|小时/.exec(message)?.[0],
  };
}
