import type { GuiStep, Observation, Target } from './types.ts';
import { clamp01, normalizeRect } from './geometry.ts';

export interface GroundingPrompt {
  system: string;
  user: string;
  /** 约定：截图放在 user 文本之后。指令先于图片能提升点击准确率。 */
  imagePosition: 'after_text';
}

export type CoordScale = 'unit' | '999';

export interface GroundingOptions {
  /** 截图上叠加的网格边长（例如 20 表示 20x20）。0 表示不加网格。 */
  grid?: number;
  /** 额外的界面提示，例如“这是一个深色主题的 IDE” */
  hint?: string;
  /**
   * 坐标约定：
   * 999 = 0..999 整数（默认；DeepSeek-VL2 / ERNIE agent 的传统）
   * unit = 0..1 小数（保留给旧调用）
   */
  coordScale?: CoordScale;
}

const SYSTEM = [
  '你是一个屏幕元素定位器，不负责规划，也不负责解释。',
  '给你一条目标和一张截图，你只回答目标在截图里的位置。',
  '规则：',
  '1. 只找“看得见、可点击”的元素；不要猜看不见的东西。',
  '2. 如果目标不存在、被遮挡，或你不确定，返回 found=false。',
  '3. 坐标格式 [x, y, width, height]，原点在左上角；数值范围见下方“坐标约定”。',
  '4. 框要贴住元素的可点击区域，不要框住整块面板。',
  '5. 只输出一个 JSON 对象，不要 markdown，不要解释。',
].join('\n');

export function buildGroundingPrompt(
  step: GuiStep,
  observation: Observation,
  options: GroundingOptions = {},
): GroundingPrompt {
  const grid = options.grid ?? 0;
  const scale = options.coordScale ?? '999';
  const coordLine =
    scale === '999'
      ? '坐标约定：0..999 的整数，左上角是 (0,0)，右下角是 (999,999)；width/height 也是 0..999 的跨度。不要输出小数。'
      : '坐标约定：0..1 的小数，左上角是 (0,0)，右下角是 (1,1)；width/height 也是 0..1 的比例。';
  const lines = [
    `目标：${step.instruction}`,
    `动作：${step.action.type}${step.action.text ? `（将输入：${step.action.text}）` : ''}`,
    '截图就是你看到的画面；直接在这张图上读坐标，不要假设或换算到其他分辨率。',
    coordLine,
  ];
  if (grid > 0) {
    lines.push(
      `截图已叠加 ${grid}x${grid} 网格：先在心里报出目标所在格子（如 C7），再给出该元素中心的归一化坐标。`,
    );
  }
  if (options.hint) lines.push(`界面提示：${options.hint}`);
  lines.push(
    '返回格式：{"found":true,"label":"元素的可见文字","bbox":[x,y,w,h],"confidence":0.0}',
    '找不到：{"found":false,"reason":"为什么找不到"}',
  );
  return { system: SYSTEM, user: lines.join('\n'), imagePosition: 'after_text' };
}

export interface VerificationPrompt {
  system: string;
  user: string;
  imagePosition: 'after_text';
}

export function buildVerificationPrompt(step: GuiStep, observation: Observation): VerificationPrompt {
  const system = [
    '你是动作结果的验证器。',
    '给你动作前的意图、动作后的截图，你只判断“预期结果是否真的发生”。',
    '不要因为动作看起来合理就判成功；只看截图里的证据。',
    '只输出一个 JSON 对象。',
  ].join('\n');
  const user = [
    `刚才的动作：${step.action.type}（${step.instruction}）`,
    `预期结果：${step.expect}`,
    '第一张图是动作前，第二张图是动作后；只在第二张图里找证据，不要因为动作看起来合理就判成功。',
    `截图：${observation.width}x${observation.height}`,
    '返回格式：{"result":"confirmed|unverifiable|failed","evidence":"一句话证据"}',
    'confirmed=截图里能直接看到预期结果；unverifiable=看不出变化或截图不可用；failed=看到了相反/错误的状态。',
  ].join('\n');
  return { system, user, imagePosition: 'after_text' };
}

function extractJson(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析定位器的回复。宁可返回 null（当作没找到），也不返回一个瞎猜的框。
 */
export function parseGroundingReply(reply: string, scale: CoordScale = '999'): Target | null {
  const parsed = extractJson(reply);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.found !== true) return null;

  const raw = obj.bbox;
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  let [x, y, width, height] = nums;
  if (scale === '999') {
    // 0..999 约定；如果模型仍然给了 0..1，就按 0..1 处理（并让调用方从原始值看出来）
    if (x > 1 || y > 1 || width > 1 || height > 1) {
      x /= 999;
      y /= 999;
      width /= 999;
      height /= 999;
    }
  } else if (x > 1 || y > 1 || width > 1 || height > 1) {
    // 兼容模型偶发的像素坐标：全部大于 1 时按 1000 归一化（不猜具体分辨率）。
    x /= 1000;
    y /= 1000;
    width /= 1000;
    height /= 1000;
  }
  if (width <= 0 || height <= 0) return null;

  const confidence = clamp01(Number(obj.confidence ?? 0.5));
  return {
    label: String(obj.label ?? '').slice(0, 80),
    bbox: normalizeRect({ x, y, width, height }),
    confidence,
  };
}
