# Personal Agent 项目全景（2026-11 快照）

> 检索时间：2026-11-23
> 范围：以“通用个人助理型 Agent”为主——能接消息、有记忆、能自己开电脑干活、会主动找你；兼顾开源与闭源、国内与海外、端侧与云端。
> 与既有文档的关系：`docs/deskmate-competitors.zh-CN.md` 是“桌宠 / 桌面伴侣”视角的商业竞品分析；本文是“个人 Agent 大生态”视角，覆盖 2026 年 9–11 月这一波集中发布，两者互补。
> 方法：GitHub API（star 数为 2026-11-23 快照）、产品官网/官方博客、Hacker News Algolia、Google News RSS（中英文）、百度检索。事实尽量附来源；媒体标题转述会标“据报道”；判断段落明确写“判断”。

---

## 0. 六条结论

1. **2026 是“个人 Agent 元年”，而且节奏是“开源引爆 → 大厂收割”。**
   OpenClaw 在 2026-01 改名后一路涨到 **39.5 万 star**，把“消息入口 + 自己的电脑 + 记忆 + 主动执行”这套形态做成了事实标准；随后 Meta（Muse，9/8）、OpenAI（dots，9/29）、Anthropic（Claude Duet，10/21）、Google（Gemini Tasks，11/17）在六周内全部落子，微软更早（Scout，6/2）。

2. **产品形态高度收敛为“四件套”：消息入口、云端/本地电脑、长期记忆、主动执行 + 审批。**
   差别主要在“电脑在哪”（云 VM / 本地 / 混合）、“入口在哪”（iMessage、WhatsApp、Slack、Teams、短信、语音）、“权限给到哪”（只读 / 审批 / 自动）。

3. **开源侧出现“两周复刻”现象。**
   dots 发布当天就有 `open-dot`；Instinct 火了之后出现 `OpenInstinct`、`open-instinct`；Muse/Grok Bot/dots 的共同替代品 `xiryn`、`noodle` 也在数周内出现。个人 Agent 的“功能”本身几乎没有壁垒，壁垒在分发、信任、生态接入和成本。

4. **竞争焦点已经从“能不能做”转向“身份、支付、协议、审计”。**
   Sierra + Meta 牵头 **Personal Agent Protocol**（10/6，OAuth 会话 + 商家可控授权），Google 推 **AP2** 与 UCP，OpenAI 发 **ChatGPT Wallet**，1Password 发 **1Password for Agents**，微软用 Entra 给每个 Agent 独立身份。谁能让商家“敢让 Agent 下单”，谁就拿到下一层入口。

5. **安全事故是这一轮的主线，不是花边。**
   Muse 被曝可导出 6.8GB 运行目录、串会话、泄露私人数据并被起诉；Grok Bot 把 CEO 银行信息发进公开 Slack；OpenClaw 出现 575 个恶意 skill、CVE-2026-33579、以及 Anthropic/Google 对订阅用途的限制。**“能干活”与“敢让它干活”之间的鸿沟，就是当前产品的真实护城河。**

6. **中国是大厂追赶 + 开源狂欢 + 生态抵抗同时发生。**
   阿里“千问Go”、字节“Spell/豆包”、腾讯都在 10 月被曝加速；OpenClaw 在 3 月引发“养龙虾”热潮后于 10 月降温；豆包/千问的 Agent 代操作遭到 155–166 款 App 拒绝。中国市场的特殊约束是**超级 App 的围墙**，而不是模型能力。

---

## 1. 分类框架

按“谁在替用户执行”和“执行环境在哪”，可以分成七层：

