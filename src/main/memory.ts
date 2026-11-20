import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AgentSettings,
  AnchorKind,
  ChatMessage,
  Commitment,
  CommitmentStatus,
  CompanionDay,
  CompanionToday,
  DailyAnchor,
  DailyReport,
  DreamRun,
  Intention,
  IntentionOutcome,
  IntentionPrediction,
  MemoryExport,
  MemoryFact,
  MemoryHealth,
  MemoryKind,
  MemorySource,
  ProactiveClue,
  ProactiveDelivery,
  ProactiveOutcome,
  ProactiveRule,
  WikiPage,
} from '../shared/types';
import { eventKindLabel } from './proactiveRules.ts';
import { redactSensitive } from './redact.ts';
import {
  formatWikiContext,
  searchWikiPages,
  wikiNameKey,
  wikiPageFile,
  type WikiRef,
} from './wiki.ts';

const DEFAULT_SETTINGS: AgentSettings = {
  dnd: false,
  voiceEnabled: true,
  autoMemory: true,
  excludedApps: ['1Password', 'Keychain Access', 'Passwords', 'System Settings', 'System Preferences'],
  scanIntervalMs: 60_000,
  voiceName: 'Tingting',
  speechRate: 180,
  persona: '',
  quietHoursEnabled: false,
  quietStart: '23:30',
  quietEnd: '08:00',
  autoDream: true,
  dreamingAt: '23:30',
  proactiveLearning: true,
};

const MAX_FACTS = 100;
const MAX_MESSAGES = 1000;
const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_ACTIVITY_ROWS = 20_000;
const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SCHEMA_VERSION = 2;

/** 所有记忆表。clear/迁移/测试 fixture 只认这一份清单。 */
export const MEMORY_TABLES = [
  'facts',
  'messages',
  'settings',
  'anchors',
  'auto_anchor_events',
  'feedback_events',
  'feedback_mutes',
  'commitments',
  'companion_days',
  'activity_log',
  'activity_corrections',
  'intentions',
  'intention_predictions',
  'wiki_pages',
  'wiki_tombstones',
  'proactive_rules',
  'proactive_clues',
  'proactive_deliveries',
  'daily_reports',
  'dream_runs',
  'agent_memory',
] as const;

/** 用户点“清空记忆”时要清的表；settings 保留，否则连开关都会被重置。 */
export const CLEARABLE_TABLES = MEMORY_TABLES.filter((table) => table !== 'settings');
const FACT_COLUMNS =
  'id, text, kind, pinned, source, confidence, created_at, updated_at, last_used_at, use_count';
const FACT_COLUMNS_F = FACT_COLUMNS.split(',')
  .map((column) => `f.${column.trim()}`)
  .join(', ');
const SOURCE_PRIORITY: Record<MemorySource, number> = {
  explicit: 4,
  tool: 3,
  auto: 2,
  migration: 1,
};

const KIND_LABEL: Record<MemoryKind, string> = {
  project: '项目',
  preference: '偏好',
  fact: '事实',
};

function hashWikiName(name: string): string {
  return createHash('sha256').update(wikiNameKey(name)).digest('hex');
}

export interface ActivityObservationInput {
  at: number;
  app?: string;
  title?: string;
  activity: string;
  displayNames?: string[];
  confidence?: number;
  captureKind?: string;
  /** 整屏 OCR 原文：只用于当轮判断，不写入数据库 */
  ocrText?: string;
  /** 光标附近文本：只用于当轮判断，不写入数据库 */
  focusText?: string;
  /** 相比上一次扫描的变化摘要 */
  changeNote?: string;
  /** 这条记录对应的文件/页面 */
  entity?: string;
}

export interface ActivityCorrectionInput {
  startAt: number;
  endAt: number;
  wrongText?: string;
  correctedText: string;
  confidence?: number;
}

interface ObservationRow {
  at: number;
  app: string | null;
  title: string | null;
  activity: string;
  display_names: string | null;
  confidence: number | null;
  capture_kind: string | null;
}

interface CorrectionRow {
  id: string;
  created_at: number;
  start_at: number;
  end_at: number;
  wrong_text: string | null;
  corrected_text: string;
  confidence: number;
}

interface TimelineSegment {
  start: number;
  end: number;
  app: string;
  title: string;
  activity: string;
  corrected: boolean;
}

export interface IntentionInput {
  app?: string;
  title?: string;
  entity?: string;
  text: string;
  startAt: number;
  endAt: number;
  stepCount?: number;
  confidence?: number;
  source?: 'deepseek' | 'local';
}

export interface IntentionPredictionInput {
  text: string;
  app?: string;
  confidence?: number;
  decision: 'push' | 'discard';
  reason?: string;
}

interface IntentionRow {
  id: string;
  app: string | null;
  title: string | null;
  entity: string | null;
  text: string;
  start_at: number;
  end_at: number;
  step_count: number;
  confidence: number | null;
  source: string | null;
  created_at: number;
}

interface IntentionPredictionRow {
  id: string;
  text: string;
  app: string | null;
  confidence: number | null;
  decision: string | null;
  reason: string | null;
  created_at: number;
  outcome: string | null;
  outcome_at: number | null;
}

function formatHourMinute(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clampTime(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clampSettings(value: unknown): AgentSettings {
  const raw = (value ?? {}) as Partial<AgentSettings>;
  const pausedUntil = Number(raw.perceptionPausedUntil);
  const perceptionPausedUntil =
    Number.isFinite(pausedUntil) && pausedUntil > Date.now() ? pausedUntil : undefined;
  const position = raw.avatarPosition;
  const avatarPosition =
    position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: Math.round(position.x), y: Math.round(position.y) }
      : undefined;
  const excludedApps = Array.isArray(raw.excludedApps)
    ? [...new Set(raw.excludedApps.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 30)
    : DEFAULT_SETTINGS.excludedApps;

  return {
    dnd: Boolean(raw.dnd),
    voiceEnabled: raw.voiceEnabled !== false,
    autoMemory: raw.autoMemory !== false,
    excludedApps,
    ...(perceptionPausedUntil ? { perceptionPausedUntil } : {}),
    scanIntervalMs: Math.max(20_000, Number(raw.scanIntervalMs) || DEFAULT_SETTINGS.scanIntervalMs),
    ...(avatarPosition ? { avatarPosition } : {}),
    voiceName:
      typeof raw.voiceName === 'string' && raw.voiceName.trim()
        ? raw.voiceName.trim().slice(0, 60)
        : DEFAULT_SETTINGS.voiceName,
    speechRate: Math.min(260, Math.max(120, Math.round(Number(raw.speechRate) || DEFAULT_SETTINGS.speechRate))),
    persona: typeof raw.persona === 'string' ? raw.persona.slice(0, 2000) : '',
    quietHoursEnabled: Boolean(raw.quietHoursEnabled),
    quietStart: clampTime(raw.quietStart, DEFAULT_SETTINGS.quietStart),
    quietEnd: clampTime(raw.quietEnd, DEFAULT_SETTINGS.quietEnd),
    autoDream: raw.autoDream !== false,
    dreamingAt: clampTime(raw.dreamingAt, DEFAULT_SETTINGS.dreamingAt),
    proactiveLearning: raw.proactiveLearning !== false,
  };
}

function detectKind(text: string, kind?: MemoryKind): MemoryKind {
  if (kind) return kind;
  if (/(项目|代码库|仓库|repo|工程|产品名)/i.test(text)) return 'project';
  if (/(喜欢|偏好|习惯|不要|别用|简称|回答|语气|风格)/i.test(text)) return 'preference';
  return 'fact';
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function localDay(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]]/g, '');
}

function chars(text: string): Set<string> {
  const normalized = compact(text);
  const set = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    set.add(normalized.slice(index, index + 2));
  }
  return set;
}

function similarity(a: string, b: string): number {
  const left = compact(a);
  const right = compact(b);
  if (!left || !right) return 0;
  if (left === right || left.includes(right) || right.includes(left)) return 1;
  const aSet = chars(left);
  const bSet = chars(right);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const token of aSet) if (bSet.has(token)) overlap += 1;
  return (2 * overlap) / (aSet.size + bSet.size);
}

function conflicts(a: string, b: string): boolean {
  const negA = /[不没别无]/.test(a);
  const negB = /[不没别无]/.test(b);
  if (negA !== negB) return true;
  const numbersA = (a.match(/\d+/g) ?? []).join(',');
  const numbersB = (b.match(/\d+/g) ?? []).join(',');
  return numbersA !== numbersB;
}

interface FactRow {
  id: string;
  text: string;
  kind: string;
  pinned: number;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
}

interface AnchorRow {
  id: string;
  day: string;
  text: string;
  kind: string;
  source: string;
  confidence: number;
  created_at: number;
  hidden: number;
}

interface CommitmentRow {
  id: string;
  text: string;
  due_hint: string | null;
  status: string;
  created_at: number;
  last_asked_at: number | null;
}

interface CompanionDayRow {
  day: string;
  callback_at: number | null;
  recap_at: number | null;
  recap_text: string | null;
}

interface FeedbackMuteRow {
  event_type: string;
  muted_until: number;
  dismiss_count: number;
  updated_at: number;
}

interface MessageRow {
  role: string;
  text: string;
  created_at: number;
}

function toFact(row: FactRow): MemoryFact {
  const kind: MemoryKind =
    row.kind === 'project' || row.kind === 'preference' ? row.kind : 'fact';
  const source: MemorySource =
    row.source === 'tool' || row.source === 'auto' || row.source === 'migration'
      ? row.source
      : 'explicit';
  return {
    id: row.id,
    text: row.text,
    kind,
    pinned: Boolean(row.pinned),
    source,
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 1)),
    at: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Number(row.created_at) || Date.now(),
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    useCount: Number(row.use_count) || 0,
  };
}

