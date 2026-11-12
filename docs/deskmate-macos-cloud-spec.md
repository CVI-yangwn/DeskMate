# 同桌 DeskMate：macOS + Live2D + 云 落地方案

> 基于 2026-11-11 的决策：**macOS 优先、Live2D 形象、全云端 AI、个人自用**。  
> 这一版把上一版通用方案收敛成“一个人两周能跑起来”的实现规格。  
> **如果你只有 DeepSeek API**：见 [deskmate-deepseek-only.md](deskmate-deepseek-only.md)。DeepSeek 已支持视觉，TTS/ASR 改用 macOS 自带能力，不需要 ElevenLabs/Whisper。  
> **默认形象已选好**：`assets/live2d/haru/`（Haru，Cubism 3/4，8 表情，`ParamMouthOpenY`）。  
> **实现更新**：最终原型不依赖 VS Code；感知改为前台窗口 + 屏幕截图 + DeepSeek 视觉。  
> **实际接入**：百度内网 oneapi `https://oneapi-comate.baidu-int.com/v1`；文本 `DeepSeek-V4.1-Flash`，视觉 `DeepSeek-V4-Flash-Vision-Exp`。

---

## 0. 结论先行

### 0.1 三个关键改动

| 上一版建议 | 这一版改成 | 原因 |
|---|---|---|
| Tauri 2 + Rust + Python sidecar | **Electron + React + Node** | macOS 透明窗、点击穿透、多屏、全局快捷键的坑更少；Live2D Web 生态直接可用；全云端不需要本地 ML sidecar |
| Sprite 优先，Live2D 后置 | **Live2D 直接上** | 你明确要 Live2D；Electron + Pixi/Cubism 是最短路径 |
| 本地优先、隐私分级 | **个人自用，简化隐私** | 不用做企业级合规；但 macOS 的辅助功能/录屏/麦克风权限仍然要处理，这是技术问题不是伦理问题 |

### 0.2 最终形态

- 一个**透明、置顶、可点击穿透**的 Live2D 小人，常驻桌面右下角。
- 一个**独立聊天/设置面板**，点小人或快捷键打开。
- 一个**菜单栏图标**，用来暂停、静音、切换角色、退出。
- **Push-to-talk** 语音输入（默认不始终监听）。
- 云端 LLM + 云端 ASR + 云端 TTS；本地只做 Live2D 渲染、状态机、SQLite 记忆。
- 第一版只做 **VS Code + 终端 + Git + 前台窗口** 四种感知，不做全屏录屏、不做电脑操作。

### 0.3 第一版砍掉什么

- 不做 Windows/Linux。
- 不做 3D/VRM。
- 不做 marketplace/签名/打包生态。
- 不做 computer-use、自动改代码、自动执行命令。
- 不做唤醒词 always-listening（先 push-to-talk）。
- 不做系统级音频 ducking（macOS 上麻烦，先让用户自己暂停音乐）。
- 不做复杂向量记忆（SQLite + FTS5 足够）。

---

## 1. 技术栈

| 层 | 选择 | 说明 |
|---|---|---|
| 桌面壳 | **Electron（最新稳定版）** | 透明窗、置顶、点击穿透、多屏、托盘、全局快捷键都成熟 |
| UI | **React 18/19 + TypeScript + Vite** | 和 Live2D/Web 生态一致 |
| 构建 | **electron-vite + electron-builder** | 开发热更新、DMG 打包 |
| Live2D | **PixiJS 6 + pixi-live2d-display（Cubism 4）** | 最快跑通；大多数流通模型是 Cubism 3/4 |
| Live2D 备选 | **官方 Cubism Web SDK 5** 或 **l2d** | 如果你的模型是 Cubism 5，用这两个 |
| 状态 | **Zustand**（renderer）+ 普通类/事件总线（main） | 轻量，不引入 Redux |
| 存储 | **better-sqlite3** | 同步、简单、单机 |
| 配置 | **electron-store** + JSON | 角色/声音/策略配置 |
| LLM | **OpenAI-compatible API**（DeepSeek/Qwen/Claude/GPT 任一） | 用 `openai` npm，改 `baseURL` 即可切换 |
| ASR | **OpenAI Whisper API**（MVP，批量） | push-to-talk 录音 → 上传 → 文本；后续可换 Deepgram/Azure 流式 |
| TTS | **ElevenLabs**（首选） | 音色多、支持 voice design/clone、可返回时间戳 |
| TTS 备选 | **Azure Speech** | 有 viseme 事件，口型更准；中文音色稳 |
| VLM | **任意支持图片的云模型** | 只在“看不懂的报错/用户主动问”时截当前窗口 |
| 音频 | Web Audio API | 播放、振幅驱动口型、打断 |
| 截图 | **Electron desktopCapturer** | 按窗口抓，不抓全屏 |
| 窗口信息 | **get-windows**（原 active-win） | 前台 app、标题、bounds、窗口 id |
| Git | **simple-git** | 读分支、dirty、diff 统计 |
| 校验 | **zod** | 校验 LLM 结构化输出、配置、事件 |

