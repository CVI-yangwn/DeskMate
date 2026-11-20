import fs from 'node:fs';
import path from 'node:path';
import type { SkillInfo } from '../shared/types';

export interface LoadedSkill extends SkillInfo {
  body: string;
}

export interface SkillDir {
  dir: string;
  source: 'builtin' | 'user';
}

const MAX_SKILL_BODY = 20_000;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(text: string): {
  data: Record<string, string>;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized.trim() };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { data: {}, body: normalized.trim() };

  const data: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (match) data[match[1].toLowerCase()] = unquote(match[2]);
  }
  const body = normalized.slice(end + 4).replace(/^\n+/, '').trim();
  return { data, body };
}

function fallbackDescription(body: string): string {
  for (const line of body.split('\n')) {
    const clean = line.replace(/^#+\s*/, '').trim();
    if (clean && !clean.startsWith('```') && !clean.startsWith('>')) return clean.slice(0, 120);
  }
  return '';
}

export function parseSkillFile(file: string, source: 'builtin' | 'user'): LoadedSkill | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const fallbackName =
      path.basename(file).toLowerCase() === 'skill.md'
        ? path.basename(path.dirname(file))
        : path.basename(file, path.extname(file));
    const name = (data.name || fallbackName).trim();
    if (!name || !body) return null;
    return {
      name: name.slice(0, 60),
      description: (data.description || fallbackDescription(body)).slice(0, 240),
      when: (data.when || '').slice(0, 240),
      source,
      path: file,
      body: body.slice(0, MAX_SKILL_BODY),
    };
  } catch {
    return null;
  }
}

export function loadSkills(dirs: SkillDir[]): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  const seen = new Set<string>();
  for (const { dir, source } of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const file = entry.isDirectory()
        ? path.join(dir, entry.name, 'SKILL.md')
        : entry.isFile() && entry.name.toLowerCase().endsWith('.md')
          ? path.join(dir, entry.name)
          : '';
      if (!file || !fs.existsSync(file)) continue;
      const skill = parseSkillFile(file, source);
      if (!skill) continue;
      const key = skill.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }
  return skills;
}

export class SkillRegistry {
  private readonly dirs: SkillDir[];
  private cached: LoadedSkill[] = [];
  private cachedAt = 0;

  constructor(dirs: SkillDir[]) {
    this.dirs = dirs;
    this.cached = loadSkills(dirs);
    this.cachedAt = Date.now();
  }

  list(force = false): LoadedSkill[] {
    if (force || Date.now() - this.cachedAt > 5_000) {
      this.cached = loadSkills(this.dirs);
      this.cachedAt = Date.now();
    }
    return this.cached;
  }

  get(name: string): LoadedSkill | undefined {
    const key = name.trim().toLowerCase();
    if (!key) return undefined;
    return this.list().find(
      (skill) => skill.name.toLowerCase() === key || path.basename(skill.path).toLowerCase() === key,
    );
  }

  info(): SkillInfo[] {
    return this.list().map(({ body: _body, ...info }) => info);
  }

  catalog(limit = 12): string {
    const skills = this.list().slice(0, limit);
    if (skills.length === 0) return '';
    return skills
      .map((skill) => `- ${skill.name}：${skill.description}${skill.when ? `（${skill.when}）` : ''}`)
      .join('\n');
  }
}
