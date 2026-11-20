import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFrontmatter, SkillRegistry } from '../src/main/skills.ts';

test('frontmatter 解析 name / description / when，正文保留', () => {
  const parsed = parseFrontmatter(`---
name: demo-skill
description: 一个演示技能
when: 用户说演示时
---

# 正文

第一步。
`);
  assert.equal(parsed.data.name, 'demo-skill');
  assert.equal(parsed.data.description, '一个演示技能');
  assert.match(parsed.body, /# 正文/);
});

test('技能注册表从目录加载、按名称查找并生成目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-skills-'));
  try {
    fs.mkdirSync(path.join(dir, 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'demo', 'SKILL.md'),
      `---
name: demo
description: 演示
when: 演示时
---
做演示。
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'loose.md'),
      `---
name: loose
description: 松散技能
---
做点别的。
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(dir, 'plain.md'),
      '没有 frontmatter 的技能。\n',
      'utf8',
    );

    const registry = new SkillRegistry([{ dir, source: 'user' }]);
    assert.equal(registry.list().length, 3);
    assert.equal(registry.get('DEMO')?.body, '做演示。');
    assert.equal(registry.get('plain')?.body, '没有 frontmatter 的技能。');
    assert.match(registry.catalog(), /demo：演示/);
    assert.equal(registry.info()[0].source, 'user');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
