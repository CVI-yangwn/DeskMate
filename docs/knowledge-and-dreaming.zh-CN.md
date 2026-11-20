# 知识库与夜间整理：实现说明

> 面向维护者。设计取舍见 [Linger 架构对照](linger-lessons.zh-CN.md)。

## 1. 数据模型

都在 `~/Library/Application Support/DeskMate/memory.db`，由 `MemoryStore` 管理。

| 表 | 作用 |
|---|---|
| `wiki_pages` | 一页一个实体；`summary`、`items`（JSON）、`sources`（JSON）、`change_log`（JSON），`name_key UNIQUE` |
| `proactive_rules` | 学到的提醒规则；`kind` + `decision` + 可选 `window_start/window_end`，`active` 可暂停 |
| `proactive_clues` | 还没够格成为规则的观察；`seen` 累计 |
| `proactive_deliveries` | 每次主动消息的账本：说了什么、是否被压住、用户反应 |
| `daily_reports` | 每天的日结 |
| `dream_runs` | 每次整理的运行记录（状态/页数/规则数/message） |
| `agent_memory` | 单行“关于你”的摘要 |

`AgentSettings` 新增：

```ts
autoDream: boolean;        // 默认 true
dreamingAt: string;        // 默认 "23:30"
proactiveLearning: boolean;// 默认 true
```

## 2. 夜间整理流程

入口：`BrainService.runDreaming(force)` → `runDreaming()`（`src/main/dreaming.ts`）。

```text
lastRun = dream_runs 最近一条
since   = max(now - 7d, lastRun.finishedAt ?? now - 24h)
evidence = MemoryStore.getDreamEvidence(since, now)
  ├─ 对话 msg:<id>
  ├─ 锚点 anchor:<id>
  ├─ 承诺 commit:<id>
  ├─ 意图 intent:<id>
  ├─ 屏幕活动 activity:<id>
  ├─ 用户纠正 correction:<id>
  └─ 主动消息 delivery:<id>

route = DeepSeek.routeWikiEntities(evidence, registry)   // 最多 6 个实体
for each entity (最多 5):
  subset = 只保留该实体 ref 相关的证据行
  draft  = DeepSeek.writeWikiPage({evidence: subset, existing, registry})
  page   = applyWikiDraft(existing, draft, evidence.refs)
  store.saveWikiPage(page)
  writeWikiFile(userData/wiki/<type>/<slug>.md)

learn = DeepSeek.learnProactiveRules({deliveries, messages, rules, clues})
store.replaceDreamingRules(learn.rules)
store.replaceClues(learn.clues)
promoteClues(...)  // 同类累计 2 次也升级

digest  = DeepSeek.generateDailyDigest(...) || localDigest()
summary = DeepSeek.summarizeAgentMemory(...) || localAgentSummary()
store.saveDailyReport(day, digest)
store.setAgentMemory(summary)
writeAgentMemoryFiles(userData/agent-memory/{summary.md,MEMORY.md})
store.finishDreamRun(...)
```

每一步都有本地兜底；单页失败只进 `notes`，不影响其他页。

### 触发

- `index.ts` 的 `startDreamLoop()`：启动 15 秒后检查，之后每 5 分钟；
- `BrainService.maybeRunDreaming()`：未开启自动整理 / 已经在跑 / 4 分钟内检查过 → 跳过；当前时间未到 `dreamingAt` → 跳过；今天已成功 → 跳过；
- 面板“现在整理” → `runDreaming(true)`，强制重跑；
- 当天 `status = error` 时，下一次检查会重试。

## 3. 不变量

`applyWikiDraft()` 是唯一的写入口，保证：

1. **引用可追溯**：summary 和 newItems 里的 `[[ref]]` 必须在本次证据或旧页面的 sources/items 里存在，否则抛 `WikiValidationError`。
2. **只增不减**：没被 `closeItems` 提到的条目原样保留；`closeItems` 按 id → 原文 → 包含匹配，匹配不到忽略。
3. **去重**：新条目和已有 open 条目按去空格/标点后的文本比较。
4. **上限**：open 条目最多 20；超出时把最老的标为 done，并在 notes 里说明（不丢历史）。
5. **Change Log 由应用写**：模型的 `changeNote` 只是内容，时间戳和写入方是应用。
6. **改名不换 id**：页面 id 稳定；`name_key` 冲突会让写入失败，由调用方记录，不会产生两个同名页。
7. **删掉不会复活**：删除页面会写 `wiki_tombstones`（名称 + 别名），夜间路由遇到同名实体直接跳过；这是“用户明确不要这页”的信号。

