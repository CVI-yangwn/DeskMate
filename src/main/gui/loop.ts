import type {
  AbortReason,
  ActOutcome,
  AttemptTrace,
  Delivery,
  GuiLoopEvent,
  GuiStep,
  GuiTask,
  Observation,
  StepTrace,
  Target,
  TaskTrace,
  VerifyOutcome,
} from './types.ts';
import { DELIVERY_LADDER } from './types.ts';
import { stableKey } from './geometry.ts';

export interface GuiLoopDeps {
  observe(): Promise<Observation>;
  locate(step: GuiStep, observation: Observation, attempt: number): Promise<Target | null>;
  act(step: GuiStep, target: Target, delivery: Delivery): Promise<ActOutcome>;
  verify(
    step: GuiStep,
    before: Observation,
    after: Observation,
    act: ActOutcome,
  ): Promise<VerifyOutcome>;
  guard?(step: GuiStep, target: Target): 'allow' | 'confirm' | 'deny';
  /**
   * 不可逆动作的确认。默认拒绝：没有接入确认 UI 之前，宁可不做。
   */
  confirm?(step: GuiStep, target: Target): Promise<boolean>;
  preview?(step: GuiStep, target: Target, delivery: Delivery): Promise<void> | void;
  wait?(ms: number): Promise<void>;
  onEvent?(event: GuiLoopEvent): void;
  now?(): number;
}

export interface GuiLoopOptions {
  /** 每一步最多几次尝试（对应动作阶梯的档位） */
  maxAttemptsPerStep?: number;
  /** 整个任务最多几次定位调用，防止预算失控 */
  maxLocateCalls?: number;
  /** 最多执行几步，默认 3；宁可少做，不可长链 */
  maxSteps?: number;
  /** 动作后等待多久再截图验证 */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GUI 任务的唯一执行环：
 *
 *   OBSERVE → LOCATE → GUARD → PREVIEW → ACT → VERIFY
 *                ↑                              │
 *                └──────── RETRY(≤N) ←──────────┘
 *
 * 约束（刻意为之）：
 * - 一步一个动作，不做批量；
 * - 失败不重试到成功，最多走完动作阶梯就停；
 * - 不可逆动作默认需要确认，没有确认就拒绝；
 * - 相同目标连续失败视为卡死，报 loop_detected 而不是继续点。
 */
export async function runGuiTask(
  task: GuiTask,
  deps: GuiLoopDeps,
  options: GuiLoopOptions = {},
): Promise<TaskTrace> {
  const steps = task.steps.slice(0, Math.max(1, options.maxSteps ?? 3));
  const maxAttempts = Math.max(1, options.maxAttemptsPerStep ?? 3);
  const budget = Math.max(1, options.maxLocateCalls ?? Math.max(4, steps.length * 3));
  const waitMs = options.waitMs ?? 300;
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? sleep;

  const startedAt = now();
  const trace: TaskTrace = {
    taskId: task.id,
    title: task.title,
    status: 'done',
    steps: [],
    locateCalls: 0,
    startedAt,
    endedAt: startedAt,
  };

  const emit = (event: GuiLoopEvent) => {
    try {
      deps.onEvent?.(event);
    } catch {
      // 事件回调不能影响执行
    }
  };

  const finish = (reason?: AbortReason): TaskTrace => {
    trace.endedAt = now();
    if (reason) {
      trace.status = 'aborted';
      trace.reason = reason;
      emit({ type: 'abort', reason });
    } else {
      emit({ type: 'task_done', taskId: task.id });
    }
    return trace;
  };

  emit({ type: 'task_start', taskId: task.id });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepTrace: StepTrace = {
      stepId: step.id,
      instruction: step.instruction,
      status: 'skipped',
      attempts: [],
    };
    trace.steps.push(stepTrace);
    emit({ type: 'step_start', stepId: step.id, index });

    let done = false;
    let hadTarget = false;
    const signatures: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const delivery = DELIVERY_LADDER[Math.min(attempt, DELIVERY_LADDER.length - 1)];

      if (trace.locateCalls >= budget) {
        stepTrace.status = 'failed';
        return finish('budget');
      }

      const before = await deps.observe();
      emit({ type: 'observe', observation: before, phase: 'before' });

      if (trace.locateCalls >= budget) {
        stepTrace.status = 'failed';
        return finish('budget');
      }
      const target = await deps.locate(step, before, attempt);
      trace.locateCalls += 1;

      if (!target) {
        stepTrace.attempts.push({
          attempt,
          delivery,
          target: null,
          act: null,
          verify: null,
          outcome: 'retry',
        });
        continue;
      }

      hadTarget = true;
      emit({ type: 'target', target, attempt });

      const decision = deps.guard?.(step, target) ?? (step.risk === 'irreversible' ? 'confirm' : 'allow');
      if (decision === 'deny') {
        stepTrace.attempts.push({
          attempt,
          delivery,
          target,
          act: null,
          verify: null,
          outcome: 'aborted',
        });
        stepTrace.status = 'failed';
        return finish('guard_denied');
      }
      if (decision === 'confirm') {
        const approved = deps.confirm ? await deps.confirm(step, target) : false;
        if (!approved) {
          stepTrace.attempts.push({
            attempt,
            delivery,
            target,
            act: null,
            verify: null,
            outcome: 'aborted',
          });
          stepTrace.status = 'failed';
          return finish('guard_denied');
        }
      }

      signatures.push(`${step.action.type}|${stableKey(target.bbox)}`);
      await deps.preview?.(step, target, delivery);
      emit({ type: 'preview', target, delivery });

      const acted = await deps.act(step, target, delivery);
      emit({ type: 'act', target, delivery, outcome: acted });

      await wait(waitMs);
      const after = await deps.observe();
      emit({ type: 'observe', observation: after, phase: 'after' });

      const verified = await deps.verify(step, before, after, acted);
      emit({ type: 'verify', outcome: verified });

      const attemptTrace: AttemptTrace = {
        attempt,
        delivery,
        target,
        act: acted,
        verify: verified,
        outcome: verified.result === 'confirmed' ? 'confirmed' : 'retry',
      };
      stepTrace.attempts.push(attemptTrace);

      if (verified.result === 'confirmed') {
        done = true;
        break;
      }
    }

    if (!done) {
      stepTrace.status = 'failed';
      const allSame = signatures.length >= 2 && signatures.every((sig) => sig === signatures[0]);
      return finish(!hadTarget ? 'no_target' : allSame ? 'loop_detected' : 'step_failed');
    }

    stepTrace.status = 'done';
    emit({ type: 'step_done', stepId: step.id });
  }

  return finish();
}
