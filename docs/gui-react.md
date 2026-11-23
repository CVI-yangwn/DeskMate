# GUI ReAct（照 ernie_agent 搬过来）

> 目标：不再用“precondition → locate → act → verify”的多阶段状态机，改成 ernie_agent 的标准 ReAct：
> **LLM → computer 工具 → 环境执行 → 返回文本 + 新截图 → LLM 看着截图决定下一步**。

---

## 1. 契约

```text
LLM ──tool_call(computer)──▶ LocalMacEnvironment
                              ├─ 执行动作（native/gui）
                              └─ 截一张新图
LLM ◀──{text, image}──────────┘
```

- 动作结果里**自带新截图**，模型不需要再调 screenshot；
- “验证”就是模型看这张图；“完成”就是模型不再调用工具；
- 没有独立的 planner / precondition / verifier 阶段；
- 坐标 **0–999**（左上 (0,0)，右下 (999,999)），prompt **不写分辨率**；
- 内层 system **直接照 ernie_agent 的 `CoordinateSpace.prompt_block`（`## Screen`）**，只把 0–1000 改成 0–999、工具名改成 `computer`；
- 动作：screenshot / click（支持 left/right/middle、1/2/3 击）/ move / **drag** / type / press_key / hotkey / scroll / wait。

## 2. 代码位置

| 文件 | 作用 |
|---|---|
| `src/main/gui/environment.ts` | `executeAndObserve` 契约、0..999 → 像素映射 |
| `src/main/gui/macEnv.ts` | macOS 实现：`captureFocusedDisplay` + `native/gui` |
| `src/main/gui/computerTool.ts` | 统一 `computer` 工具 schema + 执行器 |
| `src/main/gui/react.ts` | ReAct 循环（工具结果带图、maxSteps、transcript） |
| `src/main/agentTools.ts` | `gui_task` 工具（把整段 ReAct 包给 brain） |
| `src/main/brain.ts` | `DESKMATE_GUI=1` 时注册 `gui_task` |

## 3. 已验证

- **协议冒烟**（不碰真实桌面）：用 fixture 截图跑 `runGuiReact`，模型调 `screenshot`，工具结果带图，模型准确描述屏幕内容并收尾。
  `npm run smoke:gui-api`
- **单元测试**：坐标映射、click/scroll 参数、工具结果带图、maxSteps、失败仍回图（8 条）。
- 全量测试 107 条通过，typecheck 通过。

## 4. 还没验证 / 已知坑

- **真实桌面点击**已跑通：解锁后 `npm run smoke:gui`，模型 screenshot → 点击 7 → 自己收尾，`axdump` 读到显示区为 **7**。
  锁屏/休眠时 GUI 操作应当直接中止，而不是对着黑图点；`macEnv` 已加黑图/过小截图保护。
- `press_key` 需要键名别名（esc/escape、return/enter），已补。
- 不可逆动作的确认还没接（`gui_task` 目前无确认 UI）。
- batch（一次多动作、只回最后一张图）还没实现。
- `report_infeasible`（明确说做不了）还没实现。

## 5. 运行

```bash
# 协议冒烟（不需要解锁）
npm run smoke:gui-api

# 真实桌面（默认开启；需要解锁；会动鼠标）
npm run dev

# 想临时关闭 GUI 控制：
DESKMATE_GUI=0 npm run dev
```

然后直接对 DeskMate 说：“点击计算器上的 7”。**默认开启**，不需要再指定环境变量。

## 6. 下一步

1. 解锁后跑一次 Calculator 端到端：任务“让计算器显示 7”，用 `axdump` 读显示值验收。
2. 给 `gui_task` 加不可逆动作确认。
3. 加 batch 和 report_infeasible。
4. 锁屏检测：截图过小/全黑时直接报“屏幕已锁定”，不执行动作。

---

## 7. Watcher：监控 → 条件 → 操作（已跑通）

`src/main/gui/watcher.ts` 只做“什么时候触发”，动作仍交给 `runGuiReact`：

```text
每 interval 秒：截图 → VLM 判断条件 → 命中 → runGuiReact(task) → 记录
```

- `shadow: true` 时只记录、不动作（建议新 watcher 先跑影子模式）；
- `maxChecks` 限制检查次数，避免无限循环；
- 每次判断都留 evidence，方便回看“它为什么动了”。

**真实演示**（`npm run smoke:watch`）：

1. 计算器先显示 7；
2. 条件：“显示区当前是否显示数字 7”；
3. 第 1 次检查命中，evidence：“显示区中清晰地显示着数字 7”；
4. 自动执行“点击清除”，ReAct 收尾“已变为 0”；
5. `axdump` 读到显示区 **0**。

这验证了最初的需求形态：**盯着一个界面，条件满足时替你点一下。**

---

## 8. 持久化 Watcher + 定时服务

`src/main/gui/watcherStore.ts` / `watcherService.ts` 把“盯一下”做成可持久化的任务：

- 存储：`~/Library/Application Support/DeskMate/gui-watchers.json`，原子写入；
- 调度：每个 watcher 一个 `setInterval`，默认 60s，最小 10s；
- 命中后：`shadow` 只记录；非 shadow 调 `runGuiReact` 执行 task；
- `once: true`（默认）成功一次后自动停用，`maxRuns` 可放宽；
- App 启动时 `brain.startWatchers()` 恢复已保存的任务。

