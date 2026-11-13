# DeskMate 竞品检索与竞争格局

> 注：这份是商业竞品视角。个人自用、陪伴与长期记忆的设计借鉴，见 [companion-memory-notes.zh-CN.md](companion-memory-notes.zh-CN.md)。

> 检索时间：2026-11-12  
> 范围：macOS 桌面 AI 伴侣 / 桌宠 / 桌面 Agent，重点是与 DeskMate 争夺“程序员工作场景”的产品。  
> 方法：GitHub API（star 数为 2026-11-12 快照）、产品官网与官方文档、Steam 商店页、中文科技媒体。  
> 说明：下文事实尽量附来源；判断部分会明确写成“判断”。部分产品没有公开数据，标为“未确认”。

---

## 0. 五条结论

1. **赛道已经分裂成两条主线。**  
   一条是“能干活的 Claw / 桌面 Agent”：OpenClaw（39.4 万 star）、WorkBuddy、Kimi Work、DeskClaw、cc-haha；另一条是“陪你的 Pet”：ChatGPT Pets、Desktop Companion、Miru、Open-LLM-VTuber、AIRI。DeskMate 站在中间：**陪程序员工作，但不替程序员干活**。

2. **最大的威胁不是另一个桌宠，而是平台把“宠物 + 屏幕 + 语音 + 记忆”内置。**  
   OpenAI 已在 ChatGPT 桌面端（macOS/Windows）做浮动 Pet：可置顶、可语音开聊、显示任务状态、macOS 上按左右 Command 抓 Appshot 发给 Pet、Computer Use 画中画可跟随 Pet。Codex CLI 也有终端 Pet。形象层正在被商品化。

3. **最接近 DeskMate 的产品是 Miru 和 Desktop Companion。**  
   Miru：macOS Live2D + 30 秒屏幕感知 + 可审计 Markdown 记忆 + 主动“什么时候该说话”的注意力系统，Apache-2.0，自带 API key，成本 < ¥2/天。Desktop Companion：Windows、Live2D/VRM、屏幕视觉、长期记忆、语音、本地 AI，$12.90 买断。

4. **“好看 + 好评”不等于能活。**  
   米哈游 BSide: Olivia Lin 上线 28 天即宣布停运：Steam 1,500+ 评测、81% 好评、峰值 5,000+ 同时在线，仍然关闭。纯陪伴的留存、成本与内容供给，比“做得可爱”难得多。

5. **真正的空白仍然是“程序员工作状态 + 打断时机”。**  
   大多数产品只有截图/窗口标题，或者只看 coding agent 的状态；很少有人把 Git、测试、终端、IDE 的结构化信号做成“什么时候该闭嘴”的策略。DeskMate 的机会是成为**最懂什么时候不说话的工作搭子**，而不是又一个会看屏幕的 Live2D。

---

## 1. 竞争边界：用户不选 DeskMate 时会选什么

DeskMate 当前的能力组合（按 README 与代码）：

- macOS 透明置顶 Live2D（Haru）
- 前台窗口 + 当前显示器整屏截图 + macOS Vision 本地 OCR
- SQLite + FTS5 长期记忆
- DeepSeek 文本/视觉 + 工具调用（remember / search_memory / scan_screen / set_dnd）
- 主动策略：5 分钟冷却、连续专注 25 分钟、空闲 10 分钟、勿扰、视觉预算
- 测试红→绿祝贺
- macOS `say` 朗读

用户如果不选它，会走四条替代路径：