| 层 | 形态 | 代表 | 关键差异 |
|---|---|---|---|
| L1 本地优先 runtime | 装在自己电脑/服务器，接自己的模型 | OpenClaw、Hermes、nanobot、CowAgent、QwenPaw、moltis、Linger | 数据主权、可换模型、成本可控；安装/权限门槛高 |
| L2 云电脑型助理 | 厂商给每个用户一台云 VM | Muse、dots、Claude Duet、Instinct、Grok Bot、Manus | 开箱即用、跨设备；隐私与锁定风险 |
| L3 办公套件内嵌 | 长在 Teams/Outlook/Gemini 里 | Microsoft Scout / Copilot Autopilot、Gemini Tasks | 分发无敌、身份/权限现成；跨出套件就弱 |
| L4 垂直场景 | 金融、交易、情报、招聘 | Vibe-Trading、DojoAgents、Crucix、open-net-worth | 数据/合规壁垒；天花板明确 |
| L5 团队/企业 | 给每个员工一个受管 Agent | onecli、Town、OpenHarness/ohmo | 审计、SSO、沙箱；决策链长 |
| L6 端侧/硬件 | 手机、PC、眼镜、挂件、$5 芯片 | nanoMuse、Andee、MimiClaw、Muse Charm | 感知真实世界；算力/续航约束 |
| L7 协议/基础设施 | 让 Agent 与商家/身份/支付互通 | Sierra PAP/Poppy、Linq、Phaze、1Password for Agents、Daytona | 标准战；赢家通吃 |

---

## 2. 闭源 / 商业产品

### 2.1 大厂主力

| 产品 | 公司 | 亮相 | 形态与入口 | 可用性 / 定价 | 关键点 |
|---|---|---|---|---|---|
| **Muse** | Meta | 2026-09-08 | iOS/Android/web/Mac，语音+3D 形象，AI 眼镜与 Muse Charm 挂件 | 美国、澳大利亚；基础免费 + 订阅 | Muse Secure VM（每用户独立云电脑）、connectors（Gmail/Calendar/Instagram/OpenTable/Canva 等）、Spaces；据报道 10 月下载量 1090 万；隐私争议与诉讼缠身 |
| **dots** | OpenAI | 2026-09-29 | ChatGPT 桌面/网页/移动 + Slack/Teams，短信“即将” | Pro / Business Premium / Enterprise；11-20 起在 Plus（$20）测试 | 每个 dot 一台云电脑 + 浏览器；4000+ 应用；GPT-6 Astra（11-03 增加 6.1 Terra）；ChatGPT Wallet（11-13） |
| **Claude Duet** | Anthropic | 2026-10-21 | 消息式（文本/语音），独立 App + 云电脑 | 美国 Pro/Max/Ultra 候补名单，研究预览 | 主动早报、收件箱/日历分诊、发票与合同草稿；与 Claude 共享用量额度；强调“知道什么时候不该打扰” |
| **Gemini Tasks**（原 Spark） | Google | 2026-11-17 | Gemini App 内 Chat/Task 切换、短信、邮件转发 `gemini@google.com` | 免费，美/日/韩/加/澳/印 | Gemini 4 Hydrogen；AP2 支付 + Google Pay；60+ Connected Apps；每账号独立 Agent Compute Engine（硬件隔离 VM） |
| **Microsoft Scout** | Microsoft | 2026-06-02 | Teams 内交互 + 桌面 App | Frontier / 私有预览 | **基于 OpenClaw 开源技术**；Entra 独立身份、Purview 策略、Work IQ；9-25 又发布 Copilot “Autopilot” 常驻 Agent |
| **Grok Bot** | xAI（SpaceXAI） | 2026-08-11 | 常驻“AI 同事”，自带云电脑，可操作任意 App | 约 $120/月 | 上线一个月约 41.8 万周活（Bloomberg/Dealroom）；所有 bot 共享一台云电脑与登录态，被批为结构性风险（Tech Times）；11-02 马斯克称成本“相对收入不可持续”，开始限流；10-19 曝出把 CEO 银行信息发进公开 Slack |

### 2.2 创业公司 / 独立产品