模型侧三个工具（`DESKMATE_GUI=1` 时注册）：

| 工具 | 作用 |
|---|---|
| `watch_task` | 建任务：condition / task / intervalSec / shadow / once |
| `list_watchers` | 看条件、间隔、最近结果、evidence |
| `stop_watcher` | 按 id 删除 |

**默认 shadow=true**：先只记录“我本来会动手”，确认判断可靠后再显式 `shadow=false`。

示例对话：

> “帮我盯着计算器，显示 7 就点清除。每 30 秒看一次，先别真点。”
> → `watch_task(condition="计算器显示区是否显示 7", task="点击清除", intervalSec=30, shadow=true)`

---

## 9. App 内路径已验证（2026-11-23）

用 `scripts/gui-brain-smoke.ts` 直接实例化 `BrainService`，走完整链路：

```text
BrainService.chat()
  → chatWithTools(tools 含 gui_task)
  → executeTool('gui_task')
  → runGuiReact()
  → LocalMacEnvironment（Electron desktopCapturer + native/gui）
```

运行（需要 esbuild 打包，Electron 在受限环境要关沙箱/GPU）：

```bash
esbuild scripts/gui-brain-smoke.ts --bundle --platform=node --format=esm --packages=external --outfile=.tmp/gui-brain-smoke.mjs
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
  --no-sandbox --disable-gpu --user-data-dir=/tmp/deskmate-electron .tmp/gui-brain-smoke.mjs
```

结果：

- `cleared: true`
- reply：`点好了，计算器显示区现在只有 7。`（source: deepseek）
- `axdump` 读取计算器显示区：**7**

说明 App 内不只是“注册了工具”，而是真的能通过对话完成一次 GUI 操作。


---

## 10. 默认开启（2026-11-23）

`src/main/gui/config.ts::parseGuiEnabled`：**未设置 / 空 / 1 / true / on 都算开启**，只有 `0 / false / off / no` 才关闭。

- `getDeepSeekEnv().guiEnabled` 同时读 `process.env` 和 `.env.local`；
- `gui_task` / `watch_task` 等工具**始终注册**，关闭时执行器返回明确错误：“GUI 已被关闭（DESKMATE_GUI=0）”；
- App 启动时 `brain.startWatchers()` 恢复 watcher；
- 默认开启后，自然语言请求会直接调 GUI（实测：无 env 时仍进入 `gui_task`）。

已知边界：默认开启不等于“什么都能点”。Calculator 的 7 键能点中，C 键（小按钮）连续 4–8 步没点中；这是 68% 定位率的真实表现。下一步应做 **AX-at-point 吸附**（点附近有原生控件时用 AXPress 精确触发）或**活动窗口裁剪**。


---

## 11. 自动调用 + 取消 max turn（2026-11-23）

### 不再问“要不要转 GUI”

外层 prompt **不注入任何 GUI 细节**，只保留同桌的人设、状态、记忆和工具列表。

“直接调用、不要先问”写在 `gui_task` 的**工具描述**里：

- 用户要求查看或操作某个可见界面时，直接调用；
- 不要问“是否允许 / 是否需要转 GUI / 要不要操作”；
- 只有目标不明确、或目标 App 没开且打不开时才先问。

这样 GUI 的坐标、截图、动作规则都留在内层 `## Screen`，外层只负责“要不要委托、委托成什么”。

实测（无环境变量）：

> “看看计算器现在显示什么”
> → “计算器现在显示的是 7。”

没有反问，直接看了屏幕。

### 取消轮次上限

| 原来 | 现在 |
|---|---|
| `chatWithTools` 最多 4 轮 | 默认不限；`DESKMATE_MAX_TURNS` 可设紧急上限 |
| `runGuiReact` 默认 8 步、最多 20 步 | 不传 `maxSteps` 就不限步数 |
| `gui_task` 强制 1..12 步 | `maxSteps` 可选，不填不限 |

新增测试：不传 `maxSteps` 时，25 步任务也能完整走完（116 条测试全过）。

**代价**：不限轮次意味着模型可能反复点同一个地方、消耗更多 token。`DESKMATE_MAX_TURNS=50` 可设一个紧急上限；调用 `gui_task` 时也可以显式传 `maxSteps`。

---

## 12. 截图预算：只保留最近 5 张（2026-11-23）

`src/main/gui/react.ts::pruneImages(messages, keep=5)`：每轮调用模型前，从旧到新数图片，超过 5 张就移除最旧的 `image_url`，保留对应动作的文本结果。

- 默认 `maxImages = 5`，可被 `GuiReactDeps.maxImages` 覆盖；
- 每次回复的 `reasoning_content` 会写进 assistant 消息和 transcript，随历史一起回传（API 实测接受）；
- 外层 chat 仍然 0 张图；
- GUI 第 N 次调用最多带 `min(N-1, 5)` 张图；
- 只移除 `image_url`；动作文本（“clicked …”“ERROR …”）、`tool_calls`、assistant 的 `reasoning_content`（thinking）全部保留；
- 需要看更早的画面时，重新 `screenshot` 即可，不必依赖历史图。

代价：超过 5 步后，模型无法再回看最早的截图，只能看最近 5 张 + 动作文本。