| 替代路径 | 代表产品 | 用户为什么选它 |
|---|---|---|
| 平台自带宠物 | ChatGPT Pets（含 Codex CLI 终端 Pet） | 已经在用 ChatGPT/Codex，无需再装一个产品、通常无额外费用、有屏幕和语音 |
| 工作型 Agent 桌宠 | DeskClaw、WorkBuddy、Kimi Work、cc-haha | 不只是陪聊，能真的操作浏览器/文件/应用 |
| 陪伴型桌宠 | Desktop Companion、Miru、Open-LLM-VTuber、AIRI | 形象更好、语音更完整、角色/记忆更深 |
| 屏幕感知助手 | Everywhere、Wezzly、ChatGPT/Claude Computer Use | 能看屏幕并直接帮忙做事，工具属性更强 |

**判断：DeskMate 目前对四类用户都不够“极端”。**  
对想要工具的人，它不能替你干活；对想要陪伴的人，它的角色/语音/内容还不够深；对想要平台宠物的人，它有安装和权限成本；对想要工作搭子的人，它的工作信号还不够硬。这是“中间态”的典型风险。

---

## 2. 竞品全景：象限与分层

```
                      程序员 / 工作
                           ▲
      DeskMate · Miru      │      Clawd on Desk · AgentPet
                           │      cc-haha · DeskClaw
   陪伴 / 情感 ◄───────────┼───────────► 工具 / 执行
      AIRI · OLVT          │      ChatGPT Pets · OpenClaw
      BSide · Desktop      │      WorkBuddy · Kimi Work
      Companion            │
                      通用 / 生活
```

DeskMate 的目标象限是**左上：陪伴 + 程序员/工作**。这个象限目前最空，但也不是无人：Miru 从“生活陪伴”往这边靠，Clawd/AgentPet 从“agent 状态”往这边靠，DeskClaw 从“工具”往这边靠。窗口期不会太长。

### 2.1 平台级（降维打击）

| 产品 | 它做了什么 | 对 DeskMate 的挤压 |
|---|---|---|
| **ChatGPT Pets**（OpenAI，macOS/Windows） | 浮动宠物置顶于其他窗口；点它打字/语音开聊；显示 Running / Needs input / Ready / Blocked；macOS 按左右 Command 抓 Appshot 发给 Pet；Computer Use 画中画可跟随；支持自定义 sprite | 分发、模型、语音、屏幕上下文全都有；对只想“有只看屏幕的宠物”的用户，很难有理由再装一个 |
| **OpenClaw**（39.4 万 star，MIT） | 本地 AI 执行网关；通过 WhatsApp/Telegram/飞书等聊天软件下指令；持久记忆、cron/心跳、技能生态；macOS/Windows/Linux 桌面 App | 把“大脑 + 记忆 + 主动”做成免费开源基础设施；DeskMate 不能在这一层竞争 |
| **WorkBuddy**（腾讯，2026-03-09） | 桌面 Agent 工作台；微信远程、兼容 OpenClaw 技能体系；办公空间里有会眨眼/打瞌睡的 Buddy | 大厂分发 + 微信入口 + 免费额度；QClaw 已挂出“迁移到 WorkBuddy / 停服”入口 |
| **Kimi Work**（月之暗面，macOS/Windows） | 本地文件夹、浏览器自动化、cron、Agent 集群；桌面宠物有表情、气泡、任务完成/失败通知 | 同平台（macOS）、同“工作”场景、Kimi 会员体系；宠物是 Agent 的功能，不是单独产品 |

> **“Claw”已经泛滥。** 2026 年国产 Claw 至少包括：腾讯 WorkBuddy/QClaw、月之暗面 KimiClaw、MiniMax MaxClaw、智谱 AutoClaw、字节 ArkClaw、百度 DuClaw、阿里云 JVS Claw、傅盛 EasyClaw、网易有道 LobsterAI、阿里云 CoPaw、NoDesk DeskClaw 等。  
> 这意味着“能操作电脑的桌面 Agent”已进入同质化/补贴阶段。DeskMate 不应把“能干活”作为主卖点，否则会直接进入一场打不赢的军备竞赛。

### 2.2 直接竞品（同一使用场景）

