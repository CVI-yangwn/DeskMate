import type { Rect, Target } from './types.ts';
import { centerOf, normalizeRect } from './geometry.ts';

/**
 * 无障碍树的轻量模型。
 *
 * 定位策略是“视觉为主、AX 为辅”：
 * - 视觉给一个大概位置；
 * - 如果这个位置正好落在某个可操作的 AX 元素里，就用 AX 的精确 frame 吸附，
 *   并把置信度抬高（AX frame 是系统给的，不是模型猜的）。
 *
 * 注意：Electron/网页内容经常只暴露一个巨大的 AXGroup，不能指望 AX 覆盖所有元素。
 */
export interface AxNode {
  path: string;
  role: string;
  subrole?: string;
  title?: string;
  desc?: string;
  identifier?: string;
  value?: string;
  /** 屏幕坐标（点），[x, y, width, height] */
  frame?: [number, number, number, number];
  actions?: string[];
  enabled?: boolean;
}

export interface AxSnapshot {
  app: string;
  bundle: string;
  pid: number;
  nodes: AxNode[];
}

const ACTIONABLE_ROLES = new Set([
  'AXButton',
  'AXMenuItem',
  'AXMenuBarItem',
  'AXPopUpButton',
  'AXTextField',
  'AXTextArea',
  'AXLink',
  'AXCheckBox',
  'AXRadioButton',
  'AXTab',
  'AXSlider',
]);

export function isActionable(node: AxNode): boolean {
  return ACTIONABLE_ROLES.has(node.role) && (node.actions?.length ?? 0) > 0;
}

export function nodeFrame(node: AxNode): Rect | null {
  const frame = node.frame;
  if (!frame || frame.length !== 4) return null;
  const [x, y, width, height] = frame;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function parseAxSnapshot(json: string): AxSnapshot | null {
  try {
    const raw = JSON.parse(json) as Partial<AxSnapshot>;
    if (!raw || !Array.isArray(raw.nodes)) return null;
    return {
      app: String(raw.app ?? ''),
      bundle: String(raw.bundle ?? ''),
      pid: Number(raw.pid) || 0,
      nodes: raw.nodes.filter((node): node is AxNode => Boolean(node) && typeof node.role === 'string'),
    };
  } catch {
    return null;
  }
}

function contains(frame: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
}

/** 找到包含该点的最小可操作 AX 元素；没有就返回 null。 */
export function findActionableAt(nodes: AxNode[], point: { x: number; y: number }): AxNode | null {
  let best: AxNode | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!isActionable(node)) continue;
    const frame = nodeFrame(node);
    if (!frame || !contains(frame, point)) continue;
    const area = frame.width * frame.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

/**
 * 视觉框 → AX 吸附。只有“中心点落在可操作元素内”才吸附；
 * 吸附后换成 AX 的 frame，置信度至少 0.95。
 */
export function snapTargetToAx(
  target: Target,
  nodes: AxNode[],
  screenWidth: number,
  screenHeight: number,
): { target: Target; snapped: boolean; node: AxNode | null } {
  const center = centerOf(target.bbox);
  const node = findActionableAt(nodes, {
    x: center.x * screenWidth,
    y: center.y * screenHeight,
  });
  if (!node) return { target, snapped: false, node: null };
  const frame = nodeFrame(node);
  if (!frame) return { target, snapped: false, node: null };
  return {
    target: {
      label: node.title ?? node.desc ?? target.label,
      bbox: normalizeRect({
        x: frame.x / screenWidth,
        y: frame.y / screenHeight,
        width: frame.width / screenWidth,
        height: frame.height / screenHeight,
      }),
      confidence: Math.max(0.95, target.confidence),
    },
    snapped: true,
    node,
  };
}

/** 按可见文字/描述匹配 AX 元素（用于有明确标签的目标）。 */
export function matchByLabels(nodes: AxNode[], labels: string[]): AxNode | null {
  const wanted = labels.map((label) => label.trim()).filter(Boolean);
  if (wanted.length === 0) return null;
  let best: AxNode | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const haystack = [node.title, node.desc, node.value, node.identifier].filter(Boolean).join(' ');
    if (!haystack) continue;
    if (!wanted.some((label) => haystack.includes(label))) continue;
    const frame = nodeFrame(node);
    if (!frame) continue;
    const area = frame.width * frame.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}
