# DeskMate / 同桌

> 一个坐在 macOS 屏幕边上的独立 AI 工作搭子：自己看屏幕、自己判断、自己说话。**不依赖 VS Code，不依赖任何 IDE 插件。**

当前状态：**独立 macOS 原型已经搭好**。Electron 透明窗 + 小黑 Live2D + 屏幕/前台窗口感知 + 本地 Vision OCR + DeepSeek 视觉 + SQLite 长期记忆 + 个人 wiki / 夜间整理 / 提醒规则学习 + 技能 + 工具调用 + 隐私/勿扰 + 面板 UI。内网 oneapi 已实测通过。
还没接 macOS Speech 语音输入、`say` WAV 口型驱动和 DMG 打包。

## 架构

```text
macOS 本机
├─ Electron 主进程
│  ├─ 前台窗口：get-windows
│  ├─ 屏幕截图：所有显示器整屏（desktopCapturer，聚焦屏优先）
│  ├─ 本地 OCR：native/ocr（macOS Vision）
│  ├─ 记忆：SQLite + FTS5（node:sqlite）
│  ├─ 大脑：DeepSeek 文本 + 视觉 + JSON + tool calls
│  ├─ 事件桥：127.0.0.1:39876
│  └─ 主动策略：每次扫描请 LLM 判断 / 勿扰
├─ Live2D 透明窗：小黑（hijiki 黑猫）
├─ 面板：状态 / 扫描 / 记忆 / 设置 / 聊天
└─ 语音：macOS say（Tingting）
```

> 透明桌面窗、屏幕录制、`say` 都必须在 macOS 本机；历史构建环境里的 Linux 服务器不参与最终运行。
> 屏幕截图会发给内网 oneapi 的 DeepSeek 视觉模型做分析，不经过其他服务器；不是本地推理。

## 已确定

| 决策 | 选择 |
|---|---|
| 平台 | macOS |
| 桌面壳 | Electron + React + TypeScript |
| 形象 | Live2D，默认 **小黑**（Cubism 2 黑猫，hijiki） |
| 大脑 / 眼睛 | 百度内网 oneapi（OpenAI-compatible）：`DeepSeek-V4.1-Flash` 文本 + `DeepSeek-V4-Flash-Vision-Exp` 视觉 |
| 感知 | 前台窗口 + 所有显示器整屏 + 本地 OCR + 空闲时间；**无 VS Code 依赖** |
| 嘴巴 | macOS `say` |
| 耳朵 | macOS `SFSpeechRecognizer`（下一步） |
| 记忆 | SQLite + FTS5：事实/锚点/意图 + 个人 wiki + 每晚整理 + 可学习提醒规则 |

## 运行

### 首次安装

```bash
bash scripts/macos-setup.sh
```

它会：

- 优先使用系统 Node；没有就把项目自带的 `.node/` 加进 PATH；
- 编译 `native/ocr`；
- 复制 `.env.example` 为 `.env.local`；
- `npm install`；
- `npm run typecheck`；
- `npm test`；
- `npm run build`。

然后编辑 `.env.local`，填入有效的 `DEEPSEEK_API_KEY`。

### 启动

```bash
bash scripts/dev.sh
```

`scripts/dev.sh` 会自动找到项目自带的 Node，所以即使 `node` 不在 PATH 里也能启动。
如果系统已经装了 Node 22+，也可以直接：

```bash
npm run dev
```

> `.env.local` 已被 `.gitignore` 忽略。不要把 key 提交到仓库。
> 没有有效 key 时，应用会自动使用本地 mock，不会崩。
> 打包后，`.env.local` 和 `config/avatar.json` 也可以放在 `~/Library/Application Support/DeskMate/`。

### 构建与检查

```bash
npm run typecheck
npm test
npm run build
npm run check:model
npm run eval:memory   # 零模型 wiki 检索体检；默认复制 DB，不碰线上库
```

### macOS 权限

需要手动授权（系统不一定会自动弹窗）：

- **Screen Recording**：抓屏幕/窗口截图；第一次截图时可能弹窗，没有就去系统设置勾选。
- **Accessibility**：读前台窗口标题、光标附近文本、多屏窗口列表。`native/ax` 是独立 helper，`AXIsProcessTrusted()` 不会主动弹窗；没有权限时它会静默降级（光标上下文和多屏隐私回退失效），容易被误判成 bug。

去“系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能”勾选 DeskMate（开发模式下可能显示为 Electron；如果 `native/ax` 单独出现也要勾选），然后重启应用。

## 现在能做什么