| 产品 | 平台/形态 | 关键能力 | 价格/热度 | 威胁 |
|---|---|---|---|---|
| **Miru** | macOS/Windows/Android；Live2D | 30 秒屏幕感知；Markdown 可审计记忆（项目/人物/自己/话题）；注意力系统决定是否开口；BYOK | Apache-2.0；198 star；< ¥2/天 | 高 |
| **Desktop Companion** | Windows；Live2D/VRM | 屏幕视觉、长期记忆、语音、9 个角色、本地 AI、工具（搜索/读网页/写文件/开应用） | $12.90 买断；Steam 21 评测/71%；需 10GB 显存 | 中高 |
| **DeskClaw** | macOS；螃蟹桌宠 | 操作浏览器/文件/本地应用；本地运行；多模型（MiniMax/Kimi/GLM/Qwen/DeepSeek）；飞书/钉钉/企微 | 个人版内测；企业版开源；据媒体报道获近亿元融资 | 高 |
| **Clawd on Desk** | macOS/Windows/Linux；像素宠物 | 20+ coding agent 状态、12 种动画、权限气泡、Telegram/飞书远程审批、Codex Pet 导入 | AGPL；6.7k star；免费 | 中高 |
| **AgentPet** | macOS/Windows/Linux；像素宠物 | 菜单栏监控多 agent；宠物随 token/会话成长；离线 | MIT；405 star；免费 | 中 |
| **cc-haha** | 跨平台；桌面工作台 + 宠物 | 多 Agent 协作、Git Worktree、Diff、技能市场、Computer Use、任务感知宠物 | 15.4k star；免费（license 未明确） | 中高 |
| **Open-LLM-VTuber** | 跨平台；Live2D | 实时语音、语音打断、屏幕/摄像头视觉、主动说话、桌面宠物模式、离线 | 14.7k star；免费开源；长期记忆暂时移除 | 中 |
| **AIRI** | 跨平台/Web；Live2D/VRM | 自托管、实时语音、Minecraft/Factorio、角色生态 | 51.3k star；MIT；免费 | 中（娱乐向） |

### 2.3 参照与警示

| 产品 | 事实 | 启示 |
|---|---|---|
| **BSide: Olivia Lin**（米哈游） | 2026-07-13 Steam 抢先体验；免费；钢琴少女“林离”；1,500+ 评测/81% 好评；峰值 5,000+；2026-08-11 宣布停运（28 天）；8/27 离线版；8/31 下架 | 高 polish + 高好评 ≠ 留存/商业模型；纯陪伴的云成本、内容供给、新鲜感衰减都很硬 |
| **Everywhere** | 6.3k star；屏幕感知助手；当前 App 上下文 + 多 LLM + MCP 工具 | “看见屏幕”本身不是壁垒，能行动才是 |
| **Wezzly** | Mac/Windows；看屏幕、点击、输入、跑命令 | 早期产品，公开数据少；但方向是“看屏幕 + 执行”，会分流“想要工具”的用户 |
| **HakkoAI** | 游戏 AI 伴侣；场景识别、实时语音、跨游戏记忆 | 屏幕感知 + 语音 + 记忆已在游戏场景商品化；工作场景只是换皮机会 |
| **Desktop Mate / Bongo Cat / Tiny Pasture** | Steam 桌面宠物复兴；3D 角色、输入镜像、放置农场 | 用户对“桌面常驻角色”的接受度已被验证；但它们是基线，不是竞品 |

---

## 3. 六个必须盯的对手

### 3.1 ChatGPT Pets：最大变量

**它是什么：** OpenAI 在 ChatGPT 桌面端（macOS/Windows）加入的浮动宠物。它可以浮在其他窗口上方，用户点它就能打字或语音开聊；宠物显示当前任务的 Running / Needs input / Ready / Blocked；macOS 上同时按左右 Command 可以把当前 App 的 Appshot 发给宠物并开新对话；Computer Use 的画中画窗口可以挂在宠物旁边；支持用 `hatch-pet` 技能生成自定义宠物。