> 如果你已经有 Live2D 模型，先确认它是 **Cubism 3/4** 还是 **Cubism 5**。  
> Cubism 3/4 → `pixi-live2d-display` 最省事；Cubism 5 → 官方 Cubism 5 Web SDK 或 `l2d`。

---

## 2. 架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron Main (Node)                                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ macOS 感知    │  │ 工作状态      │  │ 主动策略           │  │
│  │ get-windows  │→ │ WorkState    │→ │ Policy / Budget   │  │
│  │ powerMonitor │  │              │  │                   │  │
│  └──────────────┘  └──────────────┘  └─────────┬─────────┘  │
│  ┌──────────────┐  ┌──────────────┐            │            │
│  │ VS Code 桥    │  │ SQLite 记忆   │←───────────┘            │
│  │ Shell 桥      │  │ episodes     │                         │
│  │ Git           │  │ facts        │                         │
│  └──────┬───────┘  └──────────────┘                         │
│         │                                                    │
│  ┌──────▼─────────────────────────────────────────────────┐  │
│  │ Cloud Clients: LLM / ASR / TTS / VLM                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  Tray / globalShortcut / login item / permissions           │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge, zod-validated)
┌──────────────────────────▼──────────────────────────────────┐
│ Renderer (React)                                            │
│  ┌────────────────────┐  ┌───────────────────────────────┐  │
│  │ Avatar Window       │  │ Panel Window                  │  │
│  │ Live2D canvas       │  │ Chat / Settings / Memory      │  │
│  │ transparent         │  │ normal window                 │  │
│  │ always-on-top       │  │ hidden until opened           │  │
│  │ click-through       │  │                               │  │
│  └────────────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

外部生产者：
  VS Code Extension ──HTTP/WS──▶ Main
  zsh hook          ──HTTP────▶ Main
```

### 为什么是两个窗口

- **Avatar Window**：小、透明、置顶、点击穿透；只画 Live2D 和气泡。
- **Panel Window**：正常窗口，聊天/设置/记忆；打开时抢焦点，关闭后隐藏。
- 这样不会因为“打开聊天”而把透明窗变大，也不会让透明窗的点击穿透逻辑变复杂。

---

## 3. macOS 集成

### 3.1 权限清单

| 权限 | 用途 | 触发方式 |
|---|---|---|
| Accessibility | 读前台窗口标题、部分 AX 信息 | `systemPreferences.isTrustedAccessibilityClient(true)` 会弹窗 |
| Screen Recording | `desktopCapturer` 抓当前窗口截图 | 第一次 `getSources` 触发 |
| Microphone | push-to-talk 录音 | 第一次 `getUserMedia` 触发 |
| Automation（可选） | AppleScript 控制其他 app | 第一次 `osascript` 触发 |
| Login Item | 开机自启 | `app.setLoginItemSettings` |

`Info.plist` 里加：

```xml
<key>NSMicrophoneUsageDescription</key>
<string>用于语音对话</string>
<key>NSAppleEventsUsageDescription</key>
<string>用于读取当前工作应用状态</string>
<key>LSUIElement</key>
<true/>
```

> `LSUIElement=true` 让 app 不在 Dock 显示，只留菜单栏图标。个人用很合适。

### 3.2 透明置顶窗

```ts
const win = new BrowserWindow({
  width: 420,
  height: 620,
  transparent: true,
  frame: false,
  hasShadow: false,
  resizable: false,
  focusable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  backgroundColor: '#00000000',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    backgroundThrottling: false,
  },
});