| 产品 | 团队 | 亮相 | 形态 | 融资/估值 | 关键点 |
|---|---|---|---|---|---|
| **Instinct** | Spear Street Technology，创始人 Noah Shinn（前 Sierra 研究科学家） | 2026-08 | iMessage / WhatsApp 短信式，接入邮箱、日历、屏幕、位置 | 8 月 $2.5B → 9 月 **$10B**（$1B Series C） | 被视为“OpenClaw 之后最惊艳的消费级 Agent”；ToS 的“永久不可撤销授权”和明文存邮件引发隐私批评 |
| **Town** | Town | 2026 | 个人助理，主打“给整个团队配助理” | 10-19 $108M Series B @ **$1B** | 上线 4 个月即独角兽（Yahoo Finance）；以团队为单位卖，避开纯个人订阅的价格战 |
| **Manus 2.0** | Manus | 2026-09-28 | 桌面 Manus Studio + 云电脑 | 订阅 | 新架构 Cascade（官方称 token -23.2%、时间 -28.2%、成本 -32%）；Cloud Computer、事件触发 Automations |
| **Underdog** | Underdog | 2026-10 | 本地 Mac/Windows（Linux/Android 在路上） | 邀请制 beta | 主打“最忠诚/最私密”，邮件、日历、会议纪要、听写、跑腿全部端侧 |
| **Ollie** | Ollie | 2026-09 | 个人助理 | 未披露 | 以隐私为差异化切入同一赛道 |
| **Poppy / PAP** | Sierra（Bret Taylor、Clay Bavor） | 2026-10-06 / 11-17 | 协议 + 参考实现 | Sierra 自身 $950M @ $15B | Personal Agent Protocol：OAuth 会话、商家可控授权、跨渠道延续；35 家设计伙伴含 BofA、OpenAI、Visa、United |

### 2.3 基础设施与邻近赛道（决定个人 Agent 能做什么）

| 公司/产品 | 时间 | 金额 / 估值 | 做什么 |
|---|---|---|---|
| **Linq** | 2026-11-18 | $90M，a16z 领投 | 让 Agent 能发短信、打电话的通信层 |
| **Phaze** | 2026-11-04 | $8.75M seed，a16z | 给 Agent 一台远程 PC（Parsec 创始人） |
| **Daytona** | 2026-10-20 | $1B 估值 | Agent 沙箱 / “agentic cloud” |
| **1Password for Agents** | 2026-10-22 | — | Agent 能登录，但永远看不到密码 |
| **Wabi** | 2026-10-29 | $1.25B 估值 | 用 Agent 生成 mini app |
| **Model ML** | 2026-11-17 | $250M @ $1.5B | 金融领域的个人 Agent |
| **Tab** | 2026-10 | $300M 估值（上线六周） | 个人助理 |
| **Vayo** | 2026-10-14 | Booking 拟投 $100M | 旅行 Agent |

> 判断：钱正在从“再做一个通用助理”转向“给助理供电/供电脑/供身份/供支付”。这反过来会降低通用助理的门槛，进一步把差异化逼向数据、场景与信任。

### 2.4 中国大厂

| 产品 | 公司 | 时间 | 进展 | 关键点 |
|---|---|---|---|---|
| **千问Go** | 阿里 | 2026-10-13 | 开放体验申请 | 航班延误理赔、淘宝价保退款、跨 App 办事；10-23 上线“我的应用”，不写代码也能生成个人小应用 |
| **Spell + 豆包** | 字节 | 2026-10 据报道 | 未正式发布 | 据报道将 Spell 与豆包结合，做“中国版 Muse”；11-12 再传全新个人助手 |
| **腾讯个人智能体** | 腾讯 | 2026-10 据报道 | 未正式发布 | 与字节同期被曝加速 |
| **Apple** | Apple | 未发布 | Siri 重构中 | 被中文媒体称为“最后一个入局的巨头”；Bloomberg 11-08 称仍在探索更激进的 AI 战略 |

> 判断：国内产品的能力差距不在模型，而在**入口与生态授权**。豆包/千问的 Agent 代操作在 10 月遭到 155–166 款 App 明确拒绝，说明“跨 App 操作”在中国会长期受制于超级 App 的围墙与合规。

---

## 3. 开源项目

### 3.1 主线（通用个人 Agent）

