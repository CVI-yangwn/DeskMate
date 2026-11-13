import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  MemoryExport,
  MemoryFact,
  MemoryKind,
  MemorySource,
} from '../shared/types';

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
};

const MAX_FACTS = 100;
const MAX_MESSAGES = 200;
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

export interface ActivityObservationInput {
  at: number;
  app?: string;
  title?: string;
  activity: string;
  displayNames?: string[];
  confidence?: number;
  captureKind?: string;
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

function localDay(date = new Date()): string {
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

export class MemoryStore {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly jsonPath: string;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.jsonPath = path.join(userDataDir, 'memory.json');
    this.dbPath = path.join(userDataDir, 'memory.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 3000');
    this.migrateSchema();
    this.migrateLegacyJson();
    this.secureFiles();
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
        capture_kind TEXT
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

    const anchorColumns = new Set(
      (this.db.prepare('PRAGMA table_info(anchors)').all() as unknown as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    if (!anchorColumns.has('hidden')) {
      this.db.exec('ALTER TABLE anchors ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
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

  exportData(): MemoryExport {
    return {
      exportedAt: Date.now(),
      facts: this.getFacts(1000),
      anchors: this.getAnchors(undefined, 1000),
      commitments: this.getCommitments('all', 1000),
      companionDays: this.getCompanionDays(1000),
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
           (at, app, title, activity, display_names, confidence, capture_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        normalize(input.app ?? '').slice(0, 160) || null,
        normalize(input.title ?? '').slice(0, 240) || null,
        activity,
        JSON.stringify((input.displayNames ?? []).slice(0, 4)),
        Math.min(1, Math.max(0, Number(input.confidence) || 0)),
        input.captureKind ?? null,
      );

    const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
    this.db.prepare('DELETE FROM activity_log WHERE at < ?').run(cutoff);
    this.db.exec(`
      DELETE FROM activity_log
      WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 2000)
    `);
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

  getActivityContext(minutes = 120, limit = 30): string {
    const windowMinutes = Math.min(24 * 60, Math.max(5, Math.round(minutes)));
    const since = Date.now() - windowMinutes * 60_000;
    const corrections = this.getCorrectionsSince(since);
    const rows = this.db
      .prepare(
        `SELECT at, app, title, activity, display_names, confidence, capture_kind
         FROM activity_log
         WHERE at >= ?
         ORDER BY at ASC
         LIMIT 1000`,
      )
      .all(since) as unknown as ObservationRow[];

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
    return lines.join('\n').slice(0, 2400);
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
    this.db.exec('DELETE FROM facts; DELETE FROM messages; DELETE FROM anchors; DELETE FROM commitments; DELETE FROM companion_days; DELETE FROM auto_anchor_events; DELETE FROM feedback_events; DELETE FROM feedback_mutes; DELETE FROM activity_log; DELETE FROM activity_corrections;');
    this.secureFiles();
  }

  private trimFacts(): void {
    this.db.exec(`
      DELETE FROM facts
      WHERE id NOT IN (
        SELECT id FROM facts ORDER BY pinned DESC, use_count DESC, updated_at DESC LIMIT ${MAX_FACTS}
      )
    `);
  }
}