**为什么危险：**

- 分发：ChatGPT 桌面端已经装在很多开发者的机器上。
- 场景：屏幕截图、语音、任务状态、Computer Use 全都有。
- 成本：随 ChatGPT 订阅/工作区提供（受账号与工作区开关限制），用户不需要再为“宠物”单独付费。
- 生态：Codex CLI 有终端 Pet，社区已有大量第三方 Codex Pets 包（第三方目录称 3,300+）。

**它不做什么：**

- 不理解你的 Git 分支、测试结果、终端退出码。
- 不会主动评价“你追了这个 race condition 一上午”。
- 不是 Live2D 人格，不强调角色关系和长期陪伴。
- 默认云端，不是本地优先/可审计记忆。

**判断：** ChatGPT Pets 会把“桌面宠物”变成 ChatGPT 的内置功能（受账号/工作区开关限制）。DeskMate 不能和它比“有宠物、能看屏幕、能语音”，只能比“懂程序员的工作、知道什么时候不说话”。

### 3.2 OpenClaw：把“大脑”变成免费基础设施

**事实：** 39.4 万 star、MIT、macOS/Windows/Linux 桌面 App；通过 WhatsApp/Telegram/飞书等聊天软件接收指令；持久记忆、cron/心跳、技能生态；官网明确“No subscription. No hosted tier.”。

**判断：** OpenClaw 证明“记忆 + 主动 + 工具”已经开源免费。DeskMate 如果只做“会记事的桌宠”，会被它降维打击。反过来，OpenClaw 没有视觉形象/桌宠层，也没有“工作节奏感”，这是 DeskMate 可以补的层——但前提是 DeskMate 真的懂工作，而不是只懂截图。

### 3.3 Miru：最像 DeskMate 的开源克隆

**事实：** macOS/Windows/Android；Live2D；默认每 30 秒看一次屏幕，没变化就跳过；记忆是可直接打开/导出/删除的 Markdown（项目、人物、自己、话题）；“注意力系统”读取屏幕和节奏，判断此刻该不该开口；Apache-2.0；BYOK，推荐配置 < ¥2/天；198 star。

**判断：** Miru 已经覆盖了 DeskMate 大部分“陪伴 + 屏幕 + 记忆 + 主动”的卖点，而且记忆可审计、跨设备。DeskMate 相对它的差异只剩：**中文、macOS 原生完成度、程序员工作信号、隐私/预算策略**。如果 Miru 下一步接 Git/测试/终端，DeskMate 的开源替代性会非常强。

### 3.4 DeskClaw：会干活的桌宠，且有钱

**事实：** 杭州 NoDesk AI（杭州没有桌子人工智能科技有限公司，2025-02 成立）；2026-02-14 个人版首版，03-07 企业版开源；螃蟹桌宠；能操作浏览器、读写文件、调用本地应用；本地运行；支持 MiniMax/Kimi/GLM/Qwen/DeepSeek；深度适配飞书/钉钉/企微；目前仅 macOS；据媒体报道获近亿元融资（高途、湖畔山南、初心资本、顺福资本等），团队来自豆包/千问/夸克/智谱，14 天做出首版。

**判断：** DeskClaw 是“工具 + 桌宠”的最强组合：它有 DeskMate 没有的行动能力，又有 DeskMate 想做的桌宠形态。对“想要一个能帮忙的桌面搭子”的用户，DeskClaw 的说服力更强。DeskMate 不应该和它比“能干活”，而应该比“懂你什么时候不需要干活”。

### 3.5 Desktop Companion：付费桌宠的定价锚

**事实：** Windows；$12.90 买断；Steam 2026-10-15 抢先体验；21 条评测/71% 好评；9 个角色；Live2D/VRM；屏幕视觉；长期记忆；语音；本地 AI；需 10GB+ 显存；工具包括网页搜索、读网页、写 docx/xlsx、开应用。

