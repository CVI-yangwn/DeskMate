import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Watcher 的持久化：一个 JSON 文件，原子写入。
 * 不放进主 SQLite，是为了让 GUI 实验可以单独开关/清理。
 */
export interface WatcherRecord {
  id: string;
  condition: string;
  task: string;
  intervalMs: number;
  shadow: boolean;
  once: boolean;
  maxRuns: number;
  runs: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastEvidence?: string;
  lastAction?: string;
}

export interface WatcherInput {
  condition: string;
  task: string;
  intervalMs: number;
  shadow?: boolean;
  once?: boolean;
  maxRuns?: number;
}

interface FileShape {
  version: 1;
  watchers: WatcherRecord[];
}

function isRecord(value: unknown): value is WatcherRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.condition === 'string' && typeof item.task === 'string';
}

export class WatcherStore {
  private readonly file: string;
  private records: WatcherRecord[];

  constructor(file: string) {
    this.file = file;
    this.records = this.load();
  }

  private load(): WatcherRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      return Array.isArray(parsed.watchers) ? parsed.watchers.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, watchers: this.records } satisfies FileShape, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list(): WatcherRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  get(id: string): WatcherRecord | null {
    const found = this.records.find((record) => record.id === id);
    return found ? { ...found } : null;
  }

  add(input: WatcherInput): WatcherRecord {
    const record: WatcherRecord = {
      id: `w-${randomUUID().slice(0, 8)}`,
      condition: input.condition.trim().slice(0, 300),
      task: input.task.trim().slice(0, 500),
      intervalMs: Math.max(10_000, Math.min(86_400_000, input.intervalMs)),
      shadow: input.shadow !== false,
      once: input.once !== false,
      maxRuns: Math.max(1, Math.min(100, input.maxRuns ?? 1)),
      runs: 0,
      enabled: true,
      createdAt: Date.now(),
    };
    this.records.push(record);
    this.save();
    return { ...record };
  }

  update(id: string, patch: Partial<WatcherRecord>): WatcherRecord | null {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return null;
    this.records[index] = { ...this.records[index], ...patch, id };
    this.save();
    return { ...this.records[index] };
  }

  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.id !== id);
    if (this.records.length === before) return false;
    this.save();
    return true;
  }
}