![面板预览（暖纸浅色主题）](assets/panel-preview.png)

- 透明、置顶、可拖动、点击穿透的小黑桌面形象（一只坐在桌角的小黑猫，会眨眼、动尾巴、说话时张嘴）；没有“在线”角标，点击区域按猫的 alpha 轮廓判定，透明区域直接穿透；
- 面板窗口（默认 480×840）：四个标签页「此刻 / 对话 / 今天 / 知识」；暖纸浅色主题，靠字号、留白和细线分层；此刻页放应用/窗口/活动、意图预测、测试状态和扫描控制，对话页专注聊天，今天页放锚点和答应过的事，知识页放日结、wiki、规则和技能；
- **长期记忆**：SQLite + FTS5，保存在 `~/Library/Application Support/DeskMate/memory.db`；支持分类（项目/偏好/事实）、置顶、搜索、编辑、单条删除、手动添加；按问题检索相关记忆，并记录来源/置信度/使用次数；
- **个人 wiki**：一页一个实体（项目 / 人物 / 话题），带当前摘要、未完成条目、证据来源和 Change Log；页面同时写成 `userData/wiki/<type>/<slug>.md`，可直接看、删、进 git；模型只能“只写变化”，没提到的条目不会被重写冲掉，引用必须来自当天证据；
- **夜间整理**：默认每天 23:30 后把当天对话、锚点、承诺、意图、屏幕活动、主动消息反馈收敛成 wiki 页面、提醒规则、日结和一份“关于你”的摘要；最多 5 页，没 key 时做本地日结与项目页迁移；面板“知识”页可以“现在整理”；
- **提醒规则学习**：收到主动消息后说“以后这类直接说 / 别提醒我 / 晚点再说 / 晚上别发”，会沉淀成带时间窗的规则，在下一次说话前生效；含糊表达先记线索，同类两次升级；气泡 14 天内被关 3 次也会学成“这类别说”；规则可暂停、删除、面板可见；设置里可整体关闭“从反馈学习”；
- **记忆健康**：知识页显示页面/对话/活动数量、注入字符数、无来源页、已过期来源、90 天未更新但还有未完成项的页面、重复未完成项；另有 `npm run eval:memory` 自动从 wiki 生成检索体检，或读 30 题真实问题算 Recall@1/@4；
- **隐私与删除**：清空记忆会删表 + 删 `wiki/`、`agent-memory/` 文件 + `secure_delete`/`VACUUM`；删除单个 wiki 页会 unlink 对应 Markdown；tombstone 只存 SHA-256，不存客户名；导出强制 0600；OCR/光标全文不落盘；
- **技能**：`skills/<name>/SKILL.md`（YAML frontmatter）描述常驻、正文按需加载；内置日结、调试时间线、会前准备、周报四个；聊天里按需调用 `use_skill` 读取全文，再配合 `lookup_activity` / `search_knowledge` 执行；
- **今天 / 陪伴记忆**：每天最多 8 个锚点（自动从聊天里抽 1–2 个，也可手动加/编辑）、承诺清单、次日一次 callback、晚间一句；不做全量时间线，只记值得记的；
- **自动锚点**：测试红→绿、连续专注 60/90 分钟、测试红着卡住 30 分钟，会自动记一条；每天最多 2 条；删掉的锚点不会被自动重新生成；
- **闭嘴反馈**：气泡关闭/点开都会回传；同类事件连续被关 2 次先静默 7 天，14 天内 3 次会沉淀成持久的 `stay_silent` 规则；全屏、会议、安静时段（设置里可配）不主动说话；学到的规则也压不住勿扰/安静时段；
- **声音与人格**：设置里可选 macOS `say` 音色、语速，并写自己的 persona（称呼/语气/边界/绝对不说）；
- **记忆导出**：长期记忆、锚点、承诺、日结、wiki 页面和提醒规则可导出为 JSON 或 Markdown；导出文件强制 0600，并提示不要放 iCloud/共享目录；
- **自动记忆**：可开关；稳定的偏好/项目会从聊天中自动沉淀，相似记忆自动合并；关闭后只有明确说“记住”才写入；
- **活动时间线**：每次扫描把应用、窗口、活动摘要写进 SQLite（7 天，按时间而不是固定 2000 行）；OCR/光标全文只在当轮内存和模型判断里用，不落盘；问“我刚才/过去一小时在干嘛”时会带最近 2 小时时间线，也可以用 `lookup_activity` 查更久；
- **光标上下文**：通过辅助功能接口读光标附近文本（不是键盘监听），知道你在写什么；遇到 secure input / 密码框直接放弃，读不到（浏览器正文、IM 自绘输入框）时静默降级，见 [说明](docs/caret-context.zh-CN.md)；
- **文本变化**：OCR 只在内存里做行级 diff，只有“新出现的报错行”才算值得说的变化，避免时钟/滚动噪音；正文不写进数据库；
- **注意力归属**：前台屏说了算，副屏只作为 `ambient` 线索；同一应用里冒出的新说法要连续两帧才确认，通知/弹窗不会把“在做什么”带偏；
- **按“东西”切段**：同一个浏览器里换了文件/页面就另起一段（`entity` 存在 `intentions` 和 `activity_log`），不会把看过的十份材料拼成一条；
- **意图层**：把连续几步扫描归成一件说得清的事（“在 Xcode 里修 auth 校验”），换应用 / 断档 8 分钟 / 同应用超 45 分钟自动收尾；命名走 DeepSeek，失败回退本地模板；面板“此刻”里显示当前这段和今天几段；
- **主动猜下一步**：最近 6 条意图 + 时段 + 行为画像交给模型，只猜“下一步”，置信度 ≥ 0.60 才开口；面板可点“对 / 不是”，“不是”会在 2 小时内压掉相似猜测；`DESKMATE_INTENT_PREDICT=0` 可关；
- **自我纠正**：当你说“不对，我刚才在写周报”时，系统提取正确活动和覆盖时间并写入纠正表；之后回答“刚才在干嘛”会优先使用纠正后的版本；
- **工具调用**：`remember`、`search_memory`、`lookup_activity`、`scan_screen`、`set_dnd`、`search_knowledge`、`read_wiki_page`、`list_skills`、`use_skill`；
- **勿扰与主动策略**：启动先打招呼；手动扫描一定给气泡反馈；普通观察同一活动 10 分钟内不重复，活动刚变化至少隔 3 分钟；离开 10 分钟回来会欢迎；连续专注 25 分钟或空闲 10 分钟也会主动关注；空闲/锁屏会重置专注计时；
- **扫描当前屏幕**：抓所有显示器的整屏（聚焦屏优先）→ 每块屏跑 macOS Vision 本地 OCR → 把多张图一起发给 `DeepSeek-V4-Flash-Vision-Exp` → 汇总更新活动/测试状态；任意屏出现隐私排除应用时自动退回到前台窗口截图；
- **可信感知**：每次扫描都调用视觉模型；本地 OCR 作为证据和测试结果兜底，不再用它跳过 LLM；面板显示 OCR 行数、置信度、耗时、证据数和扫描/分析次数；
- **自适应扫描**：默认 60 秒，窗口变化 12 秒内触发；空闲时降频；不再因为画面没变化而跳过视觉分析；可暂停感知 15 分钟；可通过 `DESKMATE_SCAN_INTERVAL_MS` / `DESKMATE_AUTO_SCAN=0` 调整；
- **隐私**：可配置隐私排除应用（前台命中时不截图、不分析；多屏整屏模式发现任意屏可见的隐私应用时退回前台窗口）；视觉调用不再受预算限制；启动默认只显示小黑，不自动弹出面板；
- **检测测试红→绿**：上一次截图是 fail、这次是 pass，就生成一句祝贺；
- DeepSeek 可用时走真实模型，key 缺失/无效时自动回退 mock；
- 托盘菜单、全局快捷键 `Cmd+Shift+Space` 打开/收起面板，`Cmd+Shift+M` 打开“今天”并直接记一下；
- 点击小黑或气泡打开面板；拖动小黑移动位置，位置跨重启保存；
- 聊天回复自动通过 `say` 朗读，并同步气泡/口型；新的语音会打断上一条；
- 本地事件桥 `POST http://127.0.0.1:39876/event`，可以用 `npm run demo:pass` / `npm run demo:fail` 手动触发；只接受 JSON Content-Type，并拒绝非本机 Origin。