**判断：** 它证明“桌面伴侣”有人愿意付一次钱，但也暴露了天花板：Windows only、硬件门槛高、评测量小、偏娱乐/陪伴。DeskMate 如果定价，$10–20 买断是合理锚点；但必须比它更懂工作，否则用户会选角色更多、语音更成熟的它。

### 3.6 BSide：不要高估“可爱 + 好评”

**事实：** 米哈游 BSide: Olivia Lin，2026-07-13 Steam 抢先体验，免费；钢琴少女“林离”；1,500+ 评测、81% 好评、峰值 5,000+；2026-08-11 宣布停运，距上线 28 天；8/27 离线版，8/31 下架。

**判断：** 这不是“做得不好”导致的失败，而是“纯陪伴产品”的结构性问题：新鲜感衰减、内容供给成本、云推理/语音成本、缺少工作流粘性。DeskMate 如果走“情感陪伴”路线，会面对同样的曲线；走“工作搭子”路线，才有日常必用的理由。

---

## 4. 功能对标矩阵

> ✅ = 公开资料明确；◐ = 部分/需配置；? = 未确认；— = 没有。

| 能力 | DeskMate | Miru | Desktop Companion | ChatGPT Pets | Kimi Work | DeskClaw | Open-LLM-VTuber | Clawd on Desk |
|---|---|---|---|---|---|---|---|---|
| Live2D / VRM 形象 | ✅ Live2D | ✅ Live2D | ✅ Live2D/VRM | ◐ sprite | ◐ 宠物 | ✅ 螃蟹 | ✅ Live2D | ◐ 像素 |
| 屏幕感知 | ✅ 整屏截图 | ✅ 30s | ✅ | ◐ 手动 Appshot | — | — | ✅ 屏幕/摄像头 | — |
| 本地 OCR | ✅ Vision | ? | — | — | — | — | — | — |
| 长期记忆 | ✅ SQLite FTS | ✅ Markdown | ✅ | ✅ ChatGPT memory | ◐ 任务上下文 | ? | ◐ 聊天记录（长期记忆暂移除） | ◐ 会话 recap |
| 主动说话 | ✅ 规则 | ✅ 注意力系统 | ✅ | ◐ 状态/通知 | ◐ 任务通知 | ? | ✅ | ✅ 状态 |
| 打断时机策略 | ◐ 冷却/勿扰/预算 | ✅ | ◐ | — | — | — | ◐ | ◐ 权限气泡 |
| Git/测试/终端信号 | ◐ 仅窗口+OCR | — | — | — | ◐ 任务状态 | — | — | ◐ agent hooks（间接） |
| 语音 | ◐ 仅 TTS | ? | ✅ | ✅ | ? | ? | ✅ | — |
| 工具调用 | ✅ 4 个 | ? | ✅ | ✅ Computer Use | ✅ 浏览器/文件/cron | ✅ 浏览器/文件/应用 | ◐ | ◐ 审批 |
| 本地优先 | ◐ 记忆本地，截图上云 | ✅ | ✅ | — | ◐ 文件本地，模型云 | ✅ | ✅ | ✅ |
| macOS | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 价格 | 自用/未定价 | 免费 + BYOK | $12.90 买断 | 随 ChatGPT | 会员/免费额度 | 内测/企业开源 | 免费开源 | 免费开源 |

**矩阵读法：**

- DeskMate 的“广度”不错，但几乎没有一项是独占的。
- 唯一可能独占的列是“Git/测试/终端信号”，而 DeskMate 目前也只有 ◐（窗口 + OCR），并没有真正拿到结构化工作信号。
- Miru 在“陪伴 + 屏幕 + 记忆 + 主动”上已经接近满分；DeskClaw/ChatGPT 在“工具/分发”上更强；Clawd 在“coding agent 状态”上更强。
- 因此，DeskMate 的差异化不能是“更多功能”，只能是“更深的工作理解 + 更好的时机”。

