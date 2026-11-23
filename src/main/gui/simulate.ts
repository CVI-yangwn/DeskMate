import type { Observation, Rect, Target, TaskTrace } from './types.ts';
import { iou, normalizeRect } from './geometry.ts';
import { runGuiTask } from './loop.ts';
import type { GuiLoopDeps } from './loop.ts';
import type { Scenario } from './scenarios.ts';

/** 模拟器的旋钮：把“定位有多准”“验证有多瞎”变成可扫的参数。 */
export interface SimConfig {
  /** 一次定位就命中真值的概率 */
  hitRate: number;
  /** 返回“没找到”的概率 */
  missRate: number;
  /** 动作发出、但界面没有真的变化 */
  noopRate: number;
  /** 点错了，但验证器仍然判成功（最危险的情况） */
  verifyBlindRate: number;
  /** 动作投递本身失败 */
  deliveryFailRate: number;
  /** 不可逆动作被用户拒绝 */
  confirmDenyRate: number;
  /** 重试时重复上一次错误目标的概率（同一屏幕、同一模型的相关性） */
  stickyRate: number;
  seed: number;
}

export const DEFAULT_SIM: Omit<SimConfig, 'seed'> = {
  hitRate: 0.8,
  missRate: 0.1,
  noopRate: 0.02,
  verifyBlindRate: 0.05,
  deliveryFailRate: 0.02,
  confirmDenyRate: 0,
  stickyRate: 0.5,
};

export interface SimResult {
  trace: TaskTrace;
  falseSuccess: boolean;
  misses: number;
  wrongTargets: number;
  confirms: number;
  attempts: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rect: Rect, rng: () => number): Rect {
  return normalizeRect({
    x: rect.x + (rng() - 0.5) * 0.01,
    y: rect.y + (rng() - 0.5) * 0.01,
    width: rect.width,
    height: rect.height,
  });
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 用“已知真值 + 可调错误率”的假定位器跑真实 loop。
 *
 * 它不能替代真实 grounding 评测，但能在没有模型的情况下回答两个问题：
 * 1) 单步 80% 时，三步任务还能剩多少成功率？
 * 2) 验证器漏判时，会不会把“点错了”包装成“完成了”？
 */
export async function runScenario(scenario: Scenario, config: SimConfig): Promise<SimResult> {
  const rng = mulberry32(config.seed);
  const hitRate = clampRate(config.hitRate);
  const missRate = Math.min(clampRate(config.missRate), 1 - hitRate);
  const noopRate = clampRate(config.noopRate);
  const blindRate = clampRate(config.verifyBlindRate);
  const failRate = clampRate(config.deliveryFailRate);
  const denyRate = clampRate(config.confirmDenyRate);
  const sticky = clampRate(config.stickyRate);

  const steps = new Map(scenario.steps.map((item) => [item.id, item]));
  let truth: Rect = scenario.steps[0].truth;
  let last: Target | null = null;
  let lastStepId = '';
  let clock = 0;
  let confirms = 0;

  const deps: GuiLoopDeps = {
    observe: async (): Promise<Observation> => {
      clock += 1;
      return { id: `obs-${clock}`, width: 1440, height: 900, capturedAt: clock };
    },
    locate: async (step, _observation, attempt) => {
      const spec = steps.get(step.id);
      if (!spec) return null;
      truth = spec.truth;
      // 相关性：上一轮点错了，这一轮很可能还点同一个地方
      if (
        attempt > 0 &&
        last &&
        lastStepId === step.id &&
        iou(last.bbox, spec.truth) < 0.5 &&
        rng() < sticky
      ) {
        return last;
      }
      lastStepId = step.id;
      const roll = rng();
      if (roll < hitRate) {
        last = {
          label: step.instruction,
          bbox: jitter(spec.truth, rng),
          confidence: 0.75 + rng() * 0.2,
        };
        return last;
      }
      if (roll < hitRate + missRate) {
        last = null;
        return null;
      }
      const decoy = spec.decoys[Math.floor(rng() * spec.decoys.length)] ?? {
        ...spec.truth,
        x: Math.min(0.8, spec.truth.x + 0.15),
      };
      last = { label: 'distractor', bbox: decoy, confidence: 0.35 + rng() * 0.2 };
      return last;
    },
    act: async () => ({ delivered: rng() >= failRate, note: 'simulated' }),
    verify: async (_step, _before, _after, acted) => {
      if (!last) return { result: 'failed', evidence: '没有目标可验证' };
      if (!acted.delivered) return { result: 'failed', evidence: '事件未投递' };
      if (rng() < noopRate) return { result: 'unverifiable', evidence: '截图看不出变化' };
      const hit = iou(last.bbox, truth) >= 0.5;
      if (hit) return { result: 'confirmed', evidence: '预期状态出现' };
      if (rng() < blindRate) return { result: 'confirmed', evidence: '（模拟漏判）' };
      return { result: 'failed', evidence: '出现了非预期状态' };
    },
    confirm: async () => {
      confirms += 1;
      return rng() >= denyRate;
    },
    wait: async () => {},
    now: () => clock,
  };

  const trace = await runGuiTask(scenario, deps, {
    maxSteps: 3,
    maxAttemptsPerStep: 3,
    maxLocateCalls: scenario.steps.length * 3 + 2,
    waitMs: 0,
  });

  let falseSuccess = false;
  let misses = 0;
  let wrongTargets = 0;
  let attempts = 0;
  for (const stepTrace of trace.steps) {
    const spec = steps.get(stepTrace.stepId);
    for (const attempt of stepTrace.attempts) {
      attempts += 1;
      if (!attempt.target) {
        misses += 1;
        continue;
      }
      const hit = spec ? iou(attempt.target.bbox, spec.truth) >= 0.5 : false;
      if (!hit) {
        wrongTargets += 1;
        if (attempt.verify?.result === 'confirmed') falseSuccess = true;
      }
    }
  }

  return { trace, falseSuccess, misses, wrongTargets, confirms, attempts };
}

