import type { Rect } from './types.ts';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersection(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/** IoU，两个框都用归一化坐标。 */
export function iou(a: Rect, b: Rect): number {
  const inter = intersection(a, b);
  if (inter <= 0) return 0;
  const union = area(a) + area(b) - inter;
  if (union <= 0) return 0;
  // 浮点误差可能让同一个框算出 1.0000000000000004
  return Math.min(1, Math.max(0, inter / union));
}

export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 目标框里是否包含某个点（归一化）。 */
export function containsPoint(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** 点是否落在给定框的中心区域（用于“点中了但点偏了”的判定）。 */
export function hitsInner(rect: Rect, point: { x: number; y: number }, margin = 0.2): boolean {
  const inner: Rect = {
    x: rect.x + rect.width * margin,
    y: rect.y + rect.height * margin,
    width: rect.width * (1 - margin * 2),
    height: rect.height * (1 - margin * 2),
  };
  return containsPoint(inner, point);
}

export function normalizeRect(rect: Rect): Rect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    width: Math.min(clamp01(rect.width), 1 - x),
    height: Math.min(clamp01(rect.height), 1 - y),
  };
}

/** 把框对齐到 0.001，用作循环检测的签名，避免浮点抖动。 */
export function stableKey(rect: Rect): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return `${round(rect.x)},${round(rect.y)},${round(rect.width)},${round(rect.height)}`;
}