---

## 5. 竞争结论：护城河在哪

### 5.1 已经被商品化的能力

- Live2D/VRM 形象、透明置顶、点击穿透
- TTS/ASR、语音打断
- 屏幕截图 + VLM 理解
- 长期记忆（SQLite/向量/Markdown）
- 主动说话、cron/心跳
- 工具调用、MCP

这些都不构成壁垒。Open-LLM-VTuber、AIRI、Miru 已经开源；OpenAI、腾讯、月之暗面已经把宠物/Agent 层内置或补贴。

### 5.2 仍然稀缺的能力

1. **工作状态理解**：不是“屏幕里有什么”，而是“他在做什么、卡在哪、有没有进展”。需要 Git 分支/diff、测试结果、终端退出码、IDE 诊断、窗口切换/空闲等结构化信号，而不是只靠截图。
2. **打断时机**：什么时候说、说多少、说完怎么退。需要“价值 − 打扰成本”的打分、冷却、预算、用户反馈学习；沉默必须是一等动作。
3. **可信隐私**：本地优先、可见、可删、可导出、按小时预算、敏感应用排除。对国内开发者和内网环境尤其重要。
4. **程序员关系记忆**：项目、bug、决策、偏好、上次的 failing test；不是“今天天气”和“角色好感度”。

### 5.3 不是护城河的东西

- 默认 Haru 模型
- DeepSeek 视觉
- macOS 透明窗
- “可爱”“治愈”的文案
- 红→绿祝贺本身（很容易被复制）

### 5.4 竞争位置判断

DeskMate 现在最容易陷入的定位是：

> “一个会看屏幕、会说话、有记忆的 Live2D 桌宠。”

这个定位的竞争对手太多，而且每个维度都有更强的选手。更锋利的位置是：

> “一个知道你今天在追哪个 bug、什么时候该闭嘴的 macOS 工作搭子。”

前者卖的是“形象”，后者卖的是“判断”。前者会被平台免费化，后者才有机会形成数据和策略壁垒。

### 5.5 威胁排序（判断）

1. **ChatGPT Pets / Codex Pets**：分发和模型最强，已经把“桌面宠物 + 屏幕 + 语音 + 任务状态”变成内置能力。
2. **OpenClaw 生态里出现桌宠前端**：只差一层“脸”，而脸是最容易被补上的。
3. **DeskClaw / WorkBuddy / Kimi Work**：有行动能力、有资金/分发，能从“工具”侧吸走想要实用价值的用户。
4. **Miru**：开源、macOS、屏幕 + 记忆 + 主动时机都已有；只差“程序员工作信号”。
5. **纯陪伴产品的留存曲线**：不是某个竞品，而是整个“可爱但没用”品类的自然衰减；BSide 是样本，不是孤例。

---

## 6. 建议：接下来 6 周做什么

### P0：把“工作信号”做成真的（2–4 周）

1. **Git 信号**：当前分支、dirty、最近 commit、diff 行数；只读本地 `.git`，不上传文件内容。
2. **测试信号**：监听测试命令的输出/退出码，识别 fail→pass、pass→fail、同一测试连续失败；这是“红→绿祝贺”从 mock 变成真实证据的关键。
3. **终端信号**：命令、cwd、退出码、错误首行；不存完整 stdout，密钥正则过滤。
4. **前台窗口/空闲**：已有，补齐“同一错误反复出现”“窗口切换频繁”“长时间无输入”等卡点特征。

> 不建议一开始做 VS Code/JetBrains 插件：安装成本高、覆盖面窄。先用 shell hook + git + 测试 watcher 拿到 80% 的信号。

### P0：把“证据链”做出来（2–4 周）

每一句主动话都能点开“为什么这么说”：

