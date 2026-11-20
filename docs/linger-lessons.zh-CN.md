# 从 Linger 吸收什么：一个 personal agent 的架构对照

> 参考对象：[simplexai-labs/linger](https://github.com/simplexai-labs/linger)
> 读取版本：`c8564ed`（2026-11-20），约 5,600 个文件、300+ TS/TSX 模块、独立桌面端 + 本地 Computer Daemon + TeamHub 服务端。
> 范围：**只吸收 agent harness / 产品层**。本地模型、PolyStrata、Model Autopilot、量化与推理引擎不在讨论范围——DeskMate 用内网 oneapi，不需要本地部署。

---

## 0. 一句话结论

Linger 最值得抄的不是“模型能跑多小”，而是它把**长期记忆、主动打断、技能、任务委派**做成了有状态、可审计、能自我修正的闭环：

> 事件先落账 → 模型做判断/写作 → 应用校验并落库 → 用户反馈改变下一次判断。

DeskMate 原先的记忆是“事实 + 锚点 + 意图”的平铺结构，主动策略是代码里写死的冷却与静音。这次吸收后，补上了三块：

1. **个人 wiki**：一页一个实体，带摘要、未完成条目、来源和 Change Log；
2. **夜间整理（Dreaming）**：把当天证据收敛成 wiki、提醒规则、日结和“关于你”的摘要；
3. **反馈学习**：用户说“以后这类直接说 / 别提醒 / 晚点再说”会变成带时间窗的规则，在说话前生效。

另外加了**技能（Skills）**：描述常驻、正文按需加载，和 Linger 的 progressive disclosure 一致。

---

## 1. Linger 的六层结构

| 层 | Linger 的做法 | 对 DeskMate 的价值 |
|---|---|---|
| 客户端 | Electron 桌面端，负责聊天、Room、文档、审批卡 | 界面形态不同，不照搬 |
| Computer Daemon | 每台电脑一个后台进程，WebSocket 出站连接；命令队列、事件账本、Runtime 适配器、本地工具 | 事件账本 + 单飞队列值得抄；多 runtime 不需要 |
| Runtime | Codex / Claude Code / Pi / Antigravity，各自会话与工作区 | DeskMate 自己就是 runtime，跳过 |
| TeamHub | Go + PostgreSQL + River 队列，多用户、权限、Rooms | 单机自用不需要 |
| Memory / Wiki | 夜间批处理：事实抽取 → wiki 页面 → 日报/周报 → agent memory | **核心借鉴** |
| Proactive | 事件/对话窗口判断 → 提醒或记录 → 夜间从反馈里改规则 | **核心借鉴** |

它真正的“agent 味”来自三个约束：

- **记忆有结构**：不是把所有东西塞进向量库，而是“一页一个实体”，事实有唯一的家。
- **行动有账本**：每条主动消息、每次投递、每个结果都落库，夜间才能复盘。
- **规则可学习**：规则是数据，不是 prompt 里的一段散文；能增删改、能解释。

---

## 2. 记忆：从“事实列表”到“有主页的知识”

### 2.1 Linger 怎么做

- 五类页面：Client / Contact / Project / Topic / Session；一个真实实体只有一页，别名和 Project part 去重。
- 页面是分 section 的结构化 Markdown：`summary` 是叙述，`items` 是带 ID 的列表，`generated` 的 Change Log 由应用写。
- 模型只提交**变化**：
  - summary 要么 `keep`，要么重写并给 `reason`；
  - items 只提交新增、修改、撤回，没提到的条目**原样保留**；
  - 每个事实带 `[[source:raw_ref]]` 引用，重写不能丢掉旧引用，除非显式说明；
  - 应用校验长度、条数、引用、重名，然后写 Change Log。
- 搜索结果分两路：wiki 页面（概览）和原始消息/文档（细节），用 RRF 融合；关键词检索，不依赖 embedding。

这套设计的本质是**把“记忆写入”从生成问题变成编辑问题**：模型不需要每次重写整页，只需要说清楚“这次改哪几条”，应用负责不丢东西。

### 2.2 DeskMate 的落地

保留结构，砍掉 session 页和复杂 section 引擎：

| Linger | DeskMate |
|---|---|
| Client / Contact / Project / Topic / Session | `project` / `contact` / `topic` 三类；不单独建会议页 |
| section 级 JSON + keep/rewrite | `summary` + `items[]` + `sources[]` + `changeLog[]` |
| `[[source:raw_ref]]` | `[[msg:12]]` / `[[anchor:id]]` / `[[activity:34]]` / `[[intent:id]]` |
| 应用校验引用、长度、条数 | `applyWikiDraft()` 校验；未提到的条目保留；超过 20 条把最老的归档为 done |
| Postgres 全文检索 + RRF | 本地加权匹配（名称 > 别名 > 摘要 > 条目），页面少时足够 |
| 文件只读、由服务端写 | 同样写 `userData/wiki/<type>/<slug>.md`，可读可删可进 git |

关键不变量（都有单测）：

1. 模型只能引用本次证据里出现过的 ref；旧页面已经引用过的 ref 仍然有效。
2. `closeItems` 只能按 id 或原文匹配，匹配不到就忽略，不会误删。
3. 新条目按压缩后的文本去重；结果只增不减，除非显式 close。
4. 重名页面在数据库层 `name_key UNIQUE` 拒绝，避免两个“DeskMate”。

### 2.3 为什么不做完整 section 引擎

Linger 的 section 规则服务于“多人、多来源、长期运营”的知识库，边界情况极多（历史 section、merge、retracted、方向字段……）。DeskMate 是单人自用，`summary + items` 已经覆盖 80% 的“这个项目到哪了 / 这人是谁 / 这事还没完”查询；再往上加复杂度，维护成本大于收益。等页面真的超过几百个、需要多人协作时再升级。

---

## 3. 夜间整理：把“今天”收敛成明天能用的东西

### 3.1 Linger 的流水线

```text
白天：对话、邮件、日历、会议、文档
  ↓ 每 5 次 run / 6 小时空闲
抽取：session summary + candidate memories
  ↓ 夜间 00:00
Dreaming：逐页提出修改 → 校验 → 写 wiki → 写 Change Log
  ↓
Daily / Weekly 报告；agent memory 的 summary.md + MEMORY.md
  ↓ 第二天
新会话第一条消息带上 summary 索引；其余按需读
```

两个细节很关键：

- **抽取和合并分开**：抽取便宜、频繁；合并贵、要等空闲。避免在用户说话时抢模型。
- **摘要作为索引，不是 system prompt**：Linger 把 summary 放在隐藏消息里，避免新记忆让 prompt cache 失效。DeskMate 没有 cache 压力，但“摘要短、正文按需读”仍然成立。

### 3.2 DeskMate 的实现

`src/main/dreaming.ts` 的 `runDreaming()`：

1. 取证据：从上次成功整理到现在（最多 7 天）的对话、锚点、承诺、意图、屏幕活动、用户纠正、主动消息及其结果。
2. 实体路由：把证据 + 已有页面注册表交给模型，返回最多 6 个实体（复用已有页 id，避免重复）。
3. 逐页写作：每页只看与它 ref 相关的证据，输出“只写变化”的草稿；`applyWikiDraft()` 合并、校验、写库、写 Markdown。
4. 规则学习：把主动消息、用户随后的话、已有规则/线索交给模型，返回规则和线索；同类线索累计 2 次也会本地升级。
5. 日结：模型写“今天推进了 / 卡住 / 明天先做”；没有 key 或失败时用本地模板。
6. 记忆摘要：模型把长期事实 + wiki + 规则压成“关于你”，存 DB 并写 `agent-memory/summary.md`、`MEMORY.md`。
7. 记录一次 `dream_runs`（状态、页数、规则数、message），面板可见。

触发：

- 默认每天 `23:30` 之后跑一次，当天成功过就跳过；
- 启动后 15 秒检查一次，之后每 5 分钟检查；
- 面板“现在整理”可强制重跑；
- 没有 API key 时仍然做本地日结 + 从 project 事实迁移 wiki，不会崩。

成本控制：最多 5 页、每页一次小调用、证据截断 16k 字、模型只写变化。默认一天一次，量级和一次普通聊天差不多。

---

## 4. 主动打断：从“写死冷却”到“可学习规则”

### 4.1 Linger 的判断模型

- 每个事件/对话窗口独立判断：用户有没有自己的利益/义务？什么是新的？现在需要知道，还是以后需要做？
- 三种动作：tell now / follow up later / stay silent；跟踪（Tracking Item）不等于说出口。
- 用户反馈分两类：
  - **明确说**：“以后客户回复直接告诉我”“晚上别发”“先记着，明天再说”——一次就成规则；
  - **隐含**：同类被拒两次以上——两次才升级，避免一次情绪。
- 规则格式固定：`<kind>[, <time window>] → <decision>`；规则越具体越优先；规则是数据，夜间可改写、可删除。

### 4.2 DeskMate 的落地

DeskMate 的主动事件类型是有限的（`test-pass`、`observe`、`idle`、`return`、`focus-milestone`、`companion:morning/evening`、`intent-predict`），所以规则可以落到具体事件上：

- 每次要说话前过 `gateProactive(rules, eventType, now)`：
  - 具体事件 > `any`，带时间窗 > 不带；
  - `stay_silent` / 窗口内的 `follow_up_later` 直接压住；
  - 压住的消息也写 `proactive_deliveries(suppressed=1)`，夜间能看到“本来会说但没说”。
- 用户回复后 30 分钟内，若最近有一条主动消息：
  - 本地正则先抓明确表达（“以后别提醒我测试”“晚上别发”“先记着，明天再说”）；
  - 抓不准再让模型判断这句话是不是在说“提醒方式/时机”，而不是内容喜好；
  - 明确表达直接建规则；含糊表达先记线索，同类两次升级。
- 气泡被关闭：记 `dismissed`；14 天内同类 3 次，沉淀成 `stay_silent` 规则（比原来的“静默 7 天”更持久，也更可见）。
- 聊天时把当前规则放进上下文，并在回复末尾补一句“记下了：……以后我直接说”，让用户知道它真的改了。

### 4.3 有意保留的边界

- 不从沉默、单次“完成了”、内容喜好里学。
- 时间窗只改变“什么时候说”，不直接变成“永远别说”；如果规则是 `follow_up_later`，窗口内压住，窗口外仍可说。注意 DeskMate 的主动事件大多是一次性的（一次观察、一次测试红绿），所以这里没有实现 Linger 的 Routine/延迟重放；`follow_up_later` 目前更接近“这个时段先别打扰”。
- 规则可暂停/删除，面板可见；不做“模型偷偷改 prompt”的黑箱。
- 全局勿扰、安静时段、会议/全屏仍然是更高优先级的硬约束，规则不能绕过它们。

---

## 5. 技能：描述常驻，正文按需

Linger 的 skills 是 Markdown + YAML frontmatter（`name` / `description` / `when`），agent 在 system prompt 里只看到目录，匹配时再读全文；内置技能覆盖主动响应、会议、记忆等。DeskMate 直接采用：

- 目录：`skills/<name>/SKILL.md`，也支持 `skills/*.md`；用户可放 `~/Library/Application Support/DeskMate/skills/`。
- 聊天上下文只放 `name：description（when）`。
- 工具 `list_skills` / `use_skill` 读取全文；正文里可以要求继续调用 `lookup_activity`、`search_knowledge`、`read_wiki_page`。
- 内置 4 个：`daily-review`、`debug-timeline`、`meeting-prep`、`weekly-review`。

这和“把一大段流程塞进 system prompt”相比，省 token、可扩展、用户能自己写；也和 DeskMate 的定位一致：流程是用户的，不是产品写死的。

---

## 6. 事件账本与任务委派：抄一半

Linger 的 Computer Daemon 有 SQLite 事件账本：事件先落库再发送，断线重放；命令按 Context 串行；每个输入先记日志，结果不确定就不重放。DeskMate 没有网络断线问题，但“先记账再行动”仍然有用：

- 已实现：`proactive_deliveries`（说了什么、是否被压住、用户什么反应）、`dream_runs`（整理是否成功）、wiki 的 Change Log。
- 未实现：通用任务队列、后台任务、审批卡。

**任务委派**（Meta / AlterEgo）是 Linger 很漂亮的设计：聊天里的 agent 只跟你说话，长任务交给后台副本，结果以卡片回来；需要审批时任务停在 `waiting_for_approval`，10 分钟过期。DeskMate 目前不做，因为：

1. DeskMate 的定位是“陪程序员工作，不替程序员干活”，没有浏览器/文件写入工具，后台任务能做的事有限；
2. 做任务委派必须先有审批/权限层，否则一个能写文件的 agent 比不能写更危险；
3. 先把“记忆 + 时机 + 技能”做稳，比加一个半成品任务系统更有价值。

如果以后要做，最小路径是：`tasks` 表 + 单飞后台 runner + 高风险工具（写文件/发消息）走审批卡 + 结果回到聊天，不需要 Linger 的 Meta/AlterEgo 全量语义。

---

## 7. 明确不抄的部分

| Linger | 为什么不抄 |
|---|---|
| 本地模型 / PolyStrata / Model Autopilot / 量化 | 用户明确不需要本地部署；DeskMate 用 oneapi，模型选择不是产品差异 |
| Model Scheduling 的端点自适应并发 | 那是本地模型争抢的解法；云端 API 只需控制“夜间任务不跟聊天抢”即可 |
| Go + PostgreSQL + River + 多用户/权限 | 单机自用，SQLite 足够；引入服务端会让安装变重 |
| Computer Daemon + Codex/Claude/Pi runtime | DeskMate 自己就是唯一的 runtime |
| CUA / Playwright / 浏览器 seat / Shell | 与“不替用户干活”的定位冲突；也是最大的安全面 |
| LiveKit / Soniox 语音栈 | DeskMate 用 macOS `say`，后续接 Speech 即可 |
| 155 条 teamhub CLI | 单人场景只需要几个工具；工具越多，模型越容易乱调 |
| 完整 section 级 wiki 引擎 | 复杂度/收益不划算，先用 summary + items |
| 向量检索 / reranker | 页数少时关键词足够；等页面过千再考虑 embedding |

---

## 8. 风险与下一步

**风险**

- **模型幻觉**：wiki 页面可能写错。缓解：引用必须来自证据、只写变化、面板可删、Markdown 可审计；但还没有 Linger 那种“重写必须保留旧引用”的强校验。
- **成本**：夜间最多 5 页 × 1 次 + 规则 + 日结 + 摘要，约 8 次小调用/天；没有 key 时全本地。
- **隐私**：夜间整理会把聊天文本和活动摘要发给模型；证据文本现在会做常见密钥/联系方式/证件脱敏，但截图本身仍可能含敏感内容，也没有静态加密。
- **规则过拟合**：一次“别提醒”可能只是当时忙。已经用“明确表达才立即生效、含糊两次才升级、可暂停”来降低；仍建议观察一周。
- **文件重复**：页面改名后旧 Markdown 不会自动删；目前接受，删除页面也不删文件（面板有提示）。

**下一步（按价值排序）**

1. **周报**：日结已经有了，按周聚合 wiki + 活动，生成可粘贴的周报（技能已预留 `weekly-review`）。
2. **任务委派 + 审批**：先做“只读任务”（整理、检索、生成草稿），高风险动作走审批卡。
3. **记忆评测**：拿 LoCoMo 或自建 30 个“上周那个决定是什么”问题，量化 wiki 检索的召回；Linger 的 95% 是目标，不是现状。
4. **更强的引用校验**：重写 summary 时，检查旧引用是否仍然出现；不出现必须给 `removed_refs` 理由。
5. **语义检索**：页面数超过 ~300 后再上 embedding；现在关键词 + 名称/别名已经够快。
6. **技能市场/导入**：支持从 URL 或目录导入技能，带来源和启用开关。

---

## 9. 代码地图

| 模块 | 职责 |
|---|---|
| `src/main/wiki.ts` | 页面草稿合并、引用校验、条目上限、Markdown、搜索 |
| `src/main/proactiveRules.ts` | 规则匹配、时间窗、显式反馈解析、线索升级 |
| `src/main/skills.ts` | frontmatter 解析、目录扫描、按需读取 |
| `src/main/dreaming.ts` | 夜间整理编排、证据过滤、本地兜底、文件输出 |
| `src/main/memory.ts` | SQLite：wiki / rules / clues / deliveries / reports / runs |
| `src/main/deepseek.ts` | 实体路由、页面写作、反馈判断、规则学习、日结、摘要 |
| `src/main/brain.ts` | 上下文注入、工具、主动门控、反馈学习、定时入口 |
| `src/renderer/KnowledgePanel.tsx` | 知识面板：日结、wiki、规则、技能 |

单测：`scripts/test-wiki.mjs`、`test-proactive-rules.mjs`、`test-skills.mjs`、`test-dreaming.mjs`。
