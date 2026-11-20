# 技能（Skills）

一个技能是一段按需加载的 Markdown 指令。聊天时模型只看到名称、描述和触发场景；任务匹配时才读取全文，避免把一堆流程塞进 system prompt。

## 目录

- 内置：仓库 `skills/<name>/SKILL.md`
- 用户：`~/Library/Application Support/DeskMate/skills/<name>/SKILL.md`（同名优先覆盖内置）
- 也支持 `skills/*.md`

## 格式

```markdown
---
name: daily-review
description: 一句话说明这个技能做什么。
when: 用户说“收个尾 / 今天怎么样”时使用。
---

# 标题

步骤 1……
步骤 2……
```

- `name`：必填；缺省用目录名。只用小写字母、数字和连字符更容易被模型引用。
- `description`：一句话，会出现在聊天上下文的技能目录里。
- `when`：触发场景，帮助模型决定什么时候读全文。
- 正文：写清楚步骤、可调用的工具（`lookup_activity`、`search_knowledge`、`read_wiki_page`、`remember` 等）、边界和不许做的事。
- 正文最多 20k 字符；不要放密钥、token 或隐私数据。

## 内置技能

| 技能 | 用途 |
|---|---|
| `daily-review` | 今日收尾：推进了什么、卡在哪、明天先做 |
| `debug-timeline` | 把一次 bug 排查按时间线理出来 |
| `meeting-prep` | 会前从 wiki / 记忆 / 活动里拉小抄 |
| `weekly-review` | 最近 7 天聚合成周报 |

## 调试

- 面板 → 知识 → 技能，能看到当前加载了哪些、来源是内置还是用户。
- 聊天里说“列出技能”会触发 `list_skills`；说“用 daily-review 收个尾”会触发 `use_skill`。
- 改了技能文件后最多 5 秒生效（注册表有缓存）；重启应用也可以。