- 看到了什么（窗口/OCR 行/Git 状态/测试结果）
- 判断是什么（卡住/进展/完成）
- 为什么现在说（冷却/预算/价值分）
- 用户反馈（有用/别说了/稍后）

这既是信任，也是后续策略学习的数据。

### P0：把“打断策略”从规则升级为打分（2–4 周）

- `score = value - interruption_cost`
- value：进展/卡点/健康/节点（测试绿、commit、长时间专注）
- cost：正在输入、全屏、会议、勿扰、最近被忽略、今天已说次数
- 学习：忽略/关闭/回复分别更新该场景的权重
- 默认沉默；连续忽略 2 次后，该类事件降频或静默

### P1：把 macOS 产品化补齐（4–8 周）

- DMG、签名/公证、登录自启
- 首次权限引导（Screen Recording / Accessibility）
- 多显示器贴边/吸附
- 语音输入 push-to-talk；`say` WAV + 振幅口型
- 崩溃/日志/隐私面板

### P1：记忆 schema 面向工作（4–8 周）

- 项目、bug、决策、偏好、承诺
- 每条记忆带来源、置信度、最后使用时间
- 支持导出/删除/一键清空
- FTS + 轻量语义检索（不必一上来上向量库）

### P2：集成与商业化（8 周+）

- GitHub Actions/CI 结果、issue/PR 状态
- 可选的 VS Code/JetBrains 轻插件（只传路径/诊断统计）
- 语音包/角色包；open-core
- 定价锚点：免费本地/BYOK；云视觉/同步订阅；买断支持者版 $12–20

---

## 7. 需要盯的信号（竞品触发点）

| 信号 | 含义 | 应对 |
|---|---|---|
| ChatGPT Pets 加入“主动工作评论”或屏幕常驻感知 | 平台开始吃“工作搭子”场景 | 退到更深的垂直：调试/CI/代码评审；或做 ChatGPT 的“人格/工作上下文”插件 |
| OpenClaw 出现官方 Live2D/桌宠前端 | “大脑 + 脸”被打通 | 做 OpenClaw 的“程序员工作状态”插件/前端，而不是竞争通用 Agent |
| Kimi Work / WorkBuddy 加入 Git/测试信号 | 大厂进入同一细分 | 加快 macOS 原生体验 + 隐私/本地化差异；绑定个人开发者而非企业 |
| DeskClaw 加入“程序员模式” | 工具型对手补陪伴 | 强调“不替你干活，但懂你”；做深度调试陪伴 |
| Miru 加入 Git/测试/终端 | 开源克隆补齐最后一块 | 竞争 macOS 完成度、中文、隐私预算；或考虑合并/合作 |
| BSide 类产品再次出现并稳定运营 | 纯陪伴模型被验证 | 重新评估“情感陪伴”支线，但不放弃工作主线 |

---

## 8. 一句话定位（可直接用于 README / 落地页）

**中文：**  
> 不是另一个会看屏幕的桌宠，也不是替你写代码的 Agent。DeskMate 是坐在 macOS 屏幕边上的工作搭子：它记得你追过的 bug，看得懂测试红绿，知道什么时候该闭嘴。

**英文：**  
> Not another screen-aware desktop pet. Not another coding agent. DeskMate is a macOS work companion that remembers the bug you chased, reads the red-to-green, and knows when to shut up.

---

## 9. 来源

### 官方文档 / 产品页

