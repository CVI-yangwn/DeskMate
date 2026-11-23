import type { GuiStep, Observation, Rect } from './types.ts';
import { normalizeRect } from './geometry.ts';

/**
 * 以第一次预测为中心裁一块，放大后再问一次。
 *
 * 这是对“小目标 + 整屏被压到 ~1024 token”的结构性补偿：
 * 第二次调用看到的元素像素更多，框也更容易贴准。
 */
export function expandForZoom(bbox: Rect, factor = 3, minSize = 0.12): Rect {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const width = Math.min(1, Math.max(bbox.width * factor, minSize));
  const height = Math.min(1, Math.max(bbox.height * factor, minSize));
  const x = Math.min(Math.max(cx - width / 2, 0), 1 - width);
  const y = Math.min(Math.max(cy - height / 2, 0), 1 - height);
  return { x, y, width, height };
}

/** 把裁剪图内的归一化框，映射回整屏归一化坐标。 */
export function mapCropTarget(crop: Rect, inner: Rect): Rect {
  return normalizeRect({
    x: crop.x + inner.x * crop.width,
    y: crop.y + inner.y * crop.height,
    width: inner.width * crop.width,
    height: inner.height * crop.height,
  });
}

export interface RefinePrompt {
  system: string;
  user: string;
  imagePosition: 'after_text';
}

const SYSTEM = [
  '你是一个屏幕元素定位器。这次给你的不是整屏，而是一块放大后的裁剪图。',
  '只输出目标在“裁剪图内”的归一化框，坐标范围 0..1，原点在裁剪图左上角。',
  '不要把坐标换算回整屏；换算由调用方完成。',
  '如果目标不在裁剪图里，返回 found=false。',
  '只输出一个 JSON 对象，不要 markdown，不要解释。',
].join('\n');

export function buildRefinePrompt(
  step: GuiStep,
  crop: Rect,
  observation: Observation,
  cropWidthPx: number,
): RefinePrompt {
  const user = [
    `目标：${step.instruction}`,
    `动作：${step.action.type}${step.action.text ? `（将输入：${step.action.text}）` : ''}`,
    `裁剪区域（相对整屏的归一化坐标）：x=${crop.x.toFixed(4)}, y=${crop.y.toFixed(4)}, w=${crop.width.toFixed(4)}, h=${crop.height.toFixed(4)}`,
    `裁剪图已放大到约 ${Math.round(cropWidthPx)}px 宽；整屏是 ${observation.width}x${observation.height}。`,
    '返回格式：{"found":true,"label":"元素的可见文字","bbox":[x,y,w,h],"confidence":0.0}',
    '找不到：{"found":false,"reason":"为什么找不到"}',
  ].join('\n');
  return { system: SYSTEM, user, imagePosition: 'after_text' };
}

/**
 * 像素正方形裁剪：w*W 必须等于 h*H，否则 resize 到 900x900 会把画面压扁。
 * sidePx = max(目标像素宽, 目标像素高) * factor，至少 minPx。
 */
export function squareCrop(
  bbox: Rect,
  screenWidth: number,
  screenHeight: number,
  factor = 4,
  minPx = 220,
): Rect {
  const sidePx = Math.min(
    Math.max(Math.max(bbox.width * screenWidth, bbox.height * screenHeight) * factor, minPx),
    screenWidth,
    screenHeight,
  );
  const width = sidePx / screenWidth;
  const height = sidePx / screenHeight;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), 1 - width);
  const y = Math.min(Math.max(cy - height / 2, 0), 1 - height);
  return { x, y, width, height };
}

/** 把裁剪图内的点映射回整屏归一化坐标。 */
export function mapCropPoint(crop: Rect, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: crop.x + point.x * crop.width,
    y: crop.y + point.y * crop.height,
  };
}

export function buildRefinePointPrompt(
  step: GuiStep,
  crop: Rect,
  observation: Observation,
  cropWidthPx: number,
): RefinePrompt {
  const user = [
    `目标：${step.instruction}`,
    `裁剪区域（相对整屏）：x=${crop.x.toFixed(4)}, y=${crop.y.toFixed(4)}, w=${crop.width.toFixed(4)}, h=${crop.height.toFixed(4)}`,
    `这是一块方形裁剪图，已放大到约 ${Math.round(cropWidthPx)}px；整屏是 ${observation.width}x${observation.height}。`,
    '只给出目标“中心点”在裁剪图内的归一化坐标，不要给框。',
    '返回格式：{"found":true,"point":[x,y],"confidence":0.0}',
    '找不到：{"found":false,"reason":"为什么找不到"}',
  ].join('\n');
  return { system: SYSTEM, user, imagePosition: 'after_text' };
}