win.setAlwaysOnTop(true, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.showInactive();
```

要点：

- `focusable: false` 避免抢焦点；打开面板时再临时设 `true`。
- `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })` 让它在全屏 IDE/浏览器上也能看到。
- `hasShadow: false` + `transparent` 避免 macOS 给透明窗加一层阴影。
- 不要用 `vibrancy`，会和透明背景打架。

### 3.3 点击穿透 + 可交互区域

不要依赖 renderer 的 `mouseenter`（窗口 ignore 鼠标时可能收不到）。用主进程轮询全局鼠标位置：

```ts
let interactiveRect = { x: 0, y: 0, w: 0, h: 0 }; // renderer 上报，窗口坐标

setInterval(() => {
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inside =
    p.x >= b.x + interactiveRect.x &&
    p.x <= b.x + interactiveRect.x + interactiveRect.w &&
    p.y >= b.y + interactiveRect.y &&
    p.y <= b.y + interactiveRect.y + interactiveRect.h;

  win.setIgnoreMouseEvents(!inside, { forward: true });
}, 50);
```

- renderer 用 `ResizeObserver`/Live2D model bounds 算出“小人”的矩形，通过 IPC 上报。
- 气泡出现时，把气泡矩形也并进去。
- 打开面板时，直接 `setIgnoreMouseEvents(false)` 并 `focusable: true`。

### 3.4 前台窗口

```ts
import { activeWindow } from 'get-windows';

const win = await activeWindow();
// { id, title, owner: { name, processId, bundleId }, bounds, url? }
```

用途：

- `owner.name` / `owner.bundleId` 判断 IDE/浏览器/会议 app。
- `title` 提取项目名/文件名。
- `bounds` 判断是否全屏（和 `screen.getDisplayMatching(bounds).bounds` 比较）。
- `id` 用来匹配 `desktopCapturer` 的窗口源，抓当前窗口。
- `url` 只有部分浏览器会给，不要强依赖。

轮询频率：**2 秒一次**，不要 100ms。

> `get-windows` 是 ESM 包；在 electron-vite 的 main 进程里用 ESM 导入。  
> 它默认会检查 Accessibility 和 Screen Recording 权限；第一次调用会触发系统弹窗。

### 3.5 截图（只在需要时）

```ts
import { activeWindow } from 'get-windows';
import { desktopCapturer } from 'electron';

const current = await activeWindow();
const sources = await desktopCapturer.getSources({
  types: ['window'],
  thumbnailSize: { width: 1280, height: 800 },
});

// Electron 的 source.id 通常是 "window:<CGWindowID>"，和 get-windows 的 id 对得上
const source =
  sources.find(s => s.id.endsWith(String(current?.id))) ??
  sources.find(s => s.name.includes(current?.title ?? ''));

