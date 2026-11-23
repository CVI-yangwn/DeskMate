/**
 * “看着，条件满足就做”的循环。
 *
 * 和 ReAct 分开：watcher 只负责“什么时候触发”，真正操作仍交给 runGuiReact。
 * 默认先跑影子模式（只记录、不动作），确认判断可靠后再转正。
 */

export interface WatcherEvent {
  check: number;
  match: boolean;
  evidence: string;
}

export interface WatcherDeps {
  check(): Promise<{ match: boolean; evidence: string }>;
  act(): Promise<{ status: string; final: string }>;
  sleep(ms: number): Promise<void>;
  intervalMs?: number;
  maxChecks?: number;
  shadow?: boolean;
  onEvent?(event: WatcherEvent): void;
}

export interface WatcherResult {
  status: 'no_match' | 'matched_shadow' | 'acted';
  checks: number;
  events: WatcherEvent[];
  action?: { status: string; final: string };
}

export async function runWatcher(deps: WatcherDeps): Promise<WatcherResult> {
  const maxChecks = Math.max(1, Math.min(60, deps.maxChecks ?? 5));
  const intervalMs = Math.max(250, Math.min(60_000, deps.intervalMs ?? 2_000));
  const events: WatcherEvent[] = [];

  for (let check = 1; check <= maxChecks; check += 1) {
    const verdict = await deps.check();
    const event: WatcherEvent = {
      check,
      match: Boolean(verdict.match),
      evidence: String(verdict.evidence ?? '').slice(0, 200),
    };
    events.push(event);
    deps.onEvent?.(event);

    if (event.match) {
      if (deps.shadow) {
        return { status: 'matched_shadow', checks: check, events };
      }
      const action = await deps.act();
      return { status: 'acted', checks: check, events, action };
    }

    if (check < maxChecks) await deps.sleep(intervalMs);
  }

  return { status: 'no_match', checks: maxChecks, events };
}
