import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AgentSettings,
  ChatMessage,
  MemoryFact,
  MemoryKind,
  MemorySource,
} from '../shared/types';

const DEFAULT_SETTINGS: AgentSettings = {
  dnd: false,
  voiceEnabled: true,
  autoMemory: true,
  excludedApps: ['1Password', 'Keychain Access', 'Passwords', 'System Settings', 'System Preferences'],
  visionBudgetPerHour: 30,
  scanIntervalMs: 60_000,
  proactiveCooldownMs: 300_000,
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
    visionBudgetPerHour: Math.min(120, Math.max(1, Number(raw.visionBudgetPerHour) || DEFAULT_SETTINGS.visionBudgetPerHour)),
    ...(perceptionPausedUntil ? { perceptionPausedUntil } : {}),
    scanIntervalMs: Math.max(20_000, Number(raw.scanIntervalMs) || DEFAULT_SETTINGS.scanIntervalMs),
    proactiveCooldownMs: Math.max(
      60_000,
      Number(raw.proactiveCooldownMs) || DEFAULT_SETTINGS.proactiveCooldownMs,
    ),
    ...(avatarPosition ? { avatarPosition } : {}),
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

  clear(): void {
    this.db.exec('DELETE FROM facts; DELETE FROM messages;');
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