const jpeg = source?.thumbnail.toJPEG(70);
```

- 只在“未知报错/用户主动问/策略需要”时抓，不要连续录屏。
- 用 `sharp` 压到最长边 1280，JPEG 70，控制 token。
- 截图只放内存，发给云 VLM 后即弃；个人用可以存最近 10 张方便调试。

### 3.6 空闲 / 锁屏 / 全屏

```ts
powerMonitor.getSystemIdleTime(); // 秒
powerMonitor.on('lock-screen', ...);
powerMonitor.on('unlock-screen', ...);
powerMonitor.on('suspend', ...);
powerMonitor.on('resume', ...);
```

- idle > 5 分钟 → 结束当前 focus episode。
- idle > 20 分钟 → 小人睡觉。
- 锁屏/休眠 → 暂停所有主动话。

### 3.7 已知坑

- **macOS 没有公开的 Focus/DND 状态 API**。别承诺“自动识别勿扰”。第一版用：
  - 手动“专注模式”开关；
  - 全屏检测；
  - 会议 app 白名单（Zoom/Teams/Webex/飞书/腾讯会议）。
- `globalShortcut` 可能和系统快捷键冲突；默认用 `Control+Option+Space`，设置里可改。
- 透明窗在 macOS 多屏/缩放变化时可能错位；监听 `screen` 的 `display-added/removed/metrics-changed`，重新定位。
- 全屏 app 上 `screen-saver` 级别可能仍被盖住；接受这个限制，不要为此写私有 API。

---

## 4. Live2D 集成

### 4.1 模型要求

一个可用的 Live2D 模型至少要有：

- `*.model3.json`
- `*.moc3`
- 贴图
- 至少 1 个 idle 动作
- 表情（happy/angry/sad/surprised/blush 中至少 3 个）
- 参数：`ParamMouthOpenY`、`ParamMouthForm`、`ParamEyeLOpen`、`ParamEyeROpen`、`ParamAngleX/Y/Z`、`ParamBodyAngleX`

如果没有动作，也能跑：用程序化呼吸/轻微摆动 + 表情切换。

### 4.2 渲染选型

**方案 A：pixi-live2d-display（推荐先跑通）**

- 支持 Cubism 2/3/4；PixiJS 6。
- API 简单：`Live2DModel.from()`、`model.motion()`、`model.expression()`、`model.focus()`。
- 需要引入 `live2dcubismcore.min.js`（Cubism 4 core）。
- 适合“模型是 Cubism 3/4”的情况。

```ts
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

window.PIXI = PIXI;

const app = new PIXI.Application({
  view: canvas,
  backgroundAlpha: 0,
  antialias: true,
  resolution: window.devicePixelRatio,
  autoDensity: true,
});

const model = await Live2DModel.from('/models/hiyori/hiyori.model3.json');
app.stage.addChild(model);
model.anchor.set(0.5, 1);
model.scale.set(0.8);
```

> 把 `live2dcubismcore.min.js` 放到 `public/`，在 `index.html` 里先于 bundle 加载；否则会报 `CubismCore is not defined`。

**方案 B：官方 Cubism 5 Web SDK**

- 如果你的模型是 Cubism 5，或者需要更细的参数/表情控制。
- 参考 [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples)。
- 工作量比 A 大，但长期最稳。

**方案 C：l2d / l2d-widget**

- MIT 封装，支持 Cubism 2 及较新版本（README 里写的是 Cubism 2/6），零依赖。
- 适合快速加载；但深度控制（逐帧口型/表情混合）要先读它的 API。
- 可以先用它验证模型能否加载，再决定是否换官方 SDK。

### 4.3 口型：先振幅，后 viseme

**MVP 最实用**：用 Web Audio 的 `AnalyserNode` 取 RMS，直接驱动 `ParamMouthOpenY`。

```ts
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
const data = new Uint8Array(analyser.frequencyBinCount);
const core = model.internalModel.coreModel; // pixi-live2d-display