## 还没做

- macOS Speech push-to-talk；
- `say` 输出 WAV → 振幅口型（当前是合成嘴型）；
- 语义/向量记忆检索（当前是 FTS5 + 名称/摘要加权匹配）；
- 任务委派与审批（后台长任务、写文件/发消息前的确认卡）；
- 真正的本地 AI 语音（当前是 macOS `say`）；
- DMG 打包、登录自启、代码签名；
- 多显示器贴边/吸附（当前可拖动并保存位置）；

## 目录

```text
assets/live2d/
├─ README.md                 # 模型选择与备选
├─ hijiki/                   # 默认 Live2D 模型：小黑（Cubism 2，含 README / 许可）
├─ haru/                     # 备选 Live2D 模型（Cubism 3/4）
├─ LICENSE-Live2D-CubismWebSamples.md
└─ NOTICE-Live2D.md

config/
└─ avatar.json               # 头像模型 / 缩放 / 动作 / 口型映射

native/
├─ ocr.swift                 # macOS Vision OCR 源码
├─ ax.swift                  # 辅助功能读光标文本源码
└─ ocr                       # 本地编译产物（gitignore，setup 时重建）

src/
├─ main/
│  ├─ index.ts               # 窗口、托盘、快捷键、IPC、点击穿透、自动扫描
│  ├─ windows.ts             # Avatar / Panel 双窗口
│  ├─ brain.ts               # 状态、API/mock 回退、截图分析、红绿检测、主动策略
│  ├─ companion.ts           # 陪伴记忆：本地抽取、日期、早晚文案
│  ├─ intention.ts           # 意图层：分段规则、本地归纳、行为画像、置信度闸门
│  ├─ ax.ts                  # 调 native/ax 读光标附近文本
│  ├─ change.ts              # OCR 行级 diff、只挑新报错、打字增量
│  ├─ salience.ts            # 注意力归属：换应用立即采纳，同应用需连续确认
│  ├─ perception.ts          # 前台窗口 + 截图 + 空闲时间
│  ├─ ocr.ts                 # 调 native/ocr
│  ├─ memory.ts              # SQLite + FTS5：长期记忆/活动/意图 + wiki/规则/日结
│  ├─ wiki.ts                # 个人 wiki：草稿合并、引用校验、Markdown、搜索
│  ├─ proactiveRules.ts      # 主动规则：时间窗、显式反馈解析、线索升级
│  ├─ skills.ts              # 技能注册表：frontmatter、目录扫描、按需读取
│  ├─ dreaming.ts            # 夜间整理：路由、逐页写作、规则/日结/摘要、文件输出
│  ├─ redact.ts              # 证据送模前的密钥/联系方式/证件脱敏
│  ├─ correction.ts          # 自我纠正意图识别与本地解析
│  ├─ deepseek.ts            # 文本 + 视觉 + JSON + tool calls
│  ├─ mockBrain.ts           # 无 key/401 时的本地回退
│  ├─ persona.ts             # 角色 prompt
│  ├─ agentTools.ts          # 工具定义
│  ├─ eventBridge.ts         # 本地 HTTP 事件桥
│  ├─ env.ts                 # .env.local 读取
│  └─ tts.ts                 # macOS say
├─ preload/index.ts          # contextBridge API
├─ renderer/
│  ├─ AvatarApp.tsx          # 透明窗：Live2D + 气泡
│  ├─ PanelApp.tsx           # 面板：状态 / 扫描 / 记忆 / 设置 / 聊天
│  ├─ KnowledgePanel.tsx     # 知识页：日结 / wiki / 规则 / 技能
│  ├─ Live2DStage.tsx        # Pixi + pixi-live2d-display
│  ├─ Bubble.tsx
│  └─ styles.css
└─ shared/types.ts           # IPC 类型

evals/
├─ README.md                 # 30 题评测说明
└─ memory-questions.example.json

scripts/
├─ dev.sh                    # 自动找 Node 后启动开发模式
├─ macos-setup.sh            # 安装、编译 OCR、检查、构建
├─ test-memory.mjs           # MemoryStore 单测（node:test）
├─ test-correction.mjs       # 自我纠正解析单测
├─ test-event-bridge.mjs     # 事件桥校验单测
├─ test-companion.mjs        # 陪伴记忆本地抽取单测
├─ test-change.mjs          # 文本变化 / 打字增量单测
├─ test-salience.mjs        # 注意力归属平滑单测
├─ test-intention.mjs        # 意图分段 / 兜底 / 置信度闸门单测
├─ test-intention-store.mjs  # 意图与预测的落库单测
├─ test-wiki.mjs             # wiki 合并 / 引用校验 / 搜索单测
├─ test-proactive-rules.mjs  # 规则匹配 / 反馈解析 / 线索升级单测
├─ test-skills.mjs           # 技能解析与注册表单测
├─ test-dreaming.mjs         # 夜间整理编排与文件输出单测
├─ test-memory-hardening.mjs # schema/清空/脱敏/保留/健康检查单测
├─ test-redact.mjs           # 证据脱敏单测
├─ eval-memory.mjs           # 零模型记忆检索体检（--auto / --questions）
├─ check-live2d-model.mjs    # 校验 model3.json 引用文件
└─ send-test-event.mjs       # 手动触发红绿事件
```

