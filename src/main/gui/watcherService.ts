import { runWatcher } from './watcher.ts';
import type { WatcherRecord, WatcherStore } from './watcherStore.ts';

export interface WatcherTickEvent {
  record: WatcherRecord;
  status: string;
  evidence: string;
}

export interface WatcherServiceDeps {
  store: WatcherStore;
  check(condition: string): Promise<{ match: boolean; evidence: string }>;
  act(task: string): Promise<{ status: string; final: string }>;
  onEvent?(event: WatcherTickEvent): void;
}

/**
 * 把 WatcherStore 里的记录挂到定时器上。
 *
 * 每个 tick 只做一次条件判断；命中后：
 * - shadow：只记录，不动作；
 * - 非 shadow：调 runGuiReact 执行 task，然后按 once / maxRuns 决定是否停用。
 */
export class WatcherService {
  private readonly deps: WatcherServiceDeps;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();

  constructor(deps: WatcherServiceDeps) {
    this.deps = deps;
  }

  list(): WatcherRecord[] {
    return this.deps.store.list();
  }

  start(): void {
    for (const record of this.deps.store.list()) {
      if (record.enabled) this.schedule(record);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  add(input: Parameters<WatcherStore['add']>[0]): WatcherRecord {
    const record = this.deps.store.add(input);
    if (record.enabled) this.schedule(record);
    return record;
  }

  remove(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
    return this.deps.store.remove(id);
  }

  private schedule(record: WatcherRecord): void {
    const existing = this.timers.get(record.id);
    if (existing) clearInterval(existing);
    const every = Math.max(50, record.intervalMs);
    const timer = setInterval(() => {
      void this.tick(record.id);
    }, every);
    timer.unref?.();
    this.timers.set(record.id, timer);
  }

  private async tick(id: string): Promise<void> {
    if (this.running.has(id)) return;
    const record = this.deps.store.get(id);
    if (!record || !record.enabled) {
      const timer = this.timers.get(id);
      if (timer) clearInterval(timer);
      this.timers.delete(id);
      return;
    }

    this.running.add(id);
    try {
      const result = await runWatcher({
        check: () => this.deps.check(record.condition),
        act: () => this.deps.act(record.task),
        sleep: async () => {},
        maxChecks: 1,
        shadow: record.shadow,
      });

      const evidence = result.events.at(-1)?.evidence ?? '';
      const runs = record.runs + 1;
      const shouldDisable =
        result.status === 'acted' && (record.once || runs >= record.maxRuns);

      this.deps.store.update(id, {
        runs,
        lastRunAt: Date.now(),
        lastResult: result.status,
        lastEvidence: evidence,
        ...(result.action ? { lastAction: result.action.final } : {}),
        ...(shouldDisable ? { enabled: false } : {}),
      });

      if (shouldDisable) {
        const timer = this.timers.get(id);
        if (timer) clearInterval(timer);
        this.timers.delete(id);
      }

      this.deps.onEvent?.({ record: { ...record, runs }, status: result.status, evidence });
    } catch (error) {
      this.deps.store.update(id, {
        runs: record.runs + 1,
        lastRunAt: Date.now(),
        lastResult: 'error',
        lastEvidence: String(error).slice(0, 200),
      });
    } finally {
      this.running.delete(id);
    }
  }
}