function tick() {
  analyser.getByteTimeDomainData(data);
  let rms = 0;
  for (const v of data) {
    const x = (v - 128) / 128;
    rms += x * x;
  }
  rms = Math.sqrt(rms / data.length);
  const mouth = Math.min(1, rms * 3);
  core.setParameterValueById('ParamMouthOpenY', mouth);
  requestAnimationFrame(tick);
}
```

- 对 anime 风格，振幅口型已经“够像”。
- 如果 TTS 返回音素/时间戳（ElevenLabs alignment / Azure viseme），再做精确 viseme 映射：
  - `a/i/u/e/o` → `ParamMouthForm` + `ParamMouthOpenY` 组合；
  - 中文可用拼音韵母近似映射。
- 不要一开始追求完美口型；先让它“说话时嘴会动”。

### 4.4 表情 / 动作映射

```ts
const emotionMap = {
  celebrate: { expression: 'happy', motion: 'cheer' },
  comfort:   { expression: 'sad',   motion: 'head_tilt' },
  tease:     { expression: 'smile', motion: 'wink' },
  think:     { expression: 'neutral', motion: 'thinking' },
  sleep:     { expression: 'sleepy', motion: 'sleep' },
};
```

- 模型没有对应动作时，降级到程序化动画：跳动、左右摆、缩放。
- 动作播放优先级：主动情绪 > 说话点头 > idle。
- 说话时每 2–3 句加一次轻微点头/手势，不要一直抖。

### 4.5 眼神

- `model.focus(x, y)` 让眼睛跟随鼠标；坐标用主进程全局鼠标位置转换到 canvas 坐标。
- 不跟随时，看向屏幕中央/用户。
- 深度工作时不要频繁转头，避免“被盯着”的感觉。

### 4.6 性能

- canvas 尺寸 360×560 左右即可；不要全屏 Canvas。
- `ticker.maxFPS = 60`；窗口隐藏/锁屏时暂停 ticker。
- 电池模式降到 30fps，停物理。
- Electron 透明窗 + WebGL 在 MacBook 上功耗不低； idle 时降帧很重要。

---

## 5. 云端服务

### 5.1 服务矩阵

| 能力 | 首选 | 备选 | 备注 |
|---|---|---|---|
| LLM | DeepSeek / Qwen（OpenAI-compatible） | Claude / GPT | 中文技术语境 + 便宜；用 `openai` SDK 改 baseURL |
| ASR | OpenAI Whisper API | Deepgram / Azure Speech | MVP 批量转写；后续流式 |
| TTS | ElevenLabs | Azure Speech / MiniMax | ElevenLabs 音色多、支持 voice design/clone、有时间戳 |
| VLM | 任意支持图片的模型 | Gemini / Claude / GPT | 只在按需截图时调用 |
| Embedding | 先不用 | — | SQLite FTS5 足够 |

### 5.2 LLM 调用

用 `openai` npm，main process 里调用，key 不进 renderer：

```ts
const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL, // 例如 DeepSeek/Qwen 的兼容端点
});

const stream = await client.chat.completions.create({
  model: process.env.LLM_MODEL!,
  stream: true,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: personaPrompt },
    { role: 'user', content: contextCapsule },
  ],
});
```

输出统一为：

```json
{
  "say": true,
  "displayText": "绿了！这个 race condition 你追了一上午。",
  "speechText": "绿了！这个 race condition 你追了一上午。",
  "emotion": "celebrate",
  "motion": "cheer",
  "voiceStyle": "happy",
  "urgency": "low",
  "evidenceIds": ["test-pass-1"],
  "reason": "test just passed after 3 failures"
}
```

- `say=false` 时给 `silenceReason`，策略引擎可以选择尊重或强制说。
- `displayText` 和 `speechText` 分开：屏幕显示 `useEffect`，语音读 “use effect”。
- 用 zod 校验；失败重试一次，再失败就降级为模板句。

### 5.3 TTS 调用

ElevenLabs：

- 用 `with-timestamps` / `stream-with-timestamps`（按当前 API 版本）拿音频 + 字符对齐。
- 输出 mp3 44.1kHz；renderer 用 `AudioContext` 播放。
- 语音参数：stability 0.4、similarity 0.8、style 0.3 起步，按角色调。
- 常用短句（“绿了”“收到”“我在”）预合成缓存，减少延迟和费用。

Azure 备选：

- 用 Speech SDK 的 viseme 事件，口型更准；中文音色稳。
- 适合“说话质量优先、愿意多写一点 SDK 代码”的情况。

### 5.4 ASR

MVP 用 push-to-talk：

1. renderer `getUserMedia({ audio: true })`。
2. `MediaRecorder` 录 `audio/webm;codecs=opus`。
3. 松开快捷键 → 停止 → ArrayBuffer 发 main。
4. main 调 Whisper API（`whisper-1` 或当前转写模型）。
5. 返回文本，送 LLM。

后续流式：renderer 每 20ms 发 PCM chunk → main 开 Deepgram/Azure WebSocket → partial transcript。

### 5.5 成本估算（个人强度）

| 项目 | 假设 | 月成本 |
|---|---|---|
| LLM | 每天 20–50 次调用，上下文 2–4k tokens | $5–20 |
| TTS | 每天 5–10 分钟语音 | $10–30 |
| ASR | 每天 10–20 分钟 | $3–10 |
| VLM | 每天 10–30 张截图 | $3–10 |
| 合计 | — | **约 $20–70/月** |

个人用可接受；想省就：缓存常用句、压缩截图、用小模型做分类。

---

## 6. 工作状态与主动策略

### 6.1 事件协议

VS Code 扩展 → main：

```json
{
  "type": "vscode.event",
  "ts": 1760000000000,
  "payload": {
    "kind": "editor",
    "project": "payment-service",
    "file": "src/auth/session.ts",
    "language": "typescript",
    "errors": 2,
    "warnings": 5,
    "gitBranch": "fix/race",
    "typing": true
  }
}
```

终端 hook → main：

```json
{
  "type": "shell.command",
  "ts": 1760000000000,
  "payload": {
    "cwd": "/Users/me/payment-service",
    "command": "pnpm test auth",
    "exitCode": 1,
    "durationMs": 4200,
    "firstErrorLine": "FAIL src/auth/session.test.ts"
  }
}
```

`WorkState`：

```ts
type WorkMode =
  | 'deep_work' | 'debugging' | 'reading'
  | 'reviewing' | 'meeting' | 'idle' | 'context_switching';

