/**
 * GUI 环境契约，照着 ernie_agent 的 CUADesktopMixin 简化而来：
 *
 *   execute_action_and_observe(action, params) -> { success, message, error?, observation }
 *
 * 关键点：动作的返回值里带一张**新截图**。模型不需要额外调 screenshot，
 * 看一眼返回图就能决定下一步。这里不建 precondition/verifier 阶段。
 */

export interface GuiObservation {
  /** data:image/jpeg;base64,... */
  screenshot: string;
  /** 模型实际看到的图片尺寸 */
  width: number;
  height: number;
  /** 真实屏幕逻辑尺寸（点），用于把 0..999 映射成像素 */
  screenWidth: number;
  screenHeight: number;
  app: string;
  title: string;
}

export interface GuiActionResult {
  success: boolean;
  message: string;
  error?: string;
  observation?: GuiObservation;
}

export interface GuiEnvironment {
  observe(): Promise<GuiObservation>;
  execute(action: string, params: Record<string, unknown>): Promise<GuiActionResult>;
  executeAndObserve(action: string, params: Record<string, unknown>): Promise<GuiActionResult>;
}

export interface GuiEnvironmentDeps {
  capture(): Promise<GuiObservation>;
  act(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string; error?: string }>;
  wait(ms: number): Promise<void>;
}

/** 0..999 的坐标映射到真实像素；999 对应最后一行/列，避免越界。 */
export function toPixels(value: number, size: number): number {
  if (!Number.isFinite(value) || size <= 1) return 0;
  const clamped = Math.min(999, Math.max(0, value));
  return Math.min(size - 1, Math.max(0, Math.round((clamped / 999) * (size - 1))));
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value.map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export class LocalMacEnvironment implements GuiEnvironment {
  private last: GuiObservation | null = null;
  private readonly deps: GuiEnvironmentDeps;

  constructor(deps: GuiEnvironmentDeps) {
    this.deps = deps;
  }

  async observe(): Promise<GuiObservation> {
    this.last = await this.deps.capture();
    return this.last;
  }

  private mapCoordinates(action: string, params: Record<string, unknown>): Record<string, unknown> {
    const screenWidth = this.last?.screenWidth ?? 1440;
    const screenHeight = this.last?.screenHeight ?? 900;
    const out: Record<string, unknown> = { ...params };

    if (action === 'click' || action === 'move') {
      const point = pair(params.coordinate);
      if (point) {
        out.x = toPixels(point[0], screenWidth);
        out.y = toPixels(point[1], screenHeight);
      }
    }

    if (action === 'drag') {
      const start = pair(params.start_coordinate);
      const end = pair(params.coordinate);
      if (start) {
        out.x1 = toPixels(start[0], screenWidth);
        out.y1 = toPixels(start[1], screenHeight);
      }
      if (end) {
        out.x2 = toPixels(end[0], screenWidth);
        out.y2 = toPixels(end[1], screenHeight);
      }
    }

    if (action === 'scroll') {
      const point = pair(params.coordinate);
      if (point) {
        out.x = toPixels(point[0], screenWidth);
        out.y = toPixels(point[1], screenHeight);
      }
      const amount = Math.max(1, Math.min(20, Number(params.amount) || 3));
      const direction = String(params.direction ?? 'down');
      out.dy = direction === 'up' ? amount : -amount;
    }

    return out;
  }

  async execute(action: string, params: Record<string, unknown>): Promise<GuiActionResult> {
    if (action === 'screenshot') {
      const observation = await this.observe();
      return { success: true, message: 'screenshot', observation };
    }

    if (action === 'wait') {
      const seconds = Math.min(10, Math.max(0.1, Number(params.duration) || 1));
      await this.deps.wait(Math.round(seconds * 1000));
      return { success: true, message: `waited ${seconds}s` };
    }

    if (!this.last) await this.observe();
    const mapped = this.mapCoordinates(action, params);
    return this.deps.act(action, mapped);
  }

  /** 动作 + 新截图，一次返回。 */
  async executeAndObserve(
    action: string,
    params: Record<string, unknown>,
  ): Promise<GuiActionResult> {
    const result = await this.execute(action, params);
    if (action !== 'wait') await this.deps.wait(350);
    const observation = await this.observe();
    return { ...result, observation };
  }
}
