# 改进记录 / CHANGELOG

> 这份文件按**时间**记录 DeskMate 的用户可见变化、关键实现和验证方式。
> 之前的改进散在 README、`docs/` 和各次 commit 里；从现在起，功能、策略、记忆结构的变化都先记到这里，再改 README。
>
> 约定：
> - 一条记录写清「改了什么、为什么、怎么验证」；
> - 设计取舍放 `docs/`，这里只放索引和结论；
> - 未提交的批次也记，标 `未提交`，合并后再改成 commit 范围；
> - 每次发版/合并前，把 `未发布` 归到日期下。

当前状态：`v0.1.0` 原型，本地仓库 `main`，最近一次完整验证是 **78 个测试 + typecheck + build 全通过**（2026-11-20）。

---

## 2026-11-20 — 试用前 P0 修复（`7c4b139`）

> 五个 agent 的发布评审一致给出“有条件值得（3/5）”：内部 dogfood 可以，外部试用不行。下面只修评审里明确的 P0，不扩功能。

### 修复

- **单实例锁**：第二个实例直接退出；`second-instance` 时打开面板，避免两个进程抢同一个 `memory.db`/事件桥端口、双份扫描和双份整理。
- **渲染进程崩溃恢复**：avatar `render-process-gone` 自动重建窗口并重新定位；panel 崩溃/无响应自动 reload；拖动中崩溃 10 秒后复位 `avatarDragging`，避免点击穿透永久关闭。
- **清空 vs 夜间整理**：`clearMemory()` 递增 `dreamEpoch`，正在跑的 Dreaming 在下一页/规则/日结/摘要写回前检查 epoch，命中就中止；`clear()` 的 DELETE 包事务。
- **显式记忆保护**：facts 满 100 时按 pinned → source（auto/migration 先删，tool 次之，explicit 最后）→ use_count → updated_at 淘汰，不再让自动事实挤掉“记住：…”。
- **脱敏旁路**：`state.evidence` 的 OCR 预览、光标 80 字、报错变化，`labelIntention` 的 focus 300 字，以及活动时间线现在都过 `redactSensitive`；补 `password=`、`Bearer`、`AIza` 模式。
- **迁移安全**：旧库升级前自动备份 `memory.db.bak-v{version}-{timestamp}`；清 OCR 后 `wal_checkpoint(TRUNCATE)`，降低旧正文留在 WAL 的概率。
- **演示不污染真实状态**：模拟通过/失败只发气泡/语音，不再改 `state.testResult`/`focusMin`。
- **UI 诚实**：清空/删页确认文案与实际行为一致；facts 为空时也能“清空全部”；README 修正“首次运行会请求辅助功能”的说法（实际不会自动弹窗）。

### 验证

```bash
npm run typecheck
npm test        # 78 pass
npm run build
```

### 仍然拦在“外部试用”之外

- 全屏/副屏截图仍会送视觉模型；公司代码/客户资料场景需先关自动扫描或改抓前台窗口。
- 无 DMG/签名、无 CI、无 Electron UI 自动化；只能源码 dev 模式内部试用。
- 无 SQLCipher/加密卷；Time Machine/APFS/iCloud 可能在应用外留副本。
- DeepSeek 解析失败/模型漂移仍缺契约测试；真实 oneapi 需冒烟。

---

## 2026-11-20 — 记忆隐私、删除与证据硬化（`3931b50`）

> 起因：对 Anthropic 四层记忆设计的辩论结论是“不做四层，先修已经暴露的隐私/删除/留存问题”。
> 基线 commit：`bed3aba`（intent 层 + knowledge base + skills 的检查点）。

### 修复

- **删除是真删除**：`clear()` 改为按 `MEMORY_TABLES` 单一清单清表，并删 `wiki/`、`agent-memory/` 文件；删除单个 wiki 页会 unlink 对应 Markdown；清空后 `secure_delete` + `VACUUM`，降低 strings 从 DB/WAL 捡到旧 OCR 的概率。
- **tombstone 脱敏**：从明文页面名改为 SHA-256 hash，升级时自动迁移旧行；页面名不再长期留在 DB。
- **导出权限**：JSON/Markdown 导出强制 0600，并在保存对话框提示不要放 iCloud/共享目录。
- **OCR/光标正文不落盘**：`activity_log.ocr_text/focus_text` 对新记录写 NULL；升级时一次性清空旧版本留下的正文；`activity_log` 只保留活动摘要。
- **secure field**：`native/ax.swift` 同时检查 secure input、`AXSecureTextField` role/subrole；密码框直接不读。

### 变更