interface WorkState {
  mode: WorkMode;
  project?: string;
  file?: string;
  test?: { command: string; exitCode: number; at: number };
  focusMin: number;
  idleSec: number;
  switches5m: number;
  struggle: number;      // 0..1
  lastAchievement?: string;
  updatedAt: number;
}
```

### 6.2 第一版只做 4 个触发

1. **测试红→绿**：`exitCode` 从非 0 变 0，且命令是 test 类。
2. **测试连续失败**：同一 test 命令 10 分钟内失败 ≥ 2 次 → 提议理时间线/帮看报错。
3. **长时间专注**：连续 50 分钟无长 idle → 建议休息/喝水。
4. **长时间 idle**：idle > 10 分钟 → 小人睡觉，不主动说话。

test 类命令先覆盖：`npm/pnpm/yarn test`、`pytest`、`go test`、`cargo test`、`jest`、`vitest`、`mvn test`、`gradle test`。

VS Code 侧优先用 `onDidEndTerminalShellExecution` 拿 `commandLine` + `exitCode`（需要终端开启 Shell Integration）；没有 shell integration 时，用 zsh hook 兜底。

后续再加：commit、PR、CI、深夜、上下文切换过多。

### 6.3 策略伪代码

```ts
const candidates = ruleCandidates(state);       // 0..n
const llmCandidates = await propose(state);     // 0..3
const all = [...candidates, ...llmCandidates];

for (const c of all) {
  c.value = relevance(c) * timeliness(c) * personaFit(c) * evidenceStrength(c);
  c.cost =
    interruptionCost(state) +
    repetitionPenalty(c, history) +
    fatiguePenalty(budget.usedToday);
}

const winner = all
  .map(c => ({ ...c, score: c.value - c.cost }))
  .sort((a, b) => b.score - a.score)[0];