## 4. 规则门控

每次主动说话前：

```ts
const gate = gateProactive(store.getRules(false), eventType, now);
if (gate.decision !== 'allow') {
  store.recordProactiveDelivery({eventType, text: planned, suppressed: true});
  return; // 不说
}
```

优先级：具体 `kind` > `any`；带时间窗 > 不带；同分取最近更新。`tell_now` 放行，`stay_silent` 压住，`follow_up_later` 在窗口内压住。DeskMate 的事件多数是一次性的，暂不做“窗口外重放”；需要跟进的事仍走承诺/锚点。

反馈学习入口在 `BrainService.chat()`：

1. 取 30 分钟内最近一条未回应的主动消息；
2. 本地 `detectExplicitFeedback()` 抓“以后/别/晚点/晚上”等明确表达；
3. 抓不到且 API 可用 → `suggestProactiveFeedback()` 判断是不是在说“提醒方式/时机”；
4. 明确表达 → `saveRule(source='explicit')`；含糊表达 → `upsert clue`，同类两次 → 规则；
5. 回复末尾补一句“记下了：……”。

气泡反馈入口在 `recordBubbleFeedback()`：写 `feedback_events` + 更新 `proactive_deliveries.outcome`；14 天内同类 3 次 → `saveRule(source='feedback', decision='stay_silent')`。

## 5. 技能

- 目录优先级：`process.cwd()/skills` → `resources/skills` → `userData/skills`；同名先到先得。
- 支持 `skills/<name>/SKILL.md` 和 `skills/*.md`。
- frontmatter 字段：`name`（必填，缺省用目录名）、`description`、`when`；正文最多 20k。
- `SkillRegistry.catalog()` 只输出 name/description/when，注入聊天上下文；`use_skill` 返回全文。
- 内置技能在仓库 `skills/`；用户技能放 `~/Library/Application Support/DeskMate/skills/`。

## 6. 文件

```text
~/Library/Application Support/DeskMate/
├─ memory.db
├─ wiki/
│  ├─ project/<slug>.md
│  ├─ contact/<slug>.md
│  └─ topic/<slug>.md
├─ agent-memory/
│  ├─ summary.md   # 短索引，注入聊天
│  └─ MEMORY.md    # 全部长期事实，按项目/偏好/事实分组
└─ skills/         # 用户技能
```

页面改名不会删旧文件；删除页面不删文件。需要的话手动清理。

## 7. 手动验证

```bash
# 纯逻辑单测
node --experimental-strip-types --no-warnings --test \
  scripts/test-wiki.mjs scripts/test-proactive-rules.mjs \
  scripts/test-skills.mjs scripts/test-dreaming.mjs

# 全量
npm test
npm run typecheck
npm run build
```

真机验证：

1. 面板 → 知识 → “现在整理”；看是否生成日结、页面、规则；
2. 等一条主动消息，回复“以后这种事直接说”，看规则是否出现在知识页；
3. 收到同类消息，确认被规则压住（控制台 `[proactive] ... suppressed`）；
4. 点气泡关闭 2 次（会静默 7 天），静默结束后再关 1 次，看是否出现 `stay_silent` 规则；
5. 打开 `wiki/` 和 `agent-memory/` 检查 Markdown。

## 8. 已知限制

- 夜间整理会调用模型最多约 8 次；没有 key 时只做本地日结和项目页迁移。
- 引用校验只保证“ref 存在”，还不保证“重写 summary 时保留了旧引用”；Linger 的 `removed_refs` 机制尚未实现。
- 搜索是名称/别名/摘要/条目的加权匹配，没有 embedding。
- `dream_runs` 保留 180 天，`proactive_deliveries` 保留 90 天；旧记录会在写入时清理。
- 规则只覆盖 DeskMate 已有的主动事件类型；用户说“邮件/日历”这类 DeskMate 看不到的来源，会落到 `any` 或当前事件，命中率有限。