- messages 从 200 条提升到 **1000 条 + 7 天**双上限；Dreaming 取数从 60 条提升到 **300 条**。
- activity 从 2000 行硬顶改为 **7 天 + 20000 行**安全上限，避免“所谓 7 天实际只有 33 小时”。
- `WikiSource` 增加 200–300 字 `excerpt` 快照：原 `msg:`/`activity:` 行被裁剪后，页面仍能解释这条记忆。
- wiki 查询先去掉引号/问号等标点，并跳过“现在/什么/状态”等停用词；自然问句能命中页面名。
- `getWikiContext` 在非空查询无命中时不再硬塞最近 4 页，避免挤掉规则/技能；注入顺序改为 summary → rules → skills → wiki，总预算仍 4200 字。
- 知识页新增「记忆健康」：页面/对话/活动数、注入字符、无来源页、过期来源、90 天僵尸页、重复未完成项。

### 新增

- `src/main/redact.ts`：证据送模前脱敏常见私钥、API key、JWT、邮箱、手机号、身份证、卡号；接入 Dreaming 证据、主动消息复盘、视觉 OCR/光标文本。
- `scripts/eval-memory.mjs` + `evals/`：零模型检索体检（`--auto` 用现有页面出题；`--questions` 读真实 30 题），默认复制 DB 到临时目录，不碰线上库。
- `scripts/test-memory-hardening.mjs`、`scripts/test-redact.mjs`；全量测试 **75** 个通过。

### 验证

```bash
npm run typecheck
npm test        # 75 pass
npm run build
npm run eval:memory
```

### 已知限制

- 仍然没有 SQLCipher/加密卷；Time Machine、APFS 快照、iCloud 同步可能在应用外保留副本。
- 截图本身仍会发给视觉模型；脱敏只覆盖文本证据，不覆盖图像像素。
- 没有全量 transcript/events 层；按当前规模，先修留存和来源快照，不引入双写。
- 记忆健康里的“过期来源”包含按策略裁剪的 ref，不是全部都是异常；面板用它提示“这条已不可回查”。

---

## 2026-11-20 — 从 Linger 吸收：知识库、夜间整理、提醒规则、技能（`bed3aba`）

