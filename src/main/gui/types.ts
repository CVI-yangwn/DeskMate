/**
 * GUI 执行层的公共类型。
 *
 * 这一层刻意不依赖 Electron / 截图 / 鼠标：loop 只认 Observation、Target 和
 * 三个回调（observe / locate / act / verify），这样评测可以在纯 Node 里跑，
 * 真实实现再各自适配。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type GuiActionType = 'click' | 'type' | 'key' | 'scroll';

export interface GuiAction {
  type: GuiActionType;
  /** type 时输入的文字 */
  text?: string;
  /** key 时的按键，例如 "cmd+s" */
  key?: string;
  /** scroll 时的格数，正数向下 */
  amount?: number;
}

/** irreversible 的动作默认需要确认；safe 的默认直接执行。 */
export type Risk = 'safe' | 'irreversible';

export interface GuiStep {
  id: string;
  /** 给定位器的自然语言描述，例如“右上角的关闭按钮” */
  instruction: string;
  action: GuiAction;
  risk: Risk;
  /** 动作后应该看到什么；验证器据此判断，而不是假设成功 */
  expect: string;
}

export interface GuiTask {
  id: string;
  title: string;
  app: string;
  steps: GuiStep[];
}

/**
 * 动作投递档位，从“最可验证”到“最兜底”：
 * ax       无障碍动作，读回即可确认
 * bg_pixel 背景像素投递，不抬窗、不动真实指针
 * foreground 前台真实输入，游戏/canvas 才用
 */
export type Delivery = 'ax' | 'bg_pixel' | 'foreground';

export const DELIVERY_LADDER: readonly Delivery[] = ['ax', 'bg_pixel', 'foreground'];

export interface Observation {
  id: string;
  width: number;
  height: number;
  capturedAt: number;
}

export interface Target {
  label: string;
  /** 归一化坐标 0..1，避免 Retina/多屏换算污染定位层 */
  bbox: Rect;
  confidence: number;
}

export interface ActOutcome {
  delivered: boolean;
  note: string;
}

export type VerifyResult = 'confirmed' | 'unverifiable' | 'failed';

export interface VerifyOutcome {
  result: VerifyResult;
  evidence: string;
}

export type GuardDecision = 'allow' | 'confirm' | 'deny';

export type AbortReason =
  | 'no_target'
  | 'step_failed'
  | 'loop_detected'
  | 'guard_denied'
  | 'budget'
  | 'cancelled';

export type StepStatus = 'done' | 'failed' | 'skipped';
export type TaskStatus = 'done' | 'aborted';

export interface AttemptTrace {
  attempt: number;
  delivery: Delivery;
  target: Target | null;
  act: ActOutcome | null;
  verify: VerifyOutcome | null;
  outcome: 'confirmed' | 'retry' | 'aborted';
}

export interface StepTrace {
  stepId: string;
  instruction: string;
  status: StepStatus;
  attempts: AttemptTrace[];
}

export interface TaskTrace {
  taskId: string;
  title: string;
  status: TaskStatus;
  reason?: AbortReason;
  steps: StepTrace[];
  locateCalls: number;
  startedAt: number;
  endedAt: number;
}

export type GuiLoopEvent =
  | { type: 'task_start'; taskId: string }
  | { type: 'step_start'; stepId: string; index: number }
  | { type: 'observe'; observation: Observation; phase: 'before' | 'after' }
  | { type: 'target'; target: Target; attempt: number }
  | { type: 'preview'; target: Target; delivery: Delivery }
  | { type: 'act'; target: Target; delivery: Delivery; outcome: ActOutcome }
  | { type: 'verify'; outcome: VerifyOutcome }
  | { type: 'step_done'; stepId: string }
  | { type: 'abort'; reason: AbortReason; stepId?: string }
  | { type: 'task_done'; taskId: string };