function toIntention(row: IntentionRow): Intention {
  const source: 'deepseek' | 'local' = row.source === 'deepseek' ? 'deepseek' : 'local';
  return {
    id: row.id,
    app: row.app ?? '',
    title: row.title ?? '',
    ...(row.entity ? { entity: row.entity } : {}),
    text: row.text,
    startAt: Number(row.start_at) || 0,
    endAt: Number(row.end_at) || 0,
    stepCount: Number(row.step_count) || 0,
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 0.5)),
    source,
    at: Number(row.created_at) || Date.now(),
  };
}

function toIntentionPrediction(row: IntentionPredictionRow): IntentionPrediction {
  const outcome: IntentionOutcome | undefined =
    row.outcome === 'accepted' || row.outcome === 'rejected' ? row.outcome : undefined;
  return {
    id: row.id,
    text: row.text,
    app: row.app ?? '',
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 0)),
    decision: row.decision === 'push' ? 'push' : 'discard',
    reason: row.reason ?? '',
    at: Number(row.created_at) || Date.now(),
    ...(outcome ? { outcome } : {}),
    ...(row.outcome_at ? { outcomeAt: Number(row.outcome_at) } : {}),
  };
}

function toAnchor(row: AnchorRow): DailyAnchor {
  const kind: AnchorKind =
    row.kind === 'feeling' || row.kind === 'open_loop' || row.kind === 'moment'
      ? row.kind
      : 'work';
  const source: MemorySource =
    row.source === 'tool' || row.source === 'auto' || row.source === 'migration'
      ? row.source
      : 'explicit';
  return {
    id: row.id,
    day: row.day,
    text: row.text,
    kind,
    source,
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 0.8)),
    at: Number(row.created_at) || Date.now(),
  };
}

function toCommitment(row: CommitmentRow): Commitment {
  const status: CommitmentStatus = row.status === 'done' ? 'done' : 'open';
  return {
    id: row.id,
    text: row.text,
    dueHint: row.due_hint ?? undefined,
    status,
    at: Number(row.created_at) || Date.now(),
    lastAskedAt: row.last_asked_at ? Number(row.last_asked_at) : undefined,
  };
}

function toCompanionDay(row: CompanionDayRow | undefined, day: string): CompanionDay {
  return {
    day,
    callbackAt: row?.callback_at ? Number(row.callback_at) : undefined,
    recapAt: row?.recap_at ? Number(row.recap_at) : undefined,
    recapText: row?.recap_text ?? undefined,
  };
}

interface WikiRow {
  id: string;
  type: string;
  name: string;
  aliases: string;
  summary: string;
  items: string;
  sources: string;
  change_log: string;
  created_at: number;
  updated_at: number;
  last_dreamed_at: number | null;
}

interface RuleRow {
  id: string;
  kind: string;
  label: string;
  decision: string;
  window_start: string | null;
  window_end: string | null;
  reason: string;
  source: string;
  seen: number;
  active: number;
  created_at: number;
  updated_at: number;
}

interface ClueRow {
  id: string;
  kind: string;
  label: string;
  decision: string;
  seen: number;
  note: string;
  first_seen_at: number;
  last_seen_at: number;
}

interface DeliveryRow {
  id: string;
  event_type: string;
  text: string;
  outcome: string;
  suppressed: number;
  created_at: number;
}

interface DreamRunRow {
  id: string;
  day: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  pages: number;
  rules: number;
  message: string;
}

interface MessageRow {
  id: number;
  role: string;
  text: string;
  created_at: number;
}

interface ActivityRow {
  id: number;
  at: number;
  app: string | null;
  title: string | null;
  activity: string;
  entity: string | null;
  change_note: string | null;
}

export interface DreamEvidence {
  since: number;
  until: number;
  text: string;
  refs: Map<string, WikiRef>;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toWikiPage(row: WikiRow): WikiPage {
  return {
    id: row.id,
    type: row.type === 'project' || row.type === 'contact' ? row.type : 'topic',
    name: row.name,
    aliases: parseJson<string[]>(row.aliases, []),
    summary: row.summary,
    items: parseJson<WikiPage['items']>(row.items, []),
    sources: parseJson<WikiPage['sources']>(row.sources, []),
    changeLog: parseJson<WikiPage['changeLog']>(row.change_log, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.last_dreamed_at ? { lastDreamedAt: Number(row.last_dreamed_at) } : {}),
  };
}

function toRule(row: RuleRow): ProactiveRule {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    decision:
      row.decision === 'stay_silent' || row.decision === 'follow_up_later'
        ? row.decision
        : 'tell_now',
    ...(row.window_start && row.window_end
      ? { windowStart: row.window_start, windowEnd: row.window_end }
      : {}),
    reason: row.reason,
    source:
      row.source === 'dreaming' || row.source === 'feedback' ? row.source : 'explicit',
    seen: Number(row.seen),
    active: Number(row.active) !== 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toClue(row: ClueRow): ProactiveClue {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    decision:
      row.decision === 'stay_silent' || row.decision === 'follow_up_later'
        ? row.decision
        : 'tell_now',
    seen: Number(row.seen),
    note: row.note,
    firstSeenAt: Number(row.first_seen_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}

function toDelivery(row: DeliveryRow): ProactiveDelivery {
  const outcome: ProactiveOutcome =
    row.outcome === 'dismissed' ||
    row.outcome === 'opened' ||
    row.outcome === 'replied_positive' ||
    row.outcome === 'replied_negative'
      ? row.outcome
      : 'none';
  return {
    id: row.id,
    eventType: row.event_type,
    text: row.text,
    at: Number(row.created_at),
    outcome,
    suppressed: Number(row.suppressed) !== 0,
  };
}

function toDreamRun(row: DreamRunRow): DreamRun {
  return {
    id: row.id,
    day: row.day,
    startedAt: Number(row.started_at),
    ...(row.finished_at ? { finishedAt: Number(row.finished_at) } : {}),
    status:
      row.status === 'ok' || row.status === 'error' || row.status === 'skipped'
        ? row.status
        : 'running',
    pages: Number(row.pages),
    rules: Number(row.rules),
    message: row.message,
  };
}

export class MemoryStore {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly jsonPath: string;
  private readonly userDataDir: string;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.userDataDir = userDataDir;
    this.jsonPath = path.join(userDataDir, 'memory.json');
    this.dbPath = path.join(userDataDir, 'memory.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 3000');
    // 删除后尽量不把旧页留在 freelist 里，配合 VACUUM 降低 strings 捡漏。
    this.db.exec('PRAGMA secure_delete = ON');
    this.backupBeforeMigration();
    this.migrateSchema();
    this.migrateLegacyJson();
    this.secureFiles();
  }

  /** 旧库升级前留一份原始备份；升级会清掉历史 OCR/光标正文，必须可回退。 */
  private backupBeforeMigration(): void {
    try {
      const hasFacts = this.db
        .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'facts' LIMIT 1")
        .get() as { hit?: number } | undefined;
      if (!hasFacts?.hit) return;
      const versionRow = this.db.prepare('PRAGMA user_version').get() as
        | { user_version?: number }
        | undefined;
      const version = Number(versionRow?.user_version ?? 0);
      if (version >= SCHEMA_VERSION) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = `${this.dbPath}.bak-v${version}-${stamp}`;
      for (const suffix of ['', '-wal', '-shm']) {
        const source = `${this.dbPath}${suffix}`;
        if (fs.existsSync(source)) fs.copyFileSync(source, `${backup}${suffix}`);
      }
      console.info(`[memory] 升级前已备份到 ${backup}`);
    } catch (error) {
      console.warn('升级前备份失败，继续迁移', error);
    }
  }

  private secureFiles(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.chmodSync(`${this.dbPath}${suffix}`, 0o600);
      } catch {
        // file may not exist yet
      }
    }
  }