> 参考：[simplexai-labs/linger](https://github.com/simplexai-labs/linger) `c8564ed`。只吸收 agent harness / 产品层，不碰本地模型。
> 设计说明：[Linger 架构对照](docs/linger-lessons.zh-CN.md) · 实现说明：[知识库与夜间整理](docs/knowledge-and-dreaming.zh-CN.md)

### 新增

- **个人 wiki**：项目 / 人物 / 话题三类页面，一页一个实体，带摘要、未完成条目、来源、Change Log；`summary + items` 只写变化，未提到的条目不丢；引用必须来自证据；同名页数据库层拒绝；删除留 tombstone，不会夜间自动复活。
  - 代码：[wiki.ts](src/main/wiki.ts)、[memory.ts](src/main/memory.ts)
  - 文件：`userData/wiki/<type>/<slug>.md`
- **夜间整理（Dreaming）**：每天 23:30 后（可配；超过 30 小时没整理会补跑）把对话、锚点、承诺、意图、屏幕活动、主动消息反馈收敛成 wiki、规则、日结和“关于你”的摘要；最多 5 页；没 key 时本地日结 + 项目页迁移。
  - 代码：[dreaming.ts](src/main/dreaming.ts)
  - 文件：`userData/agent-memory/{summary.md,MEMORY.md}`
- **提醒规则学习**：`tell_now / follow_up_later / stay_silent`，支持时间窗；明确表达直接成规则，含糊表达先记线索、同类两次升级；“先别说话”算临时收声，不变成永久静默；气泡 14 天内被关 3 次会沉淀为 `stay_silent`。
  - 代码：[proactiveRules.ts](src/main/proactiveRules.ts)、[brain.ts](src/main/brain.ts)
  - 每次主动说话前过规则；被压住的消息也记 `proactive_deliveries`，夜间可复盘。
- **技能（Skills）**：`skills/<name>/SKILL.md`，frontmatter 描述常驻、正文按需加载；用户目录 `~/Library/Application Support/DeskMate/skills/` 优先于内置。
  - 代码：[skills.ts](src/main/skills.ts)
  - 内置：[daily-review](skills/daily-review/SKILL.md)、[debug-timeline](skills/debug-timeline/SKILL.md)、[meeting-prep](skills/meeting-prep/SKILL.md)、[weekly-review](skills/weekly-review/SKILL.md)
- **知识面板**：面板新增「知识」标签页，展示日结、wiki 页面、规则、线索、技能和“它现在对你的印象”；支持“现在整理”、删除页面、暂停/删除规则、打开 wiki 文件夹。
  - 代码：[KnowledgePanel.tsx](src/renderer/KnowledgePanel.tsx)
- **新工具**：`search_knowledge`、`read_wiki_page`、`list_skills`、`use_skill`；`lookup_activity` 增加 `daysAgo`，为周报取任意一天。
  - 代码：[agentTools.ts](src/main/agentTools.ts)
- **后台模型调用**：实体路由、页面写作、反馈判断、规则学习、日结、记忆摘要；比聊天/视觉有更长的超时和更低的温度。
  - 代码：[deepseek.ts](src/main/deepseek.ts)

### 变更

- 主动策略从“写死冷却 + 同类静默”升级为“规则门控 + 冷却 + 勿扰/安静时段”；规则可暂停/删除，暂停时会清掉旧的 7 天静默。
- `AppStatus` 增加 `wikiPageCount`、`ruleCount`、`skillCount`、`lastDreamAt`、`autoDream`、`dreamingAt`、`proactiveLearning`。
- `AgentSettings` 增加 `autoDream`、`dreamingAt`、`proactiveLearning`；设置面板可配自动整理时间和“从反馈学习”开关。
- 记忆导出（JSON/Markdown）包含 wiki 页面和提醒规则。
- 聊天上下文注入：个人 wiki、夜间摘要、提醒规则、技能目录；`user-persona` 与原有长期记忆并存。
- 新增 4 个测试文件（`test-wiki`、`test-proactive-rules`、`test-skills`、`test-dreaming`）；全量 **67** 个用例通过。

### 验证

```bash
npm run typecheck
npm test        # 67 pass
npm run build
```

### 已知限制

- 没有真机跑过 oneapi 的夜间整理和知识面板视觉验收；编排层用 fake client 单测覆盖。
- 没有实现 Linger 的 Routine/延迟重放：`follow_up_later` 目前是“窗口内先别打扰”，依赖承诺/锚点做后续跟进。
- 没有任务委派和审批卡；没有语义/向量检索。
- 夜间整理会把聊天文本和活动摘要发给模型，暂未做额外脱敏。

---

## 2026-11-16 — 意图层与可信感知（随 `bed3aba` 检查点）

> 设计说明：[意图层](docs/intent-layer.zh-CN.md) · [光标上下文](docs/caret-context.zh-CN.md)


### 新增

- **意图层**：把连续扫描归成“在 Xcode 里修 auth 校验”这样的段；换应用 / 断档 8 分钟 / 同应用超 45 分钟自动收尾；命名走 DeepSeek，失败回退本地模板。
  - 代码：[intention.ts](src/main/intention.ts)
  - 数据：`intentions`、`intention_predictions`
  - 测试：`test-intention.mjs`、`test-intention-store.mjs`
- **下一步预测**：最近 6 条意图 + 时段 + 行为画像，只猜“下一步”；置信度 ≥ 0.60 才开口；面板可点“对 / 不是”，“不是”会在 2 小时内压掉相似猜测；`DESKMATE_INTENT_PREDICT=0` 可关。
- **光标上下文**：`native/ax.swift` 通过 macOS 辅助功能读光标附近已提交文本；主进程 1.5s 超时并静默降级，不监听键盘。
  - 代码：[ax.ts](src/main/ax.ts)
  - 文档：[caret-context.zh-CN.md](docs/caret-context.zh-CN.md)
- **文本变化**：OCR 行级 diff，只把“新出现的报错行”当成值得说的变化，避免时钟/滚动噪音；同时算“在不在打字”的增量。
  - 代码：[change.ts](src/main/change.ts)
  - 测试：`test-change.mjs`
- **注意力归属**：前台屏说了算，副屏只作 `ambient` 线索；同一应用里冒出的新说法要连续两帧才确认，通知/弹窗不会把“在做什么”带偏。
  - 代码：[salience.ts](src/main/salience.ts)
  - 测试：`test-salience.mjs`

### 变更

- 活动时间线在原有基础上补充 `ocr_text`、`focus_text`、`change_note`、`entity`，并在聊天上下文里带“最近意图 / 活动时间线 / 用户纠正”。
- 扫描流水线串起来：截图 → OCR → 光标文本 → 变化检测 → 视觉分析 → 注意力平滑 → 意图分段。
- 聊天工具仍保持少量：`remember`、`search_memory`、`lookup_activity`、`scan_screen`、`set_dnd`（此时尚未加知识库工具）。

---

## 2026-11-13 — 陪伴记忆、多屏感知、活动时间线

> 对应提交：`6f8f438`、`740e208`、`5eff6ca`、`fafeff4`、`36ed43a`

### 新增

- **陪伴记忆**：每天最多 8 个锚点（自动从聊天抽 1–2 个，也可手动加/编辑）、承诺清单、次日一次 callback、晚间一句；不做全量时间线。
- **自动锚点**：测试红→绿、连续专注 60/90 分钟、测试红着卡住 30 分钟自动记一条；每天最多 2 条；删掉的不会自动重建。
- **闭嘴反馈**：气泡关闭/点开回传；同类连续被关 2 次静默 7 天；全屏、会议、安静时段不主动说话。
- **声音与人格**：macOS `say` 音色/语速可配，可写 persona（称呼/语气/边界/绝对不说）。
- **多屏感知**：抓所有显示器整屏（聚焦屏优先），每块屏跑本地 OCR；任意屏出现隐私排除应用时退回前台窗口截图。
  - 文档：README「扫描当前屏幕 / 多屏隐私回退」与已知问题小节
- **活动时间线**：每次扫描把应用、窗口、活动写入 SQLite，保留 7 天；`lookup_activity` 可查更久。
- **自我纠正**：用户说“不对，我刚才在写周报”时，提取正确活动和覆盖时间写入纠正表；之后回答“刚才在干嘛”优先用纠正版。
- **记忆导出**：长期记忆、锚点、承诺、日结导出 JSON/Markdown。
- **自动记忆**：稳定偏好/项目从聊天沉淀，相似记忆合并；可关闭。

### 修复

- 纠正识别支持句尾否定，跳过不可用的观察（`36ed43a`）。
- 多屏截图 / 隐私回退的边界说明补齐（`5eff6ca`）。

---

## 2026-11-12 — 原型、感知与运行时硬化

> 对应提交：从 `d5f0bb9` 初始化到 `deb87e3`

### 新增

- **独立 macOS 原型**：Electron 透明窗 + Haru Live2D + 可拖动/点击穿透 + 托盘 + 全局快捷键 + 面板双窗口。
- **感知**：前台窗口（`get-windows`）+ 聚焦显示器截图 + macOS Vision 本地 OCR + 空闲时间；无 VS Code 依赖。
- **大脑**：DeepSeek 文本 / 视觉 / JSON / tool calls；key 缺失或 401 时回退本地 mock。
- **记忆**：SQLite + FTS5，事实分类、置顶、搜索、编辑、删除、来源/置信度/使用次数。
- **嘴巴**：macOS `say`，气泡/口型同步；新语音打断上一条。
- **事件桥**：`127.0.0.1:39876/event`，`demo:pass` / `demo:fail` 手动触发红绿。
- **主动策略**：启动问候、手动扫描反馈、专注 25 分钟、空闲 10 分钟、离开回来欢迎、测试红→绿祝贺。
- **面板**：此刻 / 对话 / 今天三页；状态、证据、扫描统计、隐私/勿扰/语音开关。

### 修复 / 硬化

- 截图只抓聚焦显示器，不再抓整个活动窗口（`09e864b`）。
- 前台应用以 OS 为准，不被视觉输出带偏（`0ec4fee`）。
- 窗口/截图调用加超时，避免卡死扫描（`76ea379`）。
- 扫描并发保护，修复 focus/proactive 状态（`4c71021`）。
- FTS 搜索保留事实元数据（`c17bb9f`）。
- 事件桥拒绝非本机 Origin 和非 JSON（`71e0ad4`）。
- 打包后从 userData 读 `.env.local` 和 `config/avatar.haru.json`（`22eaecf`）。
- 系统 Node 缺失/过旧时回退项目自带 `.node`（`192809d`），并清掉 `ELECTRON_RUN_AS_NODE`（`44b0b22`、`12d678e`）。
- 面板视觉层级重做（`0c7d08e`），气泡可打开面板、记忆列表刷新（`3985b1d`）。
- 首次扫描允许开口（`deb87e3`）；空闲重置专注里程碑（`e27a07d`）。

### 测试

- `test-memory.mjs`、`test-event-bridge.mjs`、`test-companion.mjs`、`test-correction.mjs` 等基础套件。

---

## 怎么继续维护

1. 改功能前先在「未发布」下加一条，写清动机和验证方式。
2. 合并/发版时把「未发布」改成日期，补 commit 范围。
3. 设计取舍写进 `docs/`，这里只留一句结论 + 链接。
4. 每次发版前跑：
   ```bash
   npm run typecheck
   npm test
   npm run build
   ```
5. 查历史：
   ```bash
   git log --oneline --decorate
   git diff --stat
   ```