docs/ 里的 [意图层说明](docs/intent-layer.zh-CN.md) 记录了意图层的借鉴取舍；[Linger 架构对照](docs/linger-lessons.zh-CN.md) 记录了这次从 Linger 吸收了什么、哪些故意没抄；[知识库与夜间整理](docs/knowledge-and-dreaming.zh-CN.md) 是实现与排查说明。

## 版本管理

仓库已经用 Git 维护，默认分支 `main`。当前是本地仓库，没有配置远程。
按时间记录的改进、验证方式和已知限制见 [CHANGELOG.md](CHANGELOG.md)。

```bash
git log --oneline
git status
```

`.node/`、`node_modules/`、`out/`、`.env.local`、`native/ocr` 都不会进入仓库；`native/ocr` 由 `scripts/macos-setup.sh` 重建。

## 已知问题

- **内网 oneapi**：`https://oneapi-comate.baidu-int.com/v1`，需要公司网络/VPN。`/v1/models` 已返回 200；`DeepSeek-V4.1-Flash` 文本/JSON、`DeepSeek-V4-Flash-Vision-Exp` 识图、chat 都已实测通过。
- **屏幕扫描依赖权限**：macOS 没给 Screen Recording 时，`desktopCapturer` 返回空；面板会提示。
- **多屏截图会包含其他窗口**：默认抓所有显示器整屏；如果任意屏有隐私排除应用可见，会退回前台窗口截图。若希望始终只抓窗口，可以把 `captureAllDisplays()` 换回 `captureActiveWindow()`。
- **多屏隐私回退依赖 Accessibility**：没有辅助功能权限时，`get-windows` 读不到其他屏的窗口列表，只能保证前台应用被排除；授权后才会执行“任意屏有隐私应用则退回窗口截图”。读取失败会在 4–5 秒后超时，不会卡死扫描。
- **自动扫描成本**：每轮扫描都会调用视觉模型 + 一次主动判断；默认 60 秒一轮，**视觉调用目前没有硬上限**。试用时建议 `DESKMATE_SCAN_INTERVAL_MS=180000`，或在安全窗口里用 `DESKMATE_AUTO_SCAN=0` 只手动扫描。
- **夜间整理成本**：默认一天一次，最多 5 页 + 规则 + 日结 + 摘要，约 8 次小调用；`autoDream` 可在设置里关掉。证据文本送模前会做常见密钥/联系方式/证件脱敏，但截图本身仍可能含敏感内容。
- **wiki 文件按名字落盘**：删除页面会 unlink 当前 Markdown；改名后旧名字的 Markdown 仍会留在 `userData/wiki/`。tombstone 只存哈希，夜间不会把同名页自动建回来。
- **点击穿透依赖 hit rect**：如果 macOS 上点击不灵，需要把 `focusable` 在 hover 时临时设为 true（待真机验证）。
- **`node:sqlite` 仍带 experimental 警告**：Electron 45 / Node 24 下已实测可用；Node 22 启动时可能打印 SQLite experimental warning，不影响使用。
- **打包还没闭环**：仍缺 electron-builder/DMG 流程；代码已支持从 userData 读取 `.env.local` 和 `config/avatar.json`，`native/ocr` 需要随应用放进 resources。
- **事件桥没有 token**：已经限制为本机 Origin + JSON Content-Type，但同机进程仍可调用；后续可以加一次性 token。
- **静态加密还没做**：DB 文件 600、`secure_delete`/`VACUUM` 已开，但没有 SQLCipher/加密卷；Time Machine、APFS 快照和 iCloud 同步仍可能在应用外保留副本。

## 下一步

1. 在 Mac 上跑 `bash scripts/dev.sh`，确认屏幕扫描 + 视觉分析 + 气泡/语音。
2. 接 macOS Speech push-to-talk。
3. 接 `say` WAV + 振幅口型。
4. 用一周真实数据校准夜间整理：页面质量、引用准确率、规则误判率。
5. 用最近 30 题真实问题跑 `npm run eval:memory`，连续两个月 Recall@4 < 70% 再考虑双链/embedding。
6. 做只读任务委派 + 高风险动作审批，再考虑浏览器/文件操作。
7. 打包 DMG，登录自启，代码签名。

先跑通“看屏幕 → 判断 → 说一句”，再追求“好听、好看、好玩”。