if (winner && winner.score > cfg.threshold && budget.ok() && !dnd()) {
  await ritualThenSpeak(winner);
} else {
  logSilence(winner?.silenceReason ?? 'low_value');
}
```

`interruptionCost` 高：

- VS Code `typing=true`（用 `onDidChangeTextDocument` 节流，不用全局键盘监听）。
- 全屏 / 会议 app 在前台。
- 最近 10 分钟说过话。
- 用户上次关闭/忽略了同类话术。

`interruptionCost` 低：

- 测试刚结束、终端刚返回。
- 用户 idle 10–60 秒。
- 用户点了小人/气泡。

### 6.4 访问仪式

说话前：

1. 小人抬头/看向用户；
2. 播放一声很轻的“敲敲”；
3. 等 1.2 秒；
4. 如果这 1.2 秒内 VS Code 有输入/用户按了 Esc → 取消；
5. 否则出气泡/说话。

这就是产品名“敲敲”的来源：**先敲门，再说话**。

### 6.5 静音与预算

配置：

```json
{
  "policy": {
    "maxPerHour": 3,
    "minGapMin": 10,
    "deepWorkMinGapMin": 25,
    "dnd": ["00:30-08:00"],
    "dailyBudget": 12
  }
}
```

- 超过预算 → 只显示环境动作，不说话。
- 连续忽略 2 次同类话术 → 关闭该类 7 天。
- 用户点“别吵了” → 静音 1 小时。

---

## 7. 项目结构

```text
deskmate/
├─ apps/
│  ├─ desktop/
│  │  ├─ src/
│  │  │  ├─ main/
│  │  │  │  ├─ index.ts                 # app lifecycle, tray, shortcut
│  │  │  │  ├─ windows/avatarWindow.ts
│  │  │  │  ├─ windows/panelWindow.ts
│  │  │  │  ├─ perception/activeWindow.ts
│  │  │  │  ├─ perception/screenshot.ts
│  │  │  │  ├─ perception/git.ts
│  │  │  │  ├─ bridges/vscodeBridge.ts  # local HTTP/WS server
│  │  │  │  ├─ bridges/shellBridge.ts
│  │  │  │  ├─ brain/workState.ts
│  │  │  │  ├─ brain/policy.ts
│  │  │  │  ├─ brain/dialogue.ts
│  │  │  │  ├─ cloud/llm.ts
│  │  │  │  ├─ cloud/tts.ts
│  │  │  │  ├─ cloud/asr.ts
│  │  │  │  ├─ cloud/vlm.ts
│  │  │  │  ├─ memory/db.ts
│  │  │  │  ├─ memory/episodes.ts
│  │  │  │  ├─ ipc.ts
│  │  │  │  └─ config.ts
│  │  │  ├─ preload/index.ts
│  │  │  └─ renderer/
│  │  │     ├─ App.tsx
│  │  │     ├─ avatar/Live2DStage.tsx
│  │  │     ├─ avatar/useLipSync.ts
│  │  │     ├─ chat/Bubble.tsx
│  │  │     ├─ chat/ChatPanel.tsx
│  │  │     ├─ settings/Settings.tsx
│  │  │     └─ store.ts
│  │  ├─ electron.vite.config.ts
│  │  └─ package.json
│  └─ vscode-extension/
│     ├─ src/extension.ts
│     └─ package.json
├─ packages/
│  └─ shared/
│     ├─ types.ts
│     └─ protocol.ts
├─ assets/
│  ├─ live2d/<model>/...
│  └─ voices/<pack>/...
├─ config/
│  ├─ persona.json
│  └─ app.json
├─ scripts/
│  └─ shell-hook.zsh
└─ docs/
```

---

## 8. 两周冲刺

### Week 1：能看、能动、能说话

**Day 1–2：桌面壳**

- `electron-vite` 初始化。
- 透明置顶窗 + 托盘 + 全局快捷键 + 点击穿透轮询。
- 关闭窗口 = 隐藏，不退出；菜单栏退出。
- 验收：小人窗口能常驻右下角，不抢焦点，鼠标可穿透到 IDE。

**Day 3–4：Live2D**

- 加载 `model3.json`，显示 idle 动作。
- 点击 hit area → 表情/动作。
- 测试 `ParamMouthOpenY` 手动驱动。
- 验收：60fps、透明背景、缩放/位置可调。

**Day 5–6：VS Code 桥 + 终端桥**

- VS Code 扩展：当前文件、诊断、Git 分支、`onDidChangeTextDocument` 节流后的 typing 事件。
- 扩展通过 `http://127.0.0.1:39876/event` 发事件。
- zsh hook：`preexec` 记录命令，`precmd` 发退出码；异步 `curl`，不阻塞 shell。
- 验收：在 VS Code 跑 `pnpm test`，main 能收到 exitCode。

**Day 7：第一个主动话**

- `WorkState` + `test red→green` 规则。
- 调 LLM 生成一句祝贺，zod 校验。
- 气泡显示，3 秒后自动消失。
- 验收：跑一次失败再跑成功，小人说“绿了”。

### Week 2：能听、能说、不烦

**Day 8–9：云 TTS + 口型**

- ElevenLabs 合成，播放音频。
- `AnalyserNode` 振幅驱动 `ParamMouthOpenY`。
- 预合成 10 句常用话术缓存。
- 验收：首句可听 < 1.5s，嘴会动。

**Day 10：Push-to-talk ASR**

- 按住快捷键录音，松开转写。
- 文本进 LLM，回复走 TTS。
- 验收：能问“我现在该干嘛”，得到结合当前文件/测试状态的回答。