  private migrateSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'fact',
        pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'explicit',
        confidence REAL NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS anchors (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        text TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'work',
        source TEXT NOT NULL DEFAULT 'auto',
        confidence REAL NOT NULL DEFAULT 0.8,
        created_at INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS anchors_day ON anchors(day, created_at);
      CREATE TABLE IF NOT EXISTS auto_anchor_events (
        day TEXT NOT NULL,
        event_key TEXT NOT NULL,
        anchor_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (day, event_key)
      );
      CREATE TABLE IF NOT EXISTS feedback_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback_mutes (
        event_type TEXT PRIMARY KEY,
        muted_until INTEGER NOT NULL DEFAULT 0,
        dismiss_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commitments (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        due_hint TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        last_asked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS commitments_status ON commitments(status, created_at);
      CREATE TABLE IF NOT EXISTS companion_days (
        day TEXT PRIMARY KEY,
        callback_at INTEGER,
        recap_at INTEGER,
        recap_text TEXT
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        app TEXT,
        title TEXT,
        activity TEXT NOT NULL,
        display_names TEXT,
        confidence REAL,
        capture_kind TEXT,
        ocr_text TEXT,
        focus_text TEXT,
        change_note TEXT,
        entity TEXT
      );
      CREATE INDEX IF NOT EXISTS activity_log_at ON activity_log(at);
      CREATE TABLE IF NOT EXISTS activity_corrections (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        wrong_text TEXT,
        corrected_text TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS activity_corrections_range ON activity_corrections(start_at, end_at);
      CREATE TABLE IF NOT EXISTS intentions (
        id TEXT PRIMARY KEY,
        app TEXT,
        title TEXT,
        entity TEXT,
        text TEXT NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        step_count INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5,
        source TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS intentions_created ON intentions(created_at DESC);
      CREATE TABLE IF NOT EXISTS intention_predictions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        app TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        decision TEXT NOT NULL DEFAULT 'discard',
        reason TEXT,
        created_at INTEGER NOT NULL,
        outcome TEXT,
        outcome_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS intention_predictions_created ON intention_predictions(created_at DESC);

      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        aliases TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        items TEXT NOT NULL DEFAULT '[]',
        sources TEXT NOT NULL DEFAULT '[]',
        change_log TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_dreamed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS wiki_pages_updated ON wiki_pages(updated_at DESC);

      CREATE TABLE IF NOT EXISTS wiki_tombstones (
        name_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        deleted_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proactive_rules (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        decision TEXT NOT NULL,
        window_start TEXT,
        window_end TEXT,
        reason TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'explicit',
        seen INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proactive_rules_active ON proactive_rules(active, updated_at DESC);

      CREATE TABLE IF NOT EXISTS proactive_clues (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        decision TEXT NOT NULL,
        seen INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proactive_deliveries (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        text TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'none',
        suppressed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        outcome_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS proactive_deliveries_created ON proactive_deliveries(created_at DESC);

      CREATE TABLE IF NOT EXISTS daily_reports (
        day TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dream_runs (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        pages INTEGER NOT NULL DEFAULT 0,
        rules INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS dream_runs_started ON dream_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        text,
        content='facts',
        content_rowid='rowid',
        tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE OF text ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO facts_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);

    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(facts)').all() as unknown as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    const additions: Array<[string, string]> = [
      ['source', "TEXT NOT NULL DEFAULT 'explicit'"],
      ['confidence', 'REAL NOT NULL DEFAULT 1'],
      ['last_used_at', 'INTEGER'],
      ['use_count', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE facts ADD COLUMN ${name} ${definition}`);
      }
    }

    const observationColumns = new Set(
      (this.db.prepare('PRAGMA table_info(activity_log)').all() as unknown as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    const intentionColumns = new Set(
      (this.db.prepare('PRAGMA table_info(intentions)').all() as unknown as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    if (!intentionColumns.has('entity')) {
      this.db.exec('ALTER TABLE intentions ADD COLUMN entity TEXT');
    }

    for (const [name, definition] of [
      ['ocr_text', 'TEXT'],
      ['focus_text', 'TEXT'],
      ['change_note', 'TEXT'],
      ['entity', 'TEXT'],
    ] as Array<[string, string]>) {
      if (!observationColumns.has(name)) {
        this.db.exec(`ALTER TABLE activity_log ADD COLUMN ${name} ${definition}`);
      }
    }

    const anchorColumns = new Set(
      (this.db.prepare('PRAGMA table_info(anchors)').all() as unknown as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    if (!anchorColumns.has('hidden')) {
      this.db.exec('ALTER TABLE anchors ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
    }

    const versionRow = this.db.prepare('PRAGMA user_version').get() as
      | { user_version?: number }
      | undefined;
    const version = Number(versionRow?.user_version ?? 0);
    if (version < 2) {
      // 旧版本把整屏 OCR 和光标全文落过盘；升级时一次性清掉历史正文。
      this.db.exec(
        'UPDATE activity_log SET ocr_text = NULL, focus_text = NULL WHERE ocr_text IS NOT NULL OR focus_text IS NOT NULL',
      );
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (error) {
        console.warn('升级后 WAL checkpoint 失败', error);
      }
    }
    if (version < SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    this.migrateTombstoneHashes();
  }

  /** 早期 tombstone 存的是明文页面名；新格式只存 SHA-256，避免客户名长期残留。 */
  private migrateTombstoneHashes(): void {
    try {
      const rows = this.db
        .prepare('SELECT name_key, name, deleted_at FROM wiki_tombstones')
        .all() as unknown as Array<{ name_key: string; name: string; deleted_at: number }>;
      if (rows.length === 0) return;
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO wiki_tombstones (name_key, name, deleted_at) VALUES (?, ?, ?)',
      );
      const remove = this.db.prepare('DELETE FROM wiki_tombstones WHERE name_key = ?');
      this.db.exec('BEGIN');
      try {
        for (const row of rows) {
          // 已经是 hash 格式且没有明文 name，说明迁移过了；不要二次哈希。
          if (!row.name && /^[0-9a-f]{64}$/.test(row.name_key)) continue;
          const source = (row.name || row.name_key || '').trim();
          if (!source) continue;
          const hash = hashWikiName(source);
          if (hash === row.name_key && !row.name) continue;
          insert.run(hash, '', Number(row.deleted_at) || Date.now());
          if (hash !== row.name_key) remove.run(row.name_key);
          else if (row.name) this.db.prepare('UPDATE wiki_tombstones SET name = ? WHERE name_key = ?').run('', hash);
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.warn('tombstone 脱敏迁移失败', error);
    }
  }

  private migrateLegacyJson(): void {
    if (!fs.existsSync(this.jsonPath)) return;

    try {
      const raw = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8')) as {
        facts?: Array<{ text?: unknown; at?: unknown }>;
        messages?: Array<{ role?: unknown; text?: unknown; at?: unknown }>;
        settings?: unknown;
      };
      const factCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS count FROM facts').get() as { count: number }).count,
      );
      const messageCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }).count,
      );

      if (factCount === 0 && messageCount === 0) {
        const insertFact = this.db.prepare(
          `INSERT INTO facts
             (id, text, kind, pinned, source, confidence, created_at, updated_at, use_count)
           VALUES (?, ?, ?, 0, 'migration', 1, ?, ?, 0)`,
        );
        const insertMessage = this.db.prepare(
          'INSERT INTO messages (role, text, created_at) VALUES (?, ?, ?)',
        );

        this.db.exec('BEGIN');
        try {
          for (const fact of raw.facts ?? []) {
            const text = typeof fact.text === 'string' ? normalize(fact.text) : '';
            if (!text) continue;
            const at = Number(fact.at) || Date.now();
            insertFact.run(randomUUID(), text, detectKind(text), at, at);
          }
          for (const message of raw.messages ?? []) {
            if (
              (message.role === 'user' || message.role === 'assistant') &&
              typeof message.text === 'string'
            ) {
              insertMessage.run(
                message.role,
                message.text.slice(0, 2000),
                Number(message.at) || Date.now(),
              );
            }
          }
          this.db
            .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
            .run('agent', JSON.stringify(clampSettings(raw.settings)));
          this.db.exec('COMMIT');
          this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      }

      const migrated = `${this.jsonPath}.migrated`;
      if (!fs.existsSync(migrated)) fs.renameSync(this.jsonPath, migrated);
    } catch (error) {
      console.warn('旧 JSON 记忆迁移失败，保留原文件', error);
    }
  }

  getSettings(): AgentSettings {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('agent') as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_SETTINGS };
    try {
      return clampSettings(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  updateSettings(patch: Partial<AgentSettings>): AgentSettings {
    const next = clampSettings({ ...this.getSettings(), ...patch });
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('agent', JSON.stringify(next));
    return next;
  }

  getFacts(limit = 100): MemoryFact[] {
    const rows = this.db
      .prepare(
        `SELECT ${FACT_COLUMNS}
         FROM facts
         ORDER BY pinned DESC, use_count DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as FactRow[];
    return rows.map(toFact);
  }

  getFactCount(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM facts').get() as { count: number }).count,
    );
  }

  remember(
    text: string,
    kind?: MemoryKind,
    options: { source?: MemorySource; confidence?: number } = {},
  ): MemoryFact | null {
    const clean = normalize(text);
    if (!clean) return null;

    const source = options.source ?? 'explicit';
    const confidence = Math.min(1, Math.max(0, options.confidence ?? 1));
    const existing = this.db
      .prepare(
        `SELECT ${FACT_COLUMNS}
         FROM facts WHERE lower(text) = lower(?) LIMIT 1`,
      )
      .get(clean) as unknown as FactRow | undefined;
    if (existing) {
      const nextSource =
        SOURCE_PRIORITY[source] >= SOURCE_PRIORITY[toFact(existing).source]
          ? source
          : toFact(existing).source;
      this.db
        .prepare(
          'UPDATE facts SET updated_at = ?, source = ?, confidence = MAX(confidence, ?) WHERE id = ?',
        )
        .run(Date.now(), nextSource, confidence, existing.id);
      return this.getFact(existing.id);
    }

    const similar = this.getFacts(MAX_FACTS)
      .map((fact) => ({ fact, score: similarity(clean, fact.text) }))
      .filter((item) => item.score >= 0.78 && !conflicts(clean, item.fact.text))
      .sort((a, b) => b.score - a.score)[0];

    if (similar) {
      const best = similar.fact;
      const nextText = clean.length > best.text.length ? clean : best.text;
      const nextKind = kind && SOURCE_PRIORITY[source] >= 3 ? kind : best.kind;
      const nextSource =
        SOURCE_PRIORITY[source] >= SOURCE_PRIORITY[best.source] ? source : best.source;
      this.db
        .prepare(
          `UPDATE facts
           SET text = ?, kind = ?, source = ?, confidence = MAX(confidence, ?), updated_at = ?
           WHERE id = ?`,
        )
        .run(nextText, nextKind, nextSource, confidence, Date.now(), best.id);
      return this.getFact(best.id);
    }

    const now = Date.now();
    const fact: MemoryFact = {
      id: randomUUID(),
      text: clean,
      kind: detectKind(clean, kind),
      pinned: false,
      source,
      confidence,
      at: now,
      updatedAt: now,
      useCount: 0,
    };
    this.db
      .prepare(
        `INSERT INTO facts
           (id, text, kind, pinned, source, confidence, created_at, updated_at, use_count)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)`,
      )
      .run(fact.id, fact.text, fact.kind, fact.source, fact.confidence, fact.at, fact.updatedAt);
    this.trimFacts();
    return fact;
  }

  addFact(text: string, kind?: MemoryKind): MemoryFact | null {
    return this.remember(text, kind, { source: 'explicit', confidence: 1 });
  }

  addAutoFact(text: string, kind?: MemoryKind, confidence = 0.8): MemoryFact | null {
    return this.remember(text, kind, { source: 'auto', confidence });
  }

  updateFact(id: string, text: string, kind: MemoryKind): MemoryFact | null {
    const clean = normalize(text);
    if (!clean) return null;
    this.db
      .prepare(
        'UPDATE facts SET text = ?, kind = ?, source = ?, confidence = 1, updated_at = ? WHERE id = ?',
      )
      .run(clean, kind, 'explicit', Date.now(), id);
    return this.getFact(id);
  }

  markUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const statement = this.db.prepare(
      'UPDATE facts SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?',
    );
    for (const id of ids) statement.run(now, id);
  }

  private getFact(id: string): MemoryFact | null {
    const row = this.db
      .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ? LIMIT 1`)
      .get(id) as unknown as FactRow | undefined;
    return row ? toFact(row) : null;
  }

  pinFact(id: string, pinned: boolean): boolean {
    const result = this.db
      .prepare('UPDATE facts SET pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, Date.now(), id);
    return result.changes > 0;
  }

  forgetFact(id: string): boolean {
    const result = this.db.prepare('DELETE FROM facts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  search(query: string, limit = 8): MemoryFact[] {
    const clean = query.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean) return this.getFacts(limit);

    let rows: FactRow[] = [];
    if (clean.length >= 3) {
      try {
        const ftsQuery = `"${clean.replace(/"/g, '""')}"`;
        rows = this.db
          .prepare(
            `SELECT ${FACT_COLUMNS_F}
             FROM facts_fts
             JOIN facts f ON f.rowid = facts_fts.rowid
             WHERE facts_fts MATCH ?
             ORDER BY rank
             LIMIT ?`,
          )
          .all(ftsQuery, Math.max(1, limit)) as unknown as FactRow[];
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const like = `%${clean.replace(/[%_]/g, '')}%`;
      rows = this.db
        .prepare(
          `SELECT ${FACT_COLUMNS}
           FROM facts
           WHERE text LIKE ? COLLATE NOCASE
           ORDER BY pinned DESC, use_count DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(like, Math.max(1, limit)) as unknown as FactRow[];
    }

    return rows.map(toFact);
  }

  getContext(query = '', limit = 12): string {
    const chosen = new Map<string, MemoryFact>();
    const usedIds = new Set<string>();
    if (query.trim()) {
      for (const fact of this.search(query, Math.ceil(limit * 0.6))) {
        chosen.set(fact.id, fact);
        usedIds.add(fact.id);
      }
      for (const fact of this.getFacts(4)) {
        if (chosen.size >= limit) break;
        chosen.set(fact.id, fact);
      }
    } else {
      for (const fact of this.getFacts(Math.min(limit, 8))) {
        chosen.set(fact.id, fact);
      }
    }

    const selected = [...chosen.values()].slice(0, limit);
    this.markUsed([...usedIds]);
    return selected
      .map((fact) => `- [${KIND_LABEL[fact.kind]}] ${fact.text}`)
      .join('\n')
      .slice(0, 3000);
  }

  appendMessage(role: ChatMessage['role'], text: string): void {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!clean) return;
    this.db
      .prepare('INSERT INTO messages (role, text, created_at) VALUES (?, ?, ?)')
      .run(role, clean, Date.now());
    this.db
      .prepare('DELETE FROM messages WHERE created_at < ?')
      .run(Date.now() - MAX_MESSAGE_AGE_MS);
    this.db.exec(`
      DELETE FROM messages
      WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ${MAX_MESSAGES})
    `);
  }

  getMessages(limit = 60): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT role, text, created_at FROM (
           SELECT id, role, text, created_at FROM messages ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(Math.max(1, limit)) as unknown as MessageRow[];
    return rows.map((row) => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      text: row.text,
      at: Number(row.created_at) || Date.now(),
    }));
  }

  addAnchor(
    text: string,
    kind: AnchorKind = 'work',
    options: {
      source?: MemorySource;
      confidence?: number;
      day?: string;
      at?: number;
    } = {},
  ): DailyAnchor | null {
    const clean = normalize(text).slice(0, 120);
    if (!clean) return null;

    const at = options.at ?? Date.now();
    const day = options.day ?? localDay(new Date(at));
    const existing = this.db
      .prepare(
        `SELECT id, day, text, kind, source, confidence, created_at, hidden
         FROM anchors WHERE day = ? AND lower(text) = lower(?) LIMIT 1`,
      )
      .get(day, clean) as unknown as AnchorRow | undefined;
    if (existing) {
      if (!existing.hidden) return toAnchor(existing);
      // 用户删掉的锚点，自动来源不再重复生成；手动添加可以把它恢复。
      if (options.source !== 'explicit') return null;
      this.db
        .prepare(
          `UPDATE anchors
           SET hidden = 0, source = 'explicit', confidence = 1, created_at = ?
           WHERE id = ?`,
        )
        .run(at, existing.id);
      return this.getAnchor(existing.id);
    }

    const anchor: DailyAnchor = {
      id: randomUUID(),
      day,
      text: clean,
      kind,
      source: options.source ?? 'auto',
      confidence: Math.min(1, Math.max(0, options.confidence ?? 0.8)),
      at,
    };
    this.db
      .prepare(
        `INSERT INTO anchors (id, day, text, kind, source, confidence, created_at, hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        anchor.id,
        anchor.day,
        anchor.text,
        anchor.kind,
        anchor.source,
        anchor.confidence,
        anchor.at,
      );

    // 一天最多留 8 个锚点，避免又变成流水账。
    this.db
      .prepare(
        `DELETE FROM anchors
         WHERE day = ? AND id NOT IN (
           SELECT id FROM anchors WHERE day = ? ORDER BY created_at DESC LIMIT 8
         )`,
      )
      .run(day, day);
    return anchor;
  }

  getAnchors(day?: string, limit = 20): DailyAnchor[] {
    // 自动锚点 30 天后自动淡出；手动/工具来源长期保留。
    const cutoff = Date.now() - 30 * 24 * 60 * 60_000;
    const rows = day
      ? (this.db
          .prepare(
            `SELECT id, day, text, kind, source, confidence, created_at, hidden
             FROM anchors
             WHERE hidden = 0 AND day = ? AND (source != 'auto' OR created_at >= ?)
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(day, cutoff, Math.max(1, limit)) as unknown as AnchorRow[])
      : (this.db
          .prepare(
            `SELECT id, day, text, kind, source, confidence, created_at, hidden
             FROM anchors
             WHERE hidden = 0 AND (source != 'auto' OR created_at >= ?)
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(cutoff, Math.max(1, limit)) as unknown as AnchorRow[]);
    return rows.map(toAnchor);
  }

  private getAnchor(id: string): DailyAnchor | null {
    const row = this.db
      .prepare(
        `SELECT id, day, text, kind, source, confidence, created_at, hidden
         FROM anchors WHERE id = ? LIMIT 1`,
      )
      .get(id) as unknown as AnchorRow | undefined;
    return row ? toAnchor(row) : null;
  }

  updateAnchor(id: string, text: string, kind: AnchorKind): DailyAnchor | null {
    const clean = normalize(text).slice(0, 120);
    if (!clean) return null;
    this.db
      .prepare(
        `UPDATE anchors
         SET text = ?, kind = ?, source = 'explicit', confidence = 1, hidden = 0, created_at = ?
         WHERE id = ?`,
      )
      .run(clean, kind, Date.now(), id);
    return this.getAnchor(id);
  }

  deleteAnchor(id: string): boolean {
    return this.db.prepare('UPDATE anchors SET hidden = 1 WHERE id = ?').run(id).changes > 0;
  }

  countAutoAnchors(day = localDay()): number {
    return Number(
      (
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM anchors WHERE day = ? AND source = 'auto' AND hidden = 0",
          )
          .get(day) as { count: number }
      ).count,
    );
  }

  hasAutoAnchorEvent(day: string, eventKey: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS found FROM auto_anchor_events WHERE day = ? AND event_key = ? LIMIT 1')
      .get(day, eventKey) as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  markAutoAnchorEvent(day: string, eventKey: string, anchorId: string): void {
    this.db
      .prepare(
        `INSERT INTO auto_anchor_events (day, event_key, anchor_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(day, event_key) DO UPDATE SET
           anchor_id = excluded.anchor_id,
           created_at = excluded.created_at`,
      )
      .run(day, eventKey, anchorId, Date.now());
  }

  addCommitment(text: string, dueHint?: string): Commitment | null {
    const clean = normalize(text).slice(0, 120);
    if (!clean) return null;

    const existing = this.db
      .prepare(
        `SELECT id, text, due_hint, status, created_at, last_asked_at
         FROM commitments WHERE status = 'open' AND lower(text) = lower(?) LIMIT 1`,
      )
      .get(clean) as unknown as CommitmentRow | undefined;
    if (existing) return toCommitment(existing);

    const commitment: Commitment = {
      id: randomUUID(),
      text: clean,
      dueHint: dueHint?.trim().slice(0, 40) || undefined,
      status: 'open',
      at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO commitments (id, text, due_hint, status, created_at)
         VALUES (?, ?, ?, 'open', ?)`,
      )
      .run(commitment.id, commitment.text, commitment.dueHint ?? null, commitment.at);
    return commitment;
  }

  getCommitments(status: CommitmentStatus | 'all' = 'open', limit = 50): Commitment[] {
    const rows =
      status === 'all'
        ? (this.db
            .prepare(
              `SELECT id, text, due_hint, status, created_at, last_asked_at
               FROM commitments
               ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
               LIMIT ?`,
            )
            .all(Math.max(1, limit)) as unknown as CommitmentRow[])
        : (this.db
            .prepare(
              `SELECT id, text, due_hint, status, created_at, last_asked_at
               FROM commitments WHERE status = ?
               ORDER BY created_at DESC LIMIT ?`,
            )
            .all(status, Math.max(1, limit)) as unknown as CommitmentRow[]);
    return rows.map(toCommitment);
  }

  completeCommitment(id: string, done = true): boolean {
    return (
      this.db
        .prepare('UPDATE commitments SET status = ? WHERE id = ?')
        .run(done ? 'done' : 'open', id).changes > 0
    );
  }

  deleteCommitment(id: string): boolean {
    return this.db.prepare('DELETE FROM commitments WHERE id = ?').run(id).changes > 0;
  }

  getCompanionDay(day = localDay()): CompanionDay {
    const row = this.db
      .prepare('SELECT day, callback_at, recap_at, recap_text FROM companion_days WHERE day = ?')
      .get(day) as unknown as CompanionDayRow | undefined;
    return toCompanionDay(row, day);
  }

  markCallback(day = localDay(), at = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO companion_days (day, callback_at) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET callback_at = excluded.callback_at`,
      )
      .run(day, at);
  }

  markRecap(day = localDay(), text = '', at = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO companion_days (day, recap_at, recap_text) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           recap_at = excluded.recap_at,
           recap_text = excluded.recap_text`,
      )
      .run(day, at, text.slice(0, 200));
  }

  recordBubbleFeedback(eventType: string, action: 'dismiss' | 'open'): void {
    const clean = eventType.trim().slice(0, 60) || 'unknown';
    const now = Date.now();
    this.db
      .prepare('INSERT INTO feedback_events (event_type, action, created_at) VALUES (?, ?, ?)')
      .run(clean, action, now);

    if (action === 'open') {
      // 用户点开说明有兴趣：清掉同类抑制。
      this.db
        .prepare(
          `INSERT INTO feedback_mutes (event_type, muted_until, dismiss_count, updated_at)
           VALUES (?, 0, 0, ?)
           ON CONFLICT(event_type) DO UPDATE SET
             muted_until = 0,
             dismiss_count = 0,
             updated_at = excluded.updated_at`,
        )
        .run(clean, now);
      return;
    }

    const row = this.db
      .prepare(
        'SELECT event_type, muted_until, dismiss_count, updated_at FROM feedback_mutes WHERE event_type = ?',
      )
      .get(clean) as unknown as FeedbackMuteRow | undefined;
    const count = (row?.dismiss_count ?? 0) + 1;
    const mutedUntil = count >= 2 ? now + 7 * 24 * 60 * 60_000 : 0;
    this.db
      .prepare(
        `INSERT INTO feedback_mutes (event_type, muted_until, dismiss_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_type) DO UPDATE SET
           muted_until = excluded.muted_until,
           dismiss_count = excluded.dismiss_count,
           updated_at = excluded.updated_at`,
      )
      .run(clean, mutedUntil, count, now);
  }

  clearEventMute(eventType: string): void {
    const clean = eventType.trim().slice(0, 60);
    if (clean === 'any') {
      this.db.exec('UPDATE feedback_mutes SET muted_until = 0, dismiss_count = 0');
      return;
    }
    this.db
      .prepare(
        `INSERT INTO feedback_mutes (event_type, muted_until, dismiss_count, updated_at)
         VALUES (?, 0, 0, ?)
         ON CONFLICT(event_type) DO UPDATE SET
           muted_until = 0,
           dismiss_count = 0,
           updated_at = excluded.updated_at`,
      )
      .run(clean, Date.now());
  }

  isEventMuted(eventType: string): boolean {
    const row = this.db
      .prepare('SELECT muted_until FROM feedback_mutes WHERE event_type = ? LIMIT 1')
      .get(eventType.trim().slice(0, 60)) as { muted_until?: number } | undefined;
    return Boolean(row?.muted_until && Number(row.muted_until) > Date.now());
  }

  getCompanionDays(limit = 365): CompanionDay[] {
    const rows = this.db
      .prepare(
        `SELECT day, callback_at, recap_at, recap_text
         FROM companion_days ORDER BY day DESC LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as CompanionDayRow[];
    return rows.map((row) => toCompanionDay(row, row.day));
  }

  // ---------------------------------------------------------------- wiki
  listWikiPages(limit = 100): WikiPage[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, name, aliases, summary, items, sources, change_log,
                created_at, updated_at, last_dreamed_at
         FROM wiki_pages
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as WikiRow[];
    return rows.map(toWikiPage);
  }

  getWikiPage(id: string): WikiPage | null {
    const row = this.db
      .prepare(
        `SELECT id, type, name, aliases, summary, items, sources, change_log,
                created_at, updated_at, last_dreamed_at
         FROM wiki_pages WHERE id = ? LIMIT 1`,
      )
      .get(id) as unknown as WikiRow | undefined;
    return row ? toWikiPage(row) : null;
  }

  getWikiPageByName(name: string): WikiPage | null {
    const key = wikiNameKey(name);
    if (!key) return null;
    const row = this.db
      .prepare(
        `SELECT id, type, name, aliases, summary, items, sources, change_log,
                created_at, updated_at, last_dreamed_at
         FROM wiki_pages WHERE name_key = ? LIMIT 1`,
      )
      .get(key) as unknown as WikiRow | undefined;
    if (row) return toWikiPage(row);
    return (
      this.listWikiPages(500).find((page) =>
        page.aliases.some((alias) => wikiNameKey(alias) === key),
      ) ?? null
    );
  }

  saveWikiPage(page: WikiPage): WikiPage {
    // 显式写回一页时清掉同名 tombstone，允许用户将来手动恢复。
    for (const name of [page.name, ...page.aliases]) {
      this.clearWikiTombstone(name);
    }
    this.db
      .prepare(
        `INSERT INTO wiki_pages
           (id, type, name, name_key, aliases, summary, items, sources, change_log,
            created_at, updated_at, last_dreamed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           name = excluded.name,
           name_key = excluded.name_key,
           aliases = excluded.aliases,
           summary = excluded.summary,
           items = excluded.items,
           sources = excluded.sources,
           change_log = excluded.change_log,
           updated_at = excluded.updated_at,
           last_dreamed_at = excluded.last_dreamed_at`,
      )
      .run(
        page.id,
        page.type,
        page.name,
        wikiNameKey(page.name),
        JSON.stringify(page.aliases),
        page.summary,
        JSON.stringify(page.items),
        JSON.stringify(page.sources),
        JSON.stringify(page.changeLog),
        page.createdAt,
        page.updatedAt,
        page.lastDreamedAt ?? null,
      );
    return this.getWikiPage(page.id) ?? page;
  }

  deleteWikiPage(id: string): boolean {
    const page = this.getWikiPage(id);
    if (page) {
      const now = Date.now();
      const insert = this.db.prepare(
        `INSERT INTO wiki_tombstones (name_key, name, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(name_key) DO UPDATE SET deleted_at = excluded.deleted_at`,
      );
      for (const name of [page.name, ...page.aliases]) {
        const key = hashWikiName(name);
        if (key) insert.run(key, '', now);
      }
      try {
        fs.rmSync(wikiPageFile(this.userDataDir, page), { force: true });
      } catch (error) {
        console.warn('删除 wiki 文件失败', error);
      }
    }
    const result = this.db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(id);
    return result.changes > 0;
  }

  isWikiNameTombstoned(name: string): boolean {
    const key = hashWikiName(name);
    if (!key) return false;
    const row = this.db
      .prepare('SELECT name_key FROM wiki_tombstones WHERE name_key = ? LIMIT 1')
      .get(key) as { name_key?: string } | undefined;
    return Boolean(row?.name_key);
  }

  clearWikiTombstone(name: string): void {
    const key = hashWikiName(name);
    if (key) this.db.prepare('DELETE FROM wiki_tombstones WHERE name_key = ?').run(key);
  }

  getWikiCount(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM wiki_pages').get() as { count: number })
        .count,
    );
  }

  searchWiki(query: string, limit = 6): WikiPage[] {
    return searchWikiPages(this.listWikiPages(500), query, limit);
  }

  getWikiContext(query = '', limit = 4): string {
    const clean = query.trim();
    // 只有空查询（例如健康检查/摘要）才用最近页面兜底；
    // 有查询但没命中时不要硬塞 4 页无关内容，避免挤掉规则和技能。
    if (clean) return formatWikiContext(this.searchWiki(clean, limit), limit);
    return formatWikiContext(this.listWikiPages(limit), limit);
  }

  // ------------------------------------------------------- proactive rules
  getRules(includeInactive = true): ProactiveRule[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, label, decision, window_start, window_end, reason, source,
                seen, active, created_at, updated_at
         FROM proactive_rules
         ${includeInactive ? '' : 'WHERE active = 1'}
         ORDER BY active DESC, updated_at DESC`,
      )
      .all() as unknown as RuleRow[];
    return rows.map(toRule);
  }

  getRule(id: string): ProactiveRule | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, label, decision, window_start, window_end, reason, source,
                seen, active, created_at, updated_at
         FROM proactive_rules WHERE id = ? LIMIT 1`,
      )
      .get(id) as unknown as RuleRow | undefined;
    return row ? toRule(row) : null;
  }

  saveRule(rule: ProactiveRule): ProactiveRule {
    this.db
      .prepare(
        `INSERT INTO proactive_rules
           (id, kind, label, decision, window_start, window_end, reason, source,
            seen, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           decision = excluded.decision,
           window_start = excluded.window_start,
           window_end = excluded.window_end,
           reason = excluded.reason,
           source = excluded.source,
           seen = proactive_rules.seen + 1,
           active = 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        rule.id,
        rule.kind,
        rule.label,
        rule.decision,
        rule.windowStart ?? null,
        rule.windowEnd ?? null,
        rule.reason,
        rule.source,
        rule.seen,
        rule.active ? 1 : 0,
        rule.createdAt,
        rule.updatedAt,
      );
    return this.getRule(rule.id) ?? rule;
  }

  setRuleActive(id: string, active: boolean): boolean {
    const result = this.db
      .prepare('UPDATE proactive_rules SET active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, Date.now(), id);
    return result.changes > 0;
  }

  deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM proactive_rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  replaceDreamingRules(rules: ProactiveRule[]): number {
    const protectedIds = new Set(
      this.getRules()
        .filter((rule) => rule.source !== 'dreaming')
        .map((rule) => rule.id),
    );
    let saved = 0;
    this.db.exec('BEGIN');
    try {
      this.db.prepare("DELETE FROM proactive_rules WHERE source = 'dreaming'").run();
      for (const rule of rules) {
        if (protectedIds.has(rule.id)) continue;
        this.saveRule({ ...rule, source: 'dreaming' });
        saved += 1;
      }
      this.db.exec('COMMIT');
      return saved;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getClues(): ProactiveClue[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, label, decision, seen, note, first_seen_at, last_seen_at
         FROM proactive_clues ORDER BY last_seen_at DESC`,
      )
      .all() as unknown as ClueRow[];
    return rows.map(toClue);
  }

  replaceClues(clues: ProactiveClue[]): void {
    const insert = this.db.prepare(
      `INSERT INTO proactive_clues
         (id, kind, label, decision, seen, note, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM proactive_clues');
      for (const clue of clues) {
        insert.run(
          clue.id,
          clue.kind,
          clue.label,
          clue.decision,
          clue.seen,
          clue.note,
          clue.firstSeenAt,
          clue.lastSeenAt,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recordProactiveDelivery(input: {
    eventType: string;
    text: string;
    suppressed?: boolean;
    at?: number;
  }): ProactiveDelivery {
    const delivery: ProactiveDelivery = {
      id: randomUUID(),
      eventType: input.eventType.trim().slice(0, 60) || 'unknown',
      text: input.text.replace(/\s+/g, ' ').trim().slice(0, 500),
      at: input.at ?? Date.now(),
      outcome: 'none',
      suppressed: Boolean(input.suppressed),
    };
    this.db
      .prepare(
        `INSERT INTO proactive_deliveries
           (id, event_type, text, outcome, suppressed, created_at)
         VALUES (?, ?, ?, 'none', ?, ?)`,
      )
      .run(
        delivery.id,
        delivery.eventType,
        delivery.text,
        delivery.suppressed ? 1 : 0,
        delivery.at,
      );
    // 账本留 90 天，足够夜间复盘和规则学习。
    this.db
      .prepare('DELETE FROM proactive_deliveries WHERE created_at < ?')
      .run(delivery.at - 90 * 24 * 60 * 60_000);
    return delivery;
  }

  getRecentProactiveDelivery(withinMs = 30 * 60_000): ProactiveDelivery | null {
    const row = this.db
      .prepare(
        `SELECT id, event_type, text, outcome, suppressed, created_at
         FROM proactive_deliveries
         WHERE suppressed = 0 AND outcome IN ('none', 'opened') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(Date.now() - withinMs) as unknown as DeliveryRow | undefined;
    return row ? toDelivery(row) : null;
  }

  markDeliveryOutcome(outcome: Exclude<ProactiveOutcome, 'none'>): ProactiveDelivery | null {
    const row = this.db
      .prepare(
        `SELECT id, event_type, text, outcome, suppressed, created_at
         FROM proactive_deliveries
         WHERE suppressed = 0 AND outcome IN ('none', 'opened') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(Date.now() - 30 * 60_000) as unknown as DeliveryRow | undefined;
    if (!row) return null;
    this.db
      .prepare('UPDATE proactive_deliveries SET outcome = ?, outcome_at = ? WHERE id = ?')
      .run(outcome, Date.now(), row.id);
    return { ...toDelivery(row), outcome };
  }

  getDeliveriesSince(since: number, limit = 40): ProactiveDelivery[] {
    const rows = this.db
      .prepare(
        `SELECT id, event_type, text, outcome, suppressed, created_at
         FROM proactive_deliveries
         WHERE created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(since, Math.max(1, limit)) as unknown as DeliveryRow[];
    return rows.map(toDelivery);
  }

  getDismissCountSince(eventType: string, since: number): number {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM feedback_events
             WHERE event_type = ? AND action = 'dismiss' AND created_at >= ?`,
          )
          .get(eventType.trim().slice(0, 60), since) as { count: number }
      ).count,
    );
  }

  // -------------------------------------------------------------- reports
  saveDailyReport(day: string, text: string): DailyReport {
    const clean = text.replace(/\s+\n/g, '\n').trim().slice(0, 4000);
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO daily_reports (day, text, created_at) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
      )
      .run(day, clean, createdAt);
    return { day, text: clean, createdAt };
  }

  getDailyReport(day = localDay()): DailyReport | null {
    const row = this.db
      .prepare('SELECT day, text, created_at FROM daily_reports WHERE day = ? LIMIT 1')
      .get(day) as { day: string; text: string; created_at: number } | undefined;
    return row ? { day: row.day, text: row.text, createdAt: Number(row.created_at) } : null;
  }

  getDailyReports(limit = 14): DailyReport[] {
    const rows = this.db
      .prepare('SELECT day, text, created_at FROM daily_reports ORDER BY day DESC LIMIT ?')
      .all(Math.max(1, limit)) as unknown as Array<{
      day: string;
      text: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      day: row.day,
      text: row.text,
      createdAt: Number(row.created_at),
    }));
  }

  startDreamRun(day = localDay()): DreamRun {
    const run: DreamRun = {
      id: randomUUID(),
      day,
      startedAt: Date.now(),
      status: 'running',
      pages: 0,
      rules: 0,
      message: '',
    };
    this.db
      .prepare(
        `INSERT INTO dream_runs (id, day, started_at, status, pages, rules, message)
         VALUES (?, ?, ?, 'running', 0, 0, '')`,
      )
      .run(run.id, run.day, run.startedAt);
    this.db
      .prepare('DELETE FROM dream_runs WHERE started_at < ?')
      .run(run.startedAt - 180 * 24 * 60 * 60_000);
    return run;
  }

  finishDreamRun(
    id: string,
    patch: { status: DreamRun['status']; pages?: number; rules?: number; message?: string },
  ): DreamRun | null {
    this.db
      .prepare(
        `UPDATE dream_runs
         SET finished_at = ?, status = ?, pages = ?, rules = ?, message = ?
         WHERE id = ?`,
      )
      .run(
        Date.now(),
        patch.status,
        patch.pages ?? 0,
        patch.rules ?? 0,
        (patch.message ?? '').slice(0, 500),
        id,
      );
    const row = this.db
      .prepare(
        `SELECT id, day, started_at, finished_at, status, pages, rules, message
         FROM dream_runs WHERE id = ? LIMIT 1`,
      )
      .get(id) as unknown as DreamRunRow | undefined;
    return row ? toDreamRun(row) : null;
  }

  getLastDreamRun(): DreamRun | null {
    const row = this.db
      .prepare(
        `SELECT id, day, started_at, finished_at, status, pages, rules, message
         FROM dream_runs ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as unknown as DreamRunRow | undefined;
    return row ? toDreamRun(row) : null;
  }

  getAgentMemory(): string {
    const row = this.db
      .prepare('SELECT text FROM agent_memory WHERE id = 1 LIMIT 1')
      .get() as { text?: string } | undefined;
    return row?.text ?? '';
  }

  setAgentMemory(text: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_memory (id, text, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      )
      .run(text.slice(0, 8000), Date.now());
  }

  private refExists(ref: string): boolean {
    const separator = ref.indexOf(':');
    if (separator <= 0) return false;
    const kind = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    const table =
      kind === 'msg'
        ? 'messages'
        : kind === 'activity'
          ? 'activity_log'
          : kind === 'anchor'
            ? 'anchors'
            : kind === 'intent'
              ? 'intentions'
              : kind === 'commit'
                ? 'commitments'
                : kind === 'delivery'
                  ? 'proactive_deliveries'
                  : kind === 'correction'
                    ? 'activity_corrections'
                    : '';
    if (!table || !id) return false;
    const row = this.db
      .prepare(`SELECT 1 AS hit FROM ${table} WHERE id = ? LIMIT 1`)
      .get(id) as { hit?: number } | undefined;
    return Boolean(row?.hit);
  }

  getMemoryHealth(now = Date.now()): Omit<MemoryHealth, 'injectionChars'> & { injectionChars: number } {
    const pages = this.listWikiPages(500);
    let prunedSources = 0;
    for (const page of pages) {
      for (const source of page.sources) {
        if (!this.refExists(source.ref)) prunedSources += 1;
      }
    }
    const staleCutoff = now - 90 * 24 * 60 * 60_000;
    let stalePages = 0;
    let duplicateOpenItems = 0;
    for (const page of pages) {
      const open = page.items.filter((item) => item.status === 'open');
      if (open.length > 0 && page.updatedAt < staleCutoff) stalePages += 1;
      const seen = new Set<string>();
      for (const item of open) {
        const key = item.text.toLowerCase().replace(/\s+/g, '');
        if (seen.has(key)) duplicateOpenItems += 1;
        seen.add(key);
      }
    }
    const messages = Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }).count,
    );
    const activityRows = Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM activity_log').get() as { count: number }).count,
    );
    const oldest = this.db
      .prepare('SELECT MIN(at) AS at FROM activity_log')
      .get() as { at?: number | null } | undefined;

    return {
      pages: pages.length,
      unsourcedPages: pages.filter((page) => page.sources.length === 0).length,
      prunedSources,
      stalePages,
      duplicateOpenItems,
      messages,
      activityRows,
      ...(oldest?.at ? { oldestActivityAt: Number(oldest.at) } : {}),
      injectionChars: 0,
      checkedAt: now,
    };
  }

  getMessageRowsSince(since: number, limit = 120): MessageRow[] {
    // 取最近的 N 条，再按时间正序返回：夜间整理和反馈复盘都更关心最近说了什么。
    return this.db
      .prepare(
        `SELECT id, role, text, created_at FROM (
           SELECT id, role, text, created_at FROM messages
           WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?
         ) ORDER BY created_at ASC`,
      )
      .all(since, Math.max(1, limit)) as unknown as MessageRow[];
  }

  /**
   * 夜间整理只拿“浓缩后的证据”：对话、锚点、活动、意图、主动消息反馈。
   * 每条证据带 ref，模型写页面时必须引用这些 ref，避免编造来源。
   */
  getDreamEvidence(since: number, until = Date.now()): DreamEvidence {
    const refs = new Map<string, WikiRef>();
    const sections: string[] = [];
    const excerpt = (text: string): string => redactSensitive(normalize(text)).slice(0, 300);
    const clock = (at: number): string =>
      new Date(at).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

    const messages = this.getMessageRowsSince(since, 300).filter((row) => row.created_at <= until);
    if (messages.length) {
      const lines = messages.map((row) => {
        const ref = `msg:${row.id}`;
        refs.set(ref, {
          label: `${clock(row.created_at)} ${row.role === 'user' ? '用户' : '同桌'}：${row.text.slice(0, 60)}`,
          excerpt: excerpt(row.text),
          at: row.created_at,
        });
        return `- [${ref}] ${clock(row.created_at)} ${row.role === 'user' ? '用户' : '同桌'}：${row.text.slice(0, 220)}`;
      });
      sections.push(`## 对话\n${lines.join('\n')}`);
    }

    const anchors = this.db
      .prepare(
        `SELECT id, text, kind, created_at FROM anchors
         WHERE created_at >= ? AND hidden = 0 ORDER BY created_at ASC LIMIT 20`,
      )
      .all(since) as unknown as Array<{
      id: string;
      text: string;
      kind: string;
      created_at: number;
    }>;
    if (anchors.length) {
      const lines = anchors.map((row) => {
        const ref = `anchor:${row.id}`;
        refs.set(ref, {
          label: `锚点：${row.text.slice(0, 60)}`,
          excerpt: excerpt(row.text),
          at: Number(row.created_at),
        });
        return `- [${ref}] ${row.kind}：${row.text}`;
      });
      sections.push(`## 今天的锚点\n${lines.join('\n')}`);
    }

    const commitments = this.db
      .prepare(
        `SELECT id, text, status, created_at FROM commitments
         WHERE created_at >= ? ORDER BY created_at ASC LIMIT 20`,
      )
      .all(since) as unknown as Array<{
      id: string;
      text: string;
      status: string;
      created_at: number;
    }>;
    if (commitments.length) {
      const lines = commitments.map((row) => {
        const ref = `commit:${row.id}`;
        refs.set(ref, {
          label: `承诺：${row.text.slice(0, 60)}`,
          excerpt: excerpt(row.text),
          at: Number(row.created_at),
        });
        return `- [${ref}] ${row.status === 'done' ? '已完成' : '未完成'}：${row.text}`;
      });
      sections.push(`## 答应过的事\n${lines.join('\n')}`);
    }

    const intentions = this.db
      .prepare(
        `SELECT id, text, app, start_at, end_at FROM (
           SELECT id, text, app, start_at, end_at FROM intentions
           WHERE end_at >= ? ORDER BY end_at DESC LIMIT 30
         ) ORDER BY end_at ASC`,
      )
      .all(since) as unknown as Array<{
      id: string;
      text: string;
      app: string | null;
      start_at: number;
      end_at: number;
    }>;
    if (intentions.length) {
      const lines = intentions.map((row) => {
        const ref = `intent:${row.id}`;
        refs.set(ref, {
          label: `意图：${row.text.slice(0, 60)}`,
          excerpt: excerpt(row.text),
          at: Number(row.end_at),
        });
        return `- [${ref}] ${clock(Number(row.start_at))}–${clock(Number(row.end_at))} [${
          row.app || '未知应用'
        }] ${row.text}`;
      });
      sections.push(`## 意图（比原始活动高一层）\n${lines.join('\n')}`);
    }

    const activityRows = this.db
      .prepare(
        `SELECT id, at, app, title, activity, entity, change_note FROM activity_log
         WHERE at >= ? ORDER BY at ASC LIMIT 20000`,
      )
      .all(since) as unknown as ActivityRow[];
    if (activityRows.length) {
      // 一天可能有上千条扫描；先压成“同应用同活动”的连续段，再均匀抽样，避免只看到早上。
      const segments: Array<{
        id: number;
        start: number;
        end: number;
        app: string;
        activity: string;
        entity: string;
        change: string;
      }> = [];
      for (const row of activityRows) {
        const at = Number(row.at);
        const app = row.app || '未知';
        const activity = row.activity;
        const entity = row.entity ?? '';
        const last = segments[segments.length - 1];
        if (
          last &&
          last.app === app &&
          last.activity === activity &&
          last.entity === entity &&
          at - last.end <= 30 * 60_000
        ) {
          last.end = at;
          if (row.change_note) last.change = row.change_note;
          continue;
        }
        segments.push({
          id: Number(row.id),
          start: at,
          end: at,
          app,
          activity,
          entity,
          change: row.change_note ?? '',
        });
      }

      const maxSegments = 40;
      const step = Math.max(1, Math.ceil(segments.length / maxSegments));
      const sampled = segments.length > maxSegments ? segments.filter((_, index) => index % step === 0) : segments;
      const lines = sampled.slice(0, maxSegments).map((segment) => {
        const ref = `activity:${segment.id}`;
        refs.set(ref, {
          label: `活动：${segment.activity.slice(0, 60)}`,
          excerpt: excerpt(`${segment.activity}${segment.change ? `（${segment.change}）` : ''}`),
          at: segment.start,
        });
        const range = segment.start === segment.end ? clock(segment.start) : `${clock(segment.start)}–${clock(segment.end)}`;
        const change = segment.change ? `（${segment.change}）` : '';
        const entity = segment.entity ? ` @${segment.entity}` : '';
        return `- [${ref}] ${range} [${segment.app}] ${segment.activity}${entity}${change}`;
      });
      sections.push(`## 屏幕活动\n${lines.join('\n')}`);
    }

    const corrections = this.db
      .prepare(
        `SELECT id, corrected_text, start_at, end_at FROM activity_corrections
         WHERE end_at >= ? ORDER BY end_at ASC LIMIT 10`,
      )
      .all(since) as unknown as Array<{
      id: string;
      corrected_text: string;
      start_at: number;
      end_at: number;
    }>;
    if (corrections.length) {
      const lines = corrections.map((row) => {
        const ref = `correction:${row.id}`;
        refs.set(ref, {
          label: `纠正：${row.corrected_text.slice(0, 60)}`,
          excerpt: excerpt(row.corrected_text),
          at: Number(row.end_at),
        });
        return `- [${ref}] 用户纠正：${row.corrected_text}`;
      });
      sections.push(`## 用户纠正过的事实\n${lines.join('\n')}`);
    }

    const deliveries = this.getDeliveriesSince(since, 30).filter((item) => item.at <= until);
    if (deliveries.length) {
      const lines = deliveries.map((row) => {
        const ref = `delivery:${row.id}`;
        refs.set(ref, {
          label: `${eventKindLabel(row.eventType)}：${row.text.slice(0, 60)}`,
          excerpt: excerpt(row.text),
          at: row.at,
        });
        return `- [${ref}] ${clock(row.at)} ${row.eventType}（${row.outcome}${
          row.suppressed ? '，已压住' : ''
        }）：${row.text}`;
      });
      sections.push(`## 主动消息与用户反应\n${lines.join('\n')}`);
    }

    for (const [key, value] of refs) {
      refs.set(key, {
        ...value,
        label: redactSensitive(value.label),
        ...(value.excerpt ? { excerpt: redactSensitive(value.excerpt) } : {}),
      });
    }

    return {
      since,
      until,
      text: redactSensitive(sections.join('\n\n')).slice(0, 18_000),
      refs,
    };
  }

  exportData(): MemoryExport {
    return {
      exportedAt: Date.now(),
      facts: this.getFacts(1000),
      anchors: this.getAnchors(undefined, 1000),
      commitments: this.getCommitments('all', 1000),
      companionDays: this.getCompanionDays(1000),
      wikiPages: this.listWikiPages(500),
      rules: this.getRules(),
    };
  }

  getCompanionToday(now = new Date()): CompanionToday {
    const day = localDay(now);
    const record = this.getCompanionDay(day);
    return {
      day,
      anchors: this.getAnchors(day, 20),
      // 未完成的承诺一直保留；已完成的只显示最近三天，避免“今天”里堆旧账。
      commitments: this.getCommitments('all', 20).filter(
        (item) => item.status === 'open' || now.getTime() - item.at <= 3 * 24 * 60 * 60_000,
      ),
      callbackAt: record.callbackAt,
      recapAt: record.recapAt,
      recapText: record.recapText,
    };
  }

  appendObservation(input: ActivityObservationInput): void {
    const activity = normalize(input.activity);
    if (!activity) return;
    const at = Number(input.at) || Date.now();
    this.db
      .prepare(
        `INSERT INTO activity_log
           (at, app, title, activity, display_names, confidence, capture_kind,
            ocr_text, focus_text, change_note, entity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        normalize(input.app ?? '').slice(0, 160) || null,
        normalize(input.title ?? '').slice(0, 240) || null,
        activity,
        JSON.stringify((input.displayNames ?? []).slice(0, 4)),
        Math.min(1, Math.max(0, Number(input.confidence) || 0)),
        input.captureKind ?? null,
        // OCR / 光标全文只在当轮扫描和模型判断里用；不落盘，
        // 避免屏幕上的代码、客户信息长期留在 SQLite/WAL/备份里。
        null,
        null,
        normalize(input.changeNote ?? '').slice(0, 300) || null,
        normalize(input.entity ?? '').slice(0, 120) || null,
      );

    this.db
      .prepare('DELETE FROM activity_log WHERE at < ?')
      .run(Date.now() - ACTIVITY_RETENTION_MS);
    this.db.exec(`
      DELETE FROM activity_log
      WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ${MAX_ACTIVITY_ROWS})
    `);
  }

  addIntention(input: IntentionInput): Intention | null {
    const text = normalize(input.text).slice(0, 120);
    if (!text) return null;
    const startAt = Number(input.startAt) || Date.now();
    const endAt = Math.max(startAt, Number(input.endAt) || startAt);
    const intention: Intention = {
      id: randomUUID(),
      app: normalize(input.app ?? '').slice(0, 160),
      title: normalize(input.title ?? '').slice(0, 240),
      ...(normalize(input.entity ?? '') ? { entity: normalize(input.entity ?? '').slice(0, 120) } : {}),
      text,
      startAt,
      endAt,
      stepCount: Math.max(0, Math.round(Number(input.stepCount) || 0)),
      confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0.5)),
      source: input.source === 'deepseek' ? 'deepseek' : 'local',
      at: Date.now(),
    };

    this.db
      .prepare(
        `INSERT INTO intentions
           (id, app, title, entity, text, start_at, end_at, step_count, confidence, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        intention.id,
        intention.app || null,
        intention.title || null,
        intention.entity ?? null,
        intention.text,
        intention.startAt,
        intention.endAt,
        intention.stepCount,
        intention.confidence,
        intention.source,
        intention.at,
      );

    this.db.exec(`
      DELETE FROM intentions
      WHERE id NOT IN (SELECT id FROM intentions ORDER BY created_at DESC LIMIT 500)
    `);
    return intention;
  }

  getRecentIntentions(limit = 5): Intention[] {
    const rows = this.db
      .prepare(
        `SELECT id, app, title, entity, text, start_at, end_at, step_count, confidence, source, created_at
         FROM intentions ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as IntentionRow[];
    return rows.map(toIntention);
  }

  getIntentionsSince(since: number, limit = 200): Intention[] {
    const rows = this.db
      .prepare(
        `SELECT id, app, title, entity, text, start_at, end_at, step_count, confidence, source, created_at
         FROM intentions WHERE start_at >= ? ORDER BY start_at DESC, rowid DESC LIMIT ?`,
      )
      .all(Math.round(since), Math.max(1, limit)) as unknown as IntentionRow[];
    return rows.map(toIntention);
  }

  /** 当前正在进行的意图：最后一段还没结束太久，就当它还在。 */
  getCurrentIntention(withinMs = 30 * 60_000): Intention | null {
    const [latest] = this.getRecentIntentions(1);
    if (!latest) return null;
    return Date.now() - latest.endAt <= withinMs ? latest : null;
  }

  countIntentionsSince(since: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM intentions WHERE start_at >= ?')
      .get(Math.round(since)) as unknown as { count: number } | undefined;
    return Number(row?.count) || 0;
  }

  addIntentionPrediction(input: IntentionPredictionInput): IntentionPrediction {
    const prediction: IntentionPrediction = {
      id: randomUUID(),
      text: normalize(input.text).slice(0, 120),
      app: normalize(input.app ?? '').slice(0, 160),
      confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0)),
      decision: input.decision === 'push' ? 'push' : 'discard',
      reason: normalize(input.reason ?? '').slice(0, 120),
      at: Date.now(),
    };

    this.db
      .prepare(
        `INSERT INTO intention_predictions
           (id, text, app, confidence, decision, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        prediction.id,
        prediction.text,
        prediction.app || null,
        prediction.confidence,
        prediction.decision,
        prediction.reason,
        prediction.at,
      );

    this.db.exec(`
      DELETE FROM intention_predictions
      WHERE id NOT IN (SELECT id FROM intention_predictions ORDER BY created_at DESC LIMIT 200)
    `);
    return prediction;
  }

  getLatestPrediction(): IntentionPrediction | null {
    const row = this.db
      .prepare(
        `SELECT id, text, app, confidence, decision, reason, created_at, outcome, outcome_at
         FROM intention_predictions ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get() as unknown as IntentionPredictionRow | undefined;
    return row ? toIntentionPrediction(row) : null;
  }

  setIntentionOutcome(id: string, outcome: IntentionOutcome): void {
    this.db
      .prepare('UPDATE intention_predictions SET outcome = ?, outcome_at = ? WHERE id = ?')
      .run(outcome, Date.now(), id);
  }

  /** 最近被否掉的猜测，用来避免“换个说法再猜一遍”。 */
  getRejectedPredictions(since: number, limit = 10): string[] {
    const rows = this.db
      .prepare(
        `SELECT text FROM intention_predictions
         WHERE outcome = 'rejected' AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Math.round(since), Math.max(1, limit)) as unknown as Array<{ text: string }>;
    return rows.map((row) => row.text);
  }

  addCorrection(input: ActivityCorrectionInput): string | null {
    const corrected = normalize(input.correctedText);
    if (!corrected) return null;
    const startAt = Number(input.startAt);
    const endAt = Number(input.endAt);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return null;

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO activity_corrections
           (id, created_at, start_at, end_at, wrong_text, corrected_text, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        Date.now(),
        Math.round(startAt),
        Math.round(endAt),
        normalize(input.wrongText ?? '').slice(0, 240) || null,
        corrected,
        Math.min(1, Math.max(0, Number(input.confidence) || 1)),
      );

    this.db.exec(`
      DELETE FROM activity_corrections
      WHERE id NOT IN (
        SELECT id FROM activity_corrections ORDER BY created_at DESC LIMIT 500
      )
    `);
    return id;
  }

  private getCorrectionsSince(since: number): CorrectionRow[] {
    return this.db
      .prepare(
        `SELECT id, created_at, start_at, end_at, wrong_text, corrected_text, confidence
         FROM activity_corrections
         WHERE end_at >= ?
         ORDER BY start_at ASC`,
      )
      .all(since) as unknown as CorrectionRow[];
  }

  getActivityContext(minutes = 120, limit = 30, daysAgo = 0): string {
    const windowMinutes = Math.min(24 * 60, Math.max(5, Math.round(minutes)));
    const offsetDays = Math.min(14, Math.max(0, Math.round(daysAgo)));
    const until = Date.now() - offsetDays * 24 * 60 * 60_000;
    const since = until - windowMinutes * 60_000;
    const corrections = this.getCorrectionsSince(since).filter(
      (correction) => correction.start_at <= until,
    );
    const rows = this.db
      .prepare(
        `SELECT at, app, title, activity, display_names, confidence, capture_kind
         FROM activity_log
         WHERE at >= ? AND at <= ?
         ORDER BY at ASC
         LIMIT 1000`,
      )
      .all(since, until) as unknown as ObservationRow[];

    const segments: TimelineSegment[] = [];
    for (const row of rows) {
      const matching = corrections
        .filter(
          (correction) => correction.start_at <= row.at && correction.end_at >= row.at,
        )
        .sort((a, b) => b.created_at - a.created_at)[0];
      const activity = matching?.corrected_text ?? row.activity;
      const app = row.app ?? '';
      const title = row.title ?? '';
      const last = segments[segments.length - 1];
      if (
        last &&
        last.activity === activity &&
        last.app === app &&
        last.title === title &&
        row.at - last.end <= 5 * 60_000
      ) {
        last.end = row.at;
      } else {
        segments.push({
          start: row.at,
          end: row.at,
          app,
          title,
          activity,
          corrected: Boolean(matching),
        });
      }
    }

    for (const correction of corrections) {
      const covered = rows.some(
        (row) => row.at >= correction.start_at && row.at <= correction.end_at,
      );
      if (covered) continue;
      segments.push({
        start: correction.start_at,
        end: correction.end_at,
        app: '',
        title: '',
        activity: correction.corrected_text,
        corrected: true,
      });
    }

    segments.sort((a, b) => a.start - b.start);
    const visible = segments.slice(-Math.max(1, limit));
    const lines = visible.map((segment) => {
      const end = Math.max(segment.end, segment.start + 60_000);
      const label = [segment.app, segment.title].filter(Boolean).join(' / ').slice(0, 60);
      return `- ${formatHourMinute(segment.start)}-${formatHourMinute(end)} ${
        label ? `${label}：` : ''
      }${segment.activity.slice(0, 100)}${segment.corrected ? '（用户纠正）' : ''}`;
    });
    if (segments.length > visible.length) lines.unshift('…（更早的记录已省略）');
    return redactSensitive(lines.join('\n')).slice(0, 2400);
  }

  getRecentCorrectionContext(limit = 5): string {
    const rows = this.db
      .prepare(
        `SELECT id, created_at, start_at, end_at, wrong_text, corrected_text, confidence
         FROM activity_corrections
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as CorrectionRow[];
    return rows
      .reverse()
      .map((row) => {
        const wrong = row.wrong_text
          ? `（不是「${row.wrong_text.replace(/\s+/g, ' ').slice(0, 60)}」）`
          : '';
        return `- ${formatHourMinute(row.start_at)}-${formatHourMinute(row.end_at)} 用户纠正：${row.corrected_text}${wrong}`;
      })
      .join('\n')
      .slice(0, 1600);
  }

  getCorrectionCount(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM activity_corrections').get() as { count: number })
        .count,
    );
  }

  clear(): void {
    // 表清单来自 MEMORY_TABLES，避免新增表后“清空记忆”漏删。
    this.db.exec('BEGIN');
    try {
      this.db.exec(CLEARABLE_TABLES.map((table) => `DELETE FROM ${table};`).join(' '));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const folder of ['wiki', 'agent-memory']) {
      try {
        fs.rmSync(path.join(this.userDataDir, folder), { recursive: true, force: true });
      } catch (error) {
        console.warn('清空知识文件失败', folder, error);
      }
    }
    // 旧版迁移留下的 memory.json / memory.json.migrated 也可能含事实。
    for (const legacy of [this.jsonPath, `${this.jsonPath}.migrated`]) {
      try {
        fs.rmSync(legacy, { force: true });
      } catch (error) {
        console.warn('清空旧记忆文件失败', legacy, error);
      }
    }
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
    } catch (error) {
      console.warn('VACUUM 失败', error);
    }
    this.secureFiles();
  }

  private trimFacts(): void {
    const count = Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM facts').get() as { count: number }).count,
    );
    const overflow = count - MAX_FACTS;
    if (overflow <= 0) return;
    // 先删自动/迁移事实，再删工具事实，最后才动用户明确要求“记住”的 explicit。
    this.db
      .prepare(
        `DELETE FROM facts WHERE id IN (
           SELECT id FROM facts
           ORDER BY pinned ASC,
                    CASE source WHEN 'explicit' THEN 2 WHEN 'tool' THEN 1 ELSE 0 END ASC,
                    use_count ASC,
                    updated_at ASC
           LIMIT ?
         )`,
      )
      .run(overflow);
  }
}