- OpenAI, *Pets*（ChatGPT 桌面端/Codex CLI 宠物）: https://learn.chatgpt.com/docs/pets
- OpenAI, *Codex*: https://openai.com/codex/
- OpenClaw 官网: https://openclaw.ai/
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- Kimi Work 产品页: https://www.kimi.com/products/kimi-work
- Kimi, *AI 桌宠是什么？2026 年的桌宠，是会干活的动态壁纸*: https://www.kimi.com/resources/what-is-a-desktop-pet
- WorkBuddy 官网: https://www.workbuddy.cn/
- QClaw 官网（含“迁移到 WorkBuddy / 停服”入口）: https://qclaw.qq.com/
- Desktop Companion 官网: https://desktopaicompanion.com/zh
- Desktop Companion Steam 页: https://store.steampowered.com/app/4864680/Desktop_Companion/
- Miru GitHub: https://github.com/kiyotakali/Miru
- Open-LLM-VTuber GitHub: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- AIRI GitHub: https://github.com/moeru-ai/airi
- Clawd on Desk GitHub: https://github.com/rullerzhou-afk/clawd-on-desk
- AgentPet GitHub: https://github.com/ntd4996/agentpet
- cc-haha GitHub: https://github.com/NanmiCoder/cc-haha
- Everywhere GitHub: https://github.com/Sylinko/Everywhere
- awesome-ai-companion（生态清单）: https://github.com/DasterProkio/awesome-ai-companion
- Wezzly: https://wezzlycompanion.com/
- HakkoAI: https://www.hakko.ai/

### 媒体 / 评测

- 17173，《米哈游〈BSide: Olivia Lin〉官宣停运：上线不到一个月，AI女友留不住！》，2026-08-11: https://news.17173.com/content/08112026/172800822.shtml
- 中关村在线，《米哈游推AI桌面伴侣BSide：Olivia Lin，打造拟真钢琴少女陪伴体验》，2026-07-14: https://ai.zol.com.cn/1215/12157554.html
- 百家号，《14天造出“桌宠” DeskClaw：NoDesk AI的极限冲刺与AI原生野心》，2026-03-09: https://baijiahao.baidu.com/s?id=1861526280518044825
- 百家号，《杭州企业两周打造DeskClaw项目，成功获近亿融资》，2026-03-11: https://baijiahao.baidu.com/s?id=1859297633434394329
- CSDN，《全网“龙虾”大盘点，腾讯、Kimi、阿里都下场了！哪只“龙虾”最好养？》，2026-10-02: https://blog.csdn.net/AGI_Eval/article/details/159125430
- 腾讯云开发者社区，《2026 年最值得安装的桌面 AI 应用 Top 10》，2026-04-21: https://cloud.tencent.com/developer/article/2657765
- Unstore, *Best AI desktop companion apps in 2026 (we tested 8 on desktop)*, 2026-06-25: https://unstore.io/discover/best-apps-for-ai-desktop-companions-desktop/
- 什么值得买，《2026桌宠怎么选？三款AI效率伴侣实测，别被可爱骗了》，2026-06-07: https://post.smzdm.com/p/ae6pneo4/

### 数据快照

- GitHub star 数：通过 GitHub REST API 于 2026-11-12 获取（OpenClaw 394,381；AIRI 51,310；cc-haha 15,416；Open-LLM-VTuber 14,681；Clawd on Desk 6,728；Everywhere 6,352；AgentPet 405；Miru 198）。
- Steam 评测/价格：Steam 商店页，2026-11-12 访问（Desktop Companion 21 条/71%，$12.90）。
- BSide 评测/在线峰值：中关村在线 2026-07-14（547 条/84%，峰值 5,000+）；17173 2026-08-11（1,500+ 条/81%，停运）。

---

## 10. 方法与局限

- 本次 `web_search` 接口返回 401（搜索端点 key 无效），因此改用产品官网、官方文档、Steam 页、GitHub API/Raw、Bing/Baidu 结果页直接抓取。部分中文产品只有二手媒体来源，已在文中标注“据媒体报道”。
- GitHub star、Steam 评测、价格都是 2026-11-12 的快照，会变化。
- 未对每个产品做真机体验；功能对比以公开资料为准，标 `?` 的表示未确认。
- 竞品判断是分析，不是事实；建议用 1–2 周做 5 个目标用户的快速验证，再决定是否调整定位。