export interface SuiteMetrics {
  hitRate: number;
  tasks: number;
  taskSuccess: number;
  falseSuccess: number;
  stepSuccess: number;
  attempts: number;
  attemptPerTask: number;
  missRate: number;
  wrongTargetRate: number;
  aborts: Record<string, number>;
}

export async function runSuite(
  scenarios: Scenario[],
  config: SimConfig,
  sims: number,
): Promise<SuiteMetrics> {
  let done = 0;
  let falseSuccess = 0;
  let stepsDone = 0;
  let stepsTotal = 0;
  let attempts = 0;
  let misses = 0;
  let wrong = 0;
  const aborts: Record<string, number> = {};

  for (let i = 0; i < sims; i += 1) {
    for (let s = 0; s < scenarios.length; s += 1) {
      const result = await runScenario(scenarios[s], {
        ...config,
        seed: (config.seed + i * 7919 + s * 104729) >>> 0,
      });
      if (result.trace.status === 'done') done += 1;
      if (result.falseSuccess) falseSuccess += 1;
      for (const step of result.trace.steps) {
        stepsTotal += 1;
        if (step.status === 'done') stepsDone += 1;
      }
      attempts += result.attempts;
      misses += result.misses;
      wrong += result.wrongTargets;
      if (result.trace.status === 'aborted' && result.trace.reason) {
        aborts[result.trace.reason] = (aborts[result.trace.reason] ?? 0) + 1;
      }
    }
  }

  const tasks = sims * scenarios.length;
  return {
    hitRate: config.hitRate,
    tasks,
    taskSuccess: tasks ? done / tasks : 0,
    falseSuccess: tasks ? falseSuccess / tasks : 0,
    stepSuccess: stepsTotal ? stepsDone / stepsTotal : 0,
    attempts,
    attemptPerTask: tasks ? attempts / tasks : 0,
    missRate: attempts ? misses / attempts : 0,
    wrongTargetRate: attempts ? wrong / attempts : 0,
    aborts,
  };
}

export async function sweep(
  scenarios: Scenario[],
  rates: number[],
  sims: number,
  base: Omit<SimConfig, 'hitRate' | 'seed'> = DEFAULT_SIM,
): Promise<SuiteMetrics[]> {
  const rows: SuiteMetrics[] = [];
  for (const rate of rates) {
    rows.push(await runSuite(scenarios, { ...base, hitRate: rate, seed: 20261123 }, sims));
  }
  return rows;
}

export interface TaskRow {
  id: string;
  title: string;
  success: number;
  falseSuccess: number;
  avgAttempts: number;
  topAbort: string;
}

export async function perTask(
  scenarios: Scenario[],
  config: SimConfig,
  sims: number,
): Promise<TaskRow[]> {
  const rows: TaskRow[] = [];
  for (let s = 0; s < scenarios.length; s += 1) {
    let done = 0;
    let falseSuccess = 0;
    let attempts = 0;
    const aborts: Record<string, number> = {};
    for (let i = 0; i < sims; i += 1) {
      const result = await runScenario(scenarios[s], {
        ...config,
        seed: (config.seed + i * 7919 + s * 104729) >>> 0,
      });
      if (result.trace.status === 'done') done += 1;
      if (result.falseSuccess) falseSuccess += 1;
      attempts += result.attempts;
      const reason = result.trace.reason;
      if (reason) aborts[reason] = (aborts[reason] ?? 0) + 1;
    }
    const topAbort = Object.entries(aborts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
    rows.push({
      id: scenarios[s].id,
      title: scenarios[s].title,
      success: done / sims,
      falseSuccess: falseSuccess / sims,
      avgAttempts: attempts / sims,
      topAbort,
    });
  }
  return rows;
}