**Day 11：策略与静音**

- 预算、冷却、DND、访问仪式。
- typing 时取消主动话。
- “别吵了”按钮。
- 验收：连续深度工作 30 分钟，最多 1 次主动话。

**Day 12：记忆 + 今日回顾**

- SQLite：episodes / facts / feedback。
- 记录测试通过、专注时长、用户忽略。
- 18:30 或点击“今日”生成回顾。
- 验收：回顾里的数字和事实对得上。

**Day 13–14：打包与 demo**

- `electron-builder` 出 DMG。
- 登录自启、权限引导页、日志。
- 个人用可以先不签名；首次打开右键 → 打开，或 `xattr -cr /Applications/DeskMate.app`。
- 拍 90 秒 demo：红→绿、卡住退让、下班回顾。
- 验收：你自己愿意把它留在电脑上跑 7 天。

---

## 9. 验收标准

- macOS 14+ Apple Silicon 可运行。
- 透明窗常驻、置顶、点击穿透、可拖动。
- Live2D 60fps（M 系列），idle 时 CPU < 10%。
- VS Code 测试红→绿触发，2 秒内出气泡/语音。
- 深度工作 typing 时，主动话被取消。
- Push-to-talk 语音对话可用，首句 < 1.5s。
- 今日回顾数据准确。
- 连续 4 小时不崩、不漏内存。
- DMG 可安装，权限引导清晰。

---

## 10. 风险与未知

| 风险 | 说明 | 对策 |
|---|---|---|
| Live2D 模型版本不匹配 | Cubism 5 模型用 Cubism 4 core 加载会失败 | 先确认版本；Cubism 5 用官方 SDK/l2d |
| 透明窗点击穿透在 macOS 上有 quirks | 多屏/缩放/全屏可能错位 | 全局鼠标轮询 + 监听 display 变化 |
| Electron 内存/功耗 | 透明 WebGL 窗常驻耗电 | idle 降帧、隐藏暂停、电池模式 |
| 云 TTS 延迟 | 首包慢 | 预合成缓存、流式、首句优先 |
| 中文口型不准 | 字符对齐 ≠ 音素 | 先用振幅；要准换 Azure viseme |
| macOS 无 DND API | 无法自动识别勿扰 | 手动专注模式 + 全屏/会议白名单 |
| 云 API 成本 | 每天说话多会超预算 | 缓存、压缩上下文、小模型分类 |
| 角色/声音版权 | 个人自用可忽略；以后分发再查 | 先用免费/自制素材 |

---

## 11. 我建议的默认配置

- **LLM**：DeepSeek 或 Qwen 的 OpenAI-compatible 端点（中文技术语境、便宜）；不满意再换 Claude。
- **TTS**：ElevenLabs multilingual，先选一个现成音色；不要一上来克隆。
- **ASR**：OpenAI Whisper API，push-to-talk。
- **Live2D**：先用 Cubism 3/4 模型 + `pixi-live2d-display`；跑通后再换 Cubism 5。
- **角色**：一个“安静、偶尔毒舌、不鸡汤”的搭子；先写 200 字 persona，不要写 2000 字。
- **触发**：只做测试红→绿、连续失败、50 分钟专注、10 分钟 idle。

---

## 12. 下一步

我需要你准备三样东西：

1. 一个 Live2D 模型（`.model3.json` + 贴图 + moc3 + motions/expressions），或者告诉我“用免费样例”。
2. 三个云 API key：LLM、TTS、ASR（ElevenLabs / OpenAI / DeepSeek 任一）。
3. 一个你常跑的测试命令（`pnpm test` / `pytest` / `go test` / `cargo test`），用来做“红→绿”触发。

然后我可以直接搭第一个可运行骨架：

- Electron 透明窗 + Live2D 加载 + 点击穿透；
- VS Code 扩展 + 本地事件桥；
- `test red→green` 触发 + 云 LLM 一句话 + 气泡；
- 先不接 TTS，确认“看见工作”这条链路通了，再加声音。

> 先跑通“看见 → 判断 → 说一句”，再追求“好听、好看、好玩”。  
> 第一版的目标不是功能多，而是**你愿意把它留在桌面上第二天**。