| 项目 | Stars | 语言 / 许可 | 定位 | 差异点 |
|---|---|---|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | **395.1k** | TS / MIT | 个人 Agent 平台，跑在自己机器上 | 20+ 消息通道 + macOS/iOS/Android/Windows/Linux 原生 App；Gateway 单进程；模型与 harness 均为可替换插件；2025-11 以 Clawd 起步，2026-01-29 改名 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | **265.5k** | Python / MIT | “会成长的 Agent” | Nous Research 出品；内置学习闭环，从经验生成/改进 skill、检索自己的历史对话、跨会话建模“你是谁”；$5 VPS 可跑，Telegram 远程 |
| [nanobot](https://github.com/HKUDS/nanobot) | 50.3k | Python / MIT | 轻量版 OpenClaw | 小核心、低占用；自带 WebUI + TUI；浏览器/终端/聊天 App 三入口；HKUDS 出品 |
| [CowAgent](https://github.com/zhayujie/CowAgent) | 48.0k | Python / MIT | 个人助理 + Agent Harness | 前身 chatgpt-on-wechat；规划、工具、技能、MCP、长期记忆、知识库、自进化；多模型/多通道/多 Agent |
| [QwenPaw](https://github.com/agentscope-ai/QwenPaw) | 38.1k | Python / Apache-2.0 | 阿里系个人助理 | AgentScope 生态；本地/云部署；Skills & Plugins；多 IM 通道 |
| [OpenHarness / ohmo](https://github.com/HKUDS/OpenHarness) | 16.2k | Python / MIT | 轻量 harness + 内置个人 Agent | ohmo 可直接跑在已有 Claude Code / Codex 订阅上，不额外买 API；飞书/Slack/Telegram/Discord 入口，能开分支、跑测试、提 PR |
| [OpenFuse](https://github.com/CopilotKit/openfuse) | 6.6k | TS / MIT | 个人 Agent 的“应用壳” | 浏览器 + 终端 + 文件 + 持续任务；React Native（iOS/Android/web）；兼容任意 harness |
| [Andee](https://github.com/kuafuai/andee) | 6.2k | Kotlin / 自定义 | 住在手机/Mac 里的 Agent | 不用 root、不接 API，直接像人一样点 app、读屏；跨设备 Andee 可互为好友 |
| [MimiClaw](https://github.com/memovai/mimiclaw) | 5.8k | C / MIT | $5 芯片上的 OpenClaw | ESP32-S3 + Telegram，无 Linux/Node，0.5W 常驻；硬件形态的极端轻量版 |
| [Linger](https://github.com/simplexai-labs/linger) | 3.9k | TS / 自定义 | 完全本地跑在自己 PC | PolyStrata 让 125B 模型跑在 12GB 显存 + 64GB 内存；零 token 费；主打“反 Big Tech” |
| [nanoMuse](https://github.com/nano-muse/nanoMuse) | 3.6k | Swift / GPL-3.0 | 多设备个人 Agent | 手机/桌面/网页/relay 全在一个仓库；有名字和形象；App 关闭后仍继续工作；不可逆操作先问 |
| [onecli](https://github.com/onecli/onecli) | 3.7k | TS / Apache-2.0 | 团队版个人 Agent | 每人一个 Agent，沙箱执行，凭据由网关注入、策略强制；K8s Helm |
| [Nod](https://github.com/n8n-io/nod) | 3.1k | TS / Apache-2.0 | 有“自己电脑”的个人 Agent | n8n 出品；追发票、准备通话、取消试用；Mac/Win/Linux；动手前先问 |
| [Moltis](https://github.com/moltis-org/moltis) | 3.0k | Rust / MIT | 安全的常驻 Agent 服务 | 单二进制；每条命令跑在沙箱容器；多模型、语音、自扩展 skill |
| [Talorys](https://github.com/rociiu/talorys) | 1.5k | TS / MIT | 跑在自己 Cloudflare 账号里 | 一条命令部署；无开发者服务器/数据库；聊天、记忆、任务、笔记、定时例程 |

### 3.2 复刻 / 挑战者（大厂发布后数周内出现）

| 项目 | Stars | 对应产品 | 说明 |
|---|---|---|---|
| [open-dot](https://github.com/composio-community/open-dot) | 733 | OpenAI dots | Mac App，OpenAI 模型 + Composio 工具，自带“云电脑” |
| [OpenInstinct](https://github.com/Merit-Systems/OpenInstinct) | 496 | Instinct | iMessage 助理 + 密码库 |
| [open-instinct](https://github.com/mariagorskikh/open-instinct) | 484 | Instinct | 短信式 + 自己的电脑 |
| [xiryn](https://github.com/SouravBeraAkaSpeed/xiryn) | 440 | Muse / Grok Bot / dots | “它们能做的，在你自己的电脑上做” |
| [noodle](https://github.com/pdparchitect/noodle) | 314 | Grok Bot / Muse / dots / Duet | Swift，macOS 原生 |
| [abacusai-bot](https://github.com/abacusai/abacusai-bot) | 614 | 通用 | 免费、接消息应用与工具 |
| [DeepSeekBot](https://github.com/BotHarness/DeepSeekBot) | 968 | Grok Bot | 基于 DeepSeek Harness 的“个人 bot 团队” |

### 3.3 垂直与周边

| 项目 | Stars | 方向 | 说明 |
|---|---|---|---|
| [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) | 38.7k | 个人交易 Agent | 自然语言做策略、回测、执行 |
| [Crucix](https://github.com/calesthio/Crucix) | 12.2k | 个人情报终端 | 27 个开源情报源，15 分钟并行刷新，全本地 |
| [distilly](https://github.com/titanwings/distilly) | 26.8k | 技能蒸馏 | 把“某人的做事方式”蒸馏成可复用 Skills |
| [HanaAgent](https://github.com/liliMozi/openhanako) | 6.9k | 有性格的私人助理 | 中文优先、图形界面、人格模板、多 Agent 同机 |
| [DojoAgents](https://github.com/Alpha-Dojo/DojoAgents) | 3.9k | 个人投资 Copilot | 全市场数据 + 研究 |
| [N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O) | 3.3k | 陪伴型 Agent | 实时语音/视觉、长期记忆、社区养成 |
| [open-net-worth](https://github.com/open-net-worth-ai/open-net-worth) | 696 | 个人财务 | 自托管的预算/净值管理 Agent |
| [tophat](https://github.com/tophat-md/tophat) | — | 可分享的个人记忆 | 本地 SQLite + 端到端加密 + 按 scope 授权，hub 只存密文 |
| [dsh-Go](https://github.com/ccch1mneyyy/dsh-Go) | 30.3k | DSH 的手机壳 | Android 本机跑 DeepSeek Harness，也能一键接管电脑上的 DSH；内置 Linux 环境、免 root |
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | 24.3k | 主动型 coding agent | DeepSeek 官方研究原型：监听 GitHub、主动推进单个仓库的任务 |

> 说明：star 数只代表注意力，不代表质量或可持续性。Hermes 的 26.5 万 star 与其 HN 讨论热度（最高 52 分）严重不匹配，属于“仓库被大量收藏但社区讨论集中在别处”的典型；选型时应看提交活跃度、issue 响应与安全记录。

---

## 4. 时间线（2025-11 → 2026-11）

| 时间 | 事件 |
|---|---|
| 2025-11 | Peter Steinberger 的周末项目 “Clawd”（WhatsApp Relay）诞生 |
| 2026-01-29 | 改名 **OpenClaw**，当时已 10 万 star；同期 Cloudflare 发布 Moltworker（自助托管版） |
| 2026-02-15 | Steinberger 加入 OpenAI（据 TechCrunch/Reuters） |
| 2026-02 | nanobot、MimiClaw、Moltis 等轻量/硬件/安全向复刻集中出现 |
| 2026-03 | 中国“养龙虾”热潮；出现付费安装/卸载生意 |
| 2026-04-03 | Anthropic 停止 Claude Code 订阅用于 OpenClaw；同日曝 CVE-2026-33579 提权漏洞 |
| 2026-06-02 | 微软发布 **Scout**，明确“基于 OpenClaw 开源技术” |
| 2026-07 | Cognition 收购 Poke（早期短信式个人助理） |
| 2026-08-11 | xAI 发布 **Grok Bot** |
| 2026-08 | Instinct 以 $2.5B 估值融资 |
| 2026-09-08 | Meta 发布 **Muse** |
| 2026-09-28 | Instinct $1B Series C @ $10B；Manus 2.0 发布 |
| 2026-09-29 | OpenAI 发布 **dots**；同日出现 open-dot |
| 2026-10-06 | Sierra + Meta 发布 **Personal Agent Protocol**；Underdog 亮相 |
| 2026-10-19 | Town $108M @ $1B |
| 2026-10-21 | Anthropic 发布 **Claude Duet** 研究预览 |
| 2026-10-22 | 1Password for Agents：Agent 登录但不接触密码 |
| 2026-11-02 | Grok Bot 因成本限流 |
| 2026-11-13 | OpenAI 发布 **ChatGPT Wallet** |
| 2026-11-17 | Google 把 Spark 改名 **Tasks** 并免费开放；Poppy/PAP 1.0；Muse 进入澳大利亚 |
| 2026-11-20 | dots 向 ChatGPT Plus（$20）测试；NYT 称 Muse“两个月后没那么惊艳了” |

---

## 5. 技术共识：四件套 + 三层权限

### 5.1 四件套

1. **入口**：iMessage / WhatsApp / Telegram / Slack / Teams / 短信 / 语音 / 邮件转发。独立 App 只是“查看器”，真正的入口是聊天框。
2. **执行环境**：一台“自己的电脑”。云端（Muse Secure VM、dots cloud computer、Duet、Gemini Agent Compute Engine）或本地（OpenClaw、Linger、Underdog、Andee）。共识是**每个用户/每个 Agent 独立隔离**，而不是共享浏览器池。
3. **记忆**：长期偏好 + 项目上下文 + “我是谁”的画像；从“检索历史”进化到“主动沉淀 skill”（Hermes、distilly、CowAgent）。
4. **主动性**：定时（早报、周报）+ 事件（新邮件、日历变更、Slack 消息、GitHub issue）+ 后台研究（dots 的 proactive research 默认只读）。

### 5.2 权限模型（真正拉开差距的地方）

| 层级 | 做法 | 代表 |
|---|---|---|
| 只读后台 | 后台研究只允许读，不允许发消息/改内容/控浏览器 | dots |
| 审批后执行 | 发邮件、下单、改密码必须人点确认；敏感操作永远留给人 | Duet、Nod、Muse、Gemini |
| 策略化自动 | 自定义规则：允许 / 需审批 / 禁止；按动作类型而非按 App | dots Custom Rules、Scout Purview |
| 身份化执行 | Agent 有独立身份（Entra ID），行为可归因、可审计 | Scout、onecli |
| 凭据不落地 | Agent 能登录，但模型永远看不到密码；支付用 token | 1Password for Agents、ChatGPT Wallet、AP2 |

> 判断：**“审批 UI”不是体验细节，而是产品核心。** 用户第一次被 Agent 擅自发邮件/下单，信任就归零；这也是 Instinct、Muse 在 2026 年 8–11 月反复翻车的原因。

---

## 6. 安全与生态摩擦（选型/创业都绕不开）

### 6.1 典型事故

- **Muse**：可导出 6.8GB 运行目录（mouse.dev，9/22）；被指无视用户权限（AppleInsider，9/28）；串会话、可能暴露私人数据（TechCrunch，11/19）；用户起诉 Meta（404 Media，11/17）；路透 11/20 称“早期安全事故浮现”。
- **Grok Bot**：把 tech CEO 的银行信息发进公开 Slack（Techdirt，10/19）；五角大楼系统被承包商接入了个人 Agent（WIRED，10/29）。
- **OpenClaw**：575 个恶意 skill 向 Windows/macOS 投毒（Help Net Security，11/10）；CVE-2026-33579 提权；GitHub 钓鱼骗取 CLAW 代币（11/5）。
- **Hermes**：恶意 npm 包以 root 安装 Hermes Agent 并通过 Telegram 远控（safedep，11/21）。
- **通用**：Business Insider 记者的个人 Agent 把银行信息发进公司 Slack（10/9）；新加坡三部门联合发布个人 AI 智能体安全须知（11/12）。

### 6.2 平台与商家的反制

- Anthropic 禁止 Claude Code 订阅用于 OpenClaw（4/3），并在 4/30 进一步对 commit 信息中出现 “OpenClaw” 的请求限流/加价。
- Google 限制 AI Pro/Ultra 订阅用于 OpenClaw（2/22）。
- Amazon 封禁 Muse 在其站点购物（9/21）。
- 国内 155–166 款 App 拒绝豆包/千问的 Agent 代操作（10 月）。
- 美国政府网站是否应屏蔽 Agent 交易，已进入公共讨论（GovTech，10/25）。

> 判断：**“Agent 能不能被网站接受”正在成为新的分发壁垒。** PAP 想用 OAuth + 商家可控授权解决它；但在中国，超级 App 更可能选择“自己做 Agent”，而不是开放给第三方。

---

## 7. 趋势判断（未来 6–12 个月）

1. **免费层会杀死大多数“通用助理”创业公司。**
   Gemini Tasks 免费、Muse 基础免费、dots 进 Plus、Duet 含在 Claude 订阅里。单独的“能订机票/能整理收件箱”很难收费，除非绑定垂直数据（金融、医疗、法务）或团队协作。

2. **“云电脑”会商品化，差异化回到“记忆 + 时机 + 信任”。**
   Daytona、Phaze、Agent37 等把“给 Agent 一台电脑”做成基础设施；届时产品比拼的是“它有多懂你”和“它知道什么时候别动”。

3. **协议战会先于产品战结束。**
   PAP（Sierra/Meta/Shopify/Stripe/Walmart/Instinct）与 Google 的 AP2/UCP 是两条路线；MCP 已是工具层事实标准。2027 年前大概率形成“PAP 兼容 + AP2 支付”的组合。

4. **端侧会分走一部分“隐私敏感”用户，但不会成为主流。**
   Linger（125B 本地）、Underdog、nanoMuse、Andee 证明体验可行；瓶颈是内存/功耗与模型迭代速度。更现实的形态是“本地小模型做感知与审批，云端大模型做重活”的混合。

5. **硬件是下一个入口。**
   Muse Charm、AI 眼镜、MimiClaw 的 $5 芯片、Indiegogo 上的 OpenClaw 毛绒机器人——都在赌“随身、常开、有物理存在感”。短期是周边，长期可能重演“耳机 → 手表 → 眼镜”的入口迁移。

6. **开源仍是人才与创意的上游。**
   OpenClaw（39.5 万）、Hermes（26.5 万）这种量级意味着：任何闭源产品的新功能，两周内就会有开源复刻；反过来，大厂也会直接基于开源（Scout 基于 OpenClaw）做企业版。**“开源核心 + 托管/合规/团队版”是被验证的商业模式**（onecli、Moltis、Linger、Sierra）。

---

## 8. 对 DeskMate 的启示

结合 DeskMate 当前定位（macOS 透明置顶 Live2D + 屏幕感知 + 长期记忆 + 主动策略），这一波个人 Agent 的启示是：

1. **不要和“云电脑型助理”拼执行力。**
   Muse/dots/Duet 给每个用户一台 VM、4000+ 应用、支付钱包；DeskMate 拼“替你干活”是资源错配。继续押“工作现场的判断力”更合理。

2. **“打断时机”仍是空白，而且比 2026-11 时更值钱。**
   这一波所有产品都在解决“怎么多干”，很少解决“什么时候不该说话”。OpenClaw 的 heartbeat、Duet 的“知道何时不该打扰”、dots 的 proactive research 只读策略，都是粗粒度规则；把 Git/测试/终端/IDE 的结构化信号做成“该不该开口”的打分器，仍是差异化。

3. **权限与审计要从第一天做。**
   参考 PAP 的会话授权、1Password 的“凭据不落地”、Scout 的“独立身份 + 可归因”。哪怕只是本地 App，也应把“谁授权的、做了什么、能否撤销”做成可见的证据链——这正好呼应你既有文档里的“证据链”建议。

4. **入口优先级：消息 > 独立窗口。**
   OpenClaw 的 20+ 通道、Instinct 的 iMessage、Duet 的短信，都说明用户不想再开一个 App。DeskMate 的桌面存在感是优势，但需要一个“离开电脑也能找到它”的轻入口（微信/飞书/Telegram 机器人或手机端）。

5. **开源/社区是低成本分发。**
   Linger、nanoMuse、Moltis 都在用“开源 + 自托管 + Discord”冷启动；DeskMate 若走开源，注意“核心开源、云服务/团队版收费”的边界，以及复刻速度（参考 open-dot 当天出现）。

---

## 9. 来源

### 官方 / 一手
- OpenClaw 改名与定位：https://openclaw.ai/blog/introducing-openclaw
- OpenClaw 仓库：https://github.com/openclaw/openclaw
- Meta Muse：https://about.fb.com/news/2026/09/08/introducing-muse/ ；澳大利亚上线：https://about.fb.com/news/2026/11/muse-is-now-available-in-australia/
- OpenAI dots：https://openai.com/index/introducing-dots/
- Anthropic Claude Duet：https://claude.com/product/claude-duet
- Google Gemini Tasks：https://blog.google/innovation-and-ai/products/gemini-app/tasks-in-gemini-free-new-features/
- Microsoft Scout：https://www.microsoft.com/en-us/microsoft-365/blog/2026/06/02/introducing-microsoft-scout-your-always-on-personal-agent/
- Sierra Personal Agent Protocol：https://sierra.ai/blog/introducing-personal-agent-protocol
- Manus 2.0：https://manus.im/blog/introducing-manus-2-0
- Underdog：https://underdog.ai/
- Hermes Agent：https://github.com/NousResearch/hermes-agent

### 媒体 / 社区
- TechCrunch：Instinct 隐私争议（2026-08-24）、Instinct $10B（2026-09-28）、Grok Bot 限流（2026-11-02）、Underdog（2026-10-06）
- Reuters：Instinct $1B（2026-09-28）、Anthropic Claude Duet（2026-10-22）、Meta Muse 安全（2026-11-20）
- CNBC：Claude Duet 预览（2026-10-21）、dots 与付费意愿（2026-09-30）
- WIRED：个人 Agent 之战（2026-09-30）、五角大楼 Agent（2026-10-29）
- The Verge：Claude Duet 体验（2026-11-13）
- NYT：Muse 两个月后回访（2026-11-20）
- 36氪/财新/华尔街见闻/第一财经/爱范儿：千问Go、字节 Spell、腾讯、苹果、豆包/千问下线智能体功能（2026-10 至 11）
- Hacker News（Algolia API）：OpenClaw 相关讨论、Muse 发布、dots 发布、Duet 发布、Grok Bot 发布

### 数据快照
- GitHub REST API，2026-11-23：star/fork/语言/许可/创建时间
- Google News RSS，2026-11-23 检索

---

## 10. 方法与局限

- **收录偏差**：GitHub 搜索按 star 排序，会漏掉“刚发布但尚未涨星”的项目；已用 `created:>2026-08-15` 与 HN Show HN 做过补充。
- **媒体转述**：融资、下载量、内部代号（如字节 Spell）来自媒体报道，未获公司确认，文中已标“据报道”。
- **未覆盖**：纯 coding agent（Claude Code、Codex、Cursor）、纯陪伴产品（ChatGPT Pets、Miru）、纯基础设施（Daytona、E2B）只作为背景提及，不展开。
- **时效性**：这个赛道以周为单位变化；star 数与“可用性/定价”在引用前应重新核对。
