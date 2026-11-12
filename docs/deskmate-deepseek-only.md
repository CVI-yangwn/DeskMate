# 只有 DeepSeek API 的版本：macOS + Live2D + 本地声音

> **实现更新（2026-11-11）**：最终原型不依赖 VS Code。`src/main/perception.ts` 用前台窗口 + 屏幕截图 + DeepSeek 视觉；本文里的 VS Code 段落只保留为早期方案。  
> **实际接入**：百度内网 oneapi `https://oneapi-comate.baidu-int.com/v1`；文本 `DeepSeek-V4.1-Flash`，视觉 `DeepSeek-V4-Flash-Vision-Exp`。
> 结论：**够用，而且比预期完整。**  
> DeepSeek 现在的 `deepseek-flash` 已经支持**图片输入**，所以“看屏幕”不需要再加一个视觉 API；缺的只是“耳朵”和“嘴巴”，用 macOS 自带的 Speech / `say` 补上即可。

---

## 0. 能力盘点

| 需要的能力 | 用什么 | 是否额外 API |
|---|---|---|
| 对话 / 主动话术 | DeepSeek `deepseek-flash` | 否 |
| 看屏幕 / 看报错截图 | DeepSeek `deepseek-flash` 视觉 | 否 |
| 看代码 / 测试状态 | VS Code 扩展 + 终端 hook + Git | 否 |
| 语音合成（嘴巴） | macOS `say` / `AVSpeechSynthesizer` | 否 |
| 语音识别（耳朵） | macOS `SFSpeechRecognizer` | 否 |
| 记忆 | SQLite + FTS5 | 否 |
| 查报错 / 查文档（可选） | DeepSeek Search / Fetch | 否（同一个 key） |
| Live2D 渲染 | PixiJS + Cubism | 否 |

**唯一需要花钱的**：DeepSeek token。个人强度通常**个位数美元/月**。

---

## 1. 新架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron Main (Node)                                        │
│                                                             │
│  macOS 感知                                                  │
│  ├─ get-windows        前台 app / 标题 / bounds / 窗口 id     │
│  ├─ desktopCapturer    按窗口截图                             │
│  ├─ VS Code 扩展       文件 / 诊断 / Git / typing             │
│  ├─ zsh hook           命令 / 退出码 / 错误首行               │
│  └─ powerMonitor       idle / 锁屏 / 休眠                     │
│                                                             │
│  WorkState → Policy → Dialogue                              │
│                                                             │
│  DeepSeek Client                                             │
│  ├─ deepseek-flash     文本 + 图片 + JSON                     │
│  ├─ deepseek-v4-pro    复杂文本推理（可选）                   │
│  └─ Search / Fetch     查报错/文档（可选）                    │
│                                                             │
│  macOS 声音                                                  │
│  ├─ say / AVSpeechSynthesizer    TTS                         │
│  └─ SFSpeechRecognizer            ASR                        │
│                                                             │
│  SQLite 记忆 / Tray / 快捷键 / 权限                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC
┌──────────────────────────▼──────────────────────────────────┐
│ Renderer (React)                                            │
│  ├─ Avatar Window：Live2D + 气泡 + 透明/置顶/点击穿透          │
│  └─ Panel Window：聊天 / 设置 / 记忆                          │
└─────────────────────────────────────────────────────────────┘
```

和上一版相比：

- 去掉了 ElevenLabs、Whisper、Azure、额外 VLM；
- 用 DeepSeek 一个 key 同时做**大脑 + 眼睛**；
- 用 macOS 自带能力做**耳朵 + 嘴巴**；
- 整体更简单、更便宜，但声音更像“系统朗读”，不是 anime 声优。

---

## 2. DeepSeek 怎么用

### 2.1 模型选择

按当前官方文档：

| 模型 | 能力 | 用途 |
|---|---|---|
| `deepseek-flash` | 文本 + **图片** + JSON + 工具调用；1M context | 主力：主动话术、看截图、日常对话 |
| `deepseek-v4-pro` | 文本 + 强推理；**不支持图片** | 可选：用户问复杂问题时用 |
| `Search` / `Fetch` | 搜索 / 抓网页 | 可选：查陌生报错、查文档 |

> 模型名以官方文档为准；旧名 `deepseek-v4-flash-vision-exp` 仍可能被接受，但新代码直接用 `deepseek-flash`。

### 2.2 主动话术：关掉 thinking，快

主动陪伴要的是 1–2 秒内出话，不需要长推理。用 `thinking: { type: 'disabled' }`：

```ts
const res = await client.chat.completions.create({
  model: 'deepseek-flash',
  thinking: { type: 'disabled' },
  max_tokens: 300,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: personaAndRules },
    { role: 'user', content: contextCapsule },
  ],
} as any);
```

> 如果 SDK 类型还没包含 `thinking`，用 `as any` 或直接 `fetch`。

### 2.3 看屏幕：直接把截图给 `deepseek-flash`

DeepSeek 视觉支持 JPEG/PNG/GIF/WebP，图片放在 **user message** 里，用 `image_url` 的 data URL：

```ts
const res = await client.chat.completions.create({
  model: 'deepseek-flash',
  thinking: { type: 'disabled' },
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: screenshotSystemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: '看这张当前窗口截图，判断我在做什么、卡在哪。只输出 JSON。' },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${jpegBase64}`,
            detail: 'low', // 512×512，快且便宜；看小字时用 high/original
          },
        },
      ],
    },
  ],
  max_tokens: 500,
} as any);
```

关键细节：

- **`detail: 'low'`** 会把图缩到 512×512，适合判断“这是 IDE/终端/浏览器/报错弹窗”。
- 要读小字/堆栈，用 `detail: 'high'` 或 `'original'`；每张图最多约 **1024 tokens**，仍然很便宜。
- 图片只支持放在 **user** 消息里；放 system/assistant 会 400。
- 截图先压到最长边 1280、JPEG 70，减少 body 大小。
- 不要让模型“猜图里没有的东西”；prompt 里要求它只描述可见内容，并输出 `confidence`。

### 2.4 JSON 输出：必须按官方要求写 prompt

DeepSeek JSON Output 有三个坑：

1. 必须设置 `response_format: { type: 'json_object' }`；
2. prompt 里必须出现 “json” 这个词，并给一个输出示例；
3. 如果模型输出无法识别为 JSON，API 会把内容替换成空格，`content` 可能全是空格。

所以：

```ts
const parsed = schema.safeParse(JSON.parse(content));
if (!parsed.success || !content.trim()) {
  // 重试一次，降级到模板句
}
```

推荐输出结构：

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

- `say=false` 时给 `silenceReason`。
- `displayText` 与 `speechText` 分开：屏幕显示 `useEffect`，`say` 读 “use effect”。
- `max_tokens` 不要太小，避免 JSON 被截断。

### 2.5 复杂问题：再开 thinking

用户主动问“这个架构怎么改”“帮我分析这个报错”时：

```ts
model: 'deepseek-flash',
thinking: { type: 'enabled' },
reasoning_effort: 'high',
```

或者用 `deepseek-v4-pro`（纯文本、强推理）。  
**不要**在主动陪伴的短句上用 thinking，会慢、会贵、还会让话变长。

### 2.6 查报错：Search / Fetch（可选）

只有 DeepSeek key 也能查网：

```ts
await fetch('https://api.deepseek.com/v1/tools/search', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: 'TypeError: Cannot read properties of undefined (reading map)',
    count: 3,
    need_content: false,
  }),
});
```

使用场景：

- 用户问“这个报错什么意思”，且本地上下文不足；
- 遇到陌生库/版本问题；
- 不要每次主动话都搜，按请求计费，且会慢。

### 2.7 成本

按 `deepseek-flash` 当前低价档估算：

- 每天 30 次主动话，每次 4k input + 150 output；
- 每天 20 张截图，每张最多 1024 tokens；
- 每天 5 次搜索；
- 一个月大约 **$1–5**，取决于聊天频率。

比“LLM + TTS + ASR + VLM 四家 API”便宜一个数量级。

---

## 3. macOS 嘴巴：`say`

### 3.1 为什么用 `say`

- 系统自带，零依赖、零 API key；
- 支持中文（Tingting / Meijia / Sinji，以 `say -v '?'` 为准）；
- 可以输出 WAV/AIFF，方便做振幅口型；
- 延迟低，短句几乎即时。

缺点：

- 听起来是“系统朗读”，不是 anime 声优；
- 不能克隆音色；
- 情绪表达有限。

对个人 MVP 足够；后期想升级再换本地 GPT-SoVITS/CosyVoice。

### 3.2 基本命令

```bash
# 看有哪些中文声音
say -v '?' | grep -i zh

# 直接朗读
say -v Tingting -r 180 "绿了！这个 race condition 你追了一上午。"

# 输出 WAV，给 Web Audio 播放 + 振幅口型
say -v Tingting -r 180 \
  -o /tmp/deskmate-tts.wav \
  --data-format=LEI16@22050 \
  "绿了！这个 race condition 你追了一上午。"
```

如果 `.wav` 输出不理想，用 `afconvert` 转：

```bash
say -v Tingting -r 180 -o /tmp/tts.aiff "……"
afconvert -f WAVE -d LEI16@22050 /tmp/tts.aiff /tmp/tts.wav
```

### 3.3 让 `say` 不那么机器

`say` 支持嵌入式命令：

```text
[[slnc 200]] 绿了！[[slnc 120]] 这个 race condition 你追了一上午。
[[rate 170]] [[pbas 48]] 要不要先歇一会儿？
```

- `[[slnc 200]]`：停 200ms；
- `[[rate 170]]`：语速；
- `[[pbas 48]]`：音高（按声音试，别太高）；
- 短句 + 停顿，比长句自然很多。

建议默认：

- voice：`Tingting`（zh_CN）；
- rate：170–185；
- pitch：45–52；
- 每句不超过 25 个字；
- 主动话最多 2 句。

### 3.4 播放 + 口型

```ts
// main: say 生成 wav
const wav = await synthesizeWithSay(text);

// renderer: Web Audio 播放 + 振幅驱动
const buf = await audioCtx.decodeAudioData(wav);
const src = audioCtx.createBufferSource();
src.buffer = buf;

const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
src.connect(analyser).connect(audioCtx.destination);
src.start();

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
  core.setParameterValueById('ParamMouthOpenY', Math.min(1, rms * 3));
  requestAnimationFrame(tick);
}
```

### 3.5 声音包抽象

即使现在只用 `say`，也留一个接口，方便以后换：

```ts
interface TTSProvider {
  synthesize(text: string, opts: VoiceOptions): Promise<{ audio: Buffer; format: 'wav' }>;
}

class MacSayTTS implements TTSProvider { ... }
class LocalSoVITSTTS implements TTSProvider { ... } // 以后
class ElevenLabsTTS implements TTSProvider { ... }  // 以后
```

声音包配置：

```json
{
  "provider": "macos-say",
  "voice": "Tingting",
  "rate": 178,
  "pitch": 48,
  "style": "gentle",
  "maxChars": 25
}
```

---

## 4. macOS 耳朵：`SFSpeechRecognizer`

### 4.1 为什么用它

- 系统自带，支持中文/英文；
- 可以流式出 partial transcript；
- 支持 `contextualStrings`，把项目术语/文件名/技术词喂给它，提升识别率；
- 支持 `requiresOnDeviceRecognition`（设备支持时完全本地）。

缺点：

- 代码标识符识别一般；
- 需要 Speech Recognition + Microphone 权限；
- 裸 CLI 的 TCC 权限容易不弹窗，最好做成一个小的 `.app` helper 放进 `Contents/Helpers`。

### 4.2 Swift helper 骨架

```swift
import Speech
import AVFoundation

let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))!
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.requiresOnDeviceRecognition = true
request.contextualStrings = [
  "useEffect", "auth.spec.ts", "race condition",
  "pnpm", "vitest", "CI", "DeepSeek",
]

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
  request.append(buffer)
}
engine.prepare()
try engine.start()

recognizer.recognitionTask(with: request) { result, error in
  guard let result else { return }
  let text = result.bestTranscription.formattedString
  print("{\"type\":\"\(result.isFinal ? "final" : "partial")\",\"text\":\"\(text)\"}")
  if result.isFinal { exit(0) }
}
```

Electron 侧：

- push-to-talk 按下：`spawn(helper)`；
- 松开：给 helper 发 SIGTERM，或让它自然 final；
- 读 stdout 的 JSON lines，partial 可以实时显示在气泡里；
- final 文本送 DeepSeek。

### 4.3 权限

`Info.plist`：

```xml
<key>NSMicrophoneUsageDescription</key>
<string>用于语音对话</string>
<key>NSSpeechRecognitionUsageDescription</key>
<string>用于把语音转成文字</string>
```

### 4.4 兜底

如果 TCC 权限折腾不动，或者中文识别不满意：

- 用 `whisper.cpp` + `ggml-base` / `small` 模型，本地转写；
- 需要额外下载模型，但没有 API key、没有 Speech 权限；
- 对代码术语，用 prompt/initial_prompt 或后处理词典修正。

---

## 5. 工作感知：DeepSeek 眼睛 + IDE 结构化信号

### 5.1 优先级

1. **IDE 结构化信号**：文件、语言、诊断、测试、Git、typing；
2. **终端信号**：命令、退出码、错误首行；
3. **前台窗口**：app、标题、bounds；
4. **截图 + DeepSeek 视觉**：只在结构化信号不够时。

不要每 10 秒截一张图。  
截图是“望远镜”，不是“监控摄像头”。

### 5.2 什么时候截图

- 用户问：“你看下这个报错”“这个界面是什么”；
- 终端退出码非 0，但错误首行不足以判断；
- 当前窗口不是 IDE/终端（浏览器、设计稿、陌生 app）；
- 策略需要确认“他是不是在开会/全屏”。

### 5.3 截图策略

| 场景 | detail | 说明 |
|---|---|---|
| 判断窗口类型/布局 | `low` | 512×512，快、便宜 |
| 读报错/堆栈/小字 | `high` / `original` | 保留细节；每张最多约 1024 tokens |
| 看代码 | 尽量不用截图 | VS Code 扩展直接给文本更准 |
| 看图表/设计稿 | `high` | 视觉模型能看布局，但不要让它编造数据 |

### 5.4 Context Capsule

给 DeepSeek 的输入不要塞整份代码，塞“胶囊”：

```json
{
  "now": "2026-11-11T16:45:00+08:00",
  "app": "Visual Studio Code",
  "project": "payment-service",
  "file": "src/auth/session.ts",
  "language": "typescript",
  "git": { "branch": "fix/race", "dirty": true, "added": 42, "removed": 17 },
  "diagnostics": { "errors": 2, "warnings": 5 },
  "lastTest": { "command": "pnpm test auth", "exitCode": 1, "agoSec": 40 },
  "recent": [
    "auth.spec.ts 连续失败 3 次",
    "同一文件 10 分钟内 undo 5 次"
  ],
  "focusMin": 47,
  "idleSec": 4
}
```

截图作为单独的 image block 附加，不要塞进 JSON。

---

## 6. 主动策略：和以前一样，但更便宜

第一版只做 4 个触发：

1. **测试红→绿**：同一 test 命令 `exitCode` 从非 0 变 0；
2. **测试连续失败**：10 分钟内失败 ≥ 2 次；
3. **长时间专注**：连续 50 分钟无长 idle；
4. **长时间 idle**：> 10 分钟 → 小人睡觉，不主动说话。

策略不变：

```text
value = relevance × timeliness × persona_fit × evidence_strength
cost  = interruption_cost + repetition_penalty + fatigue_penalty
speak if value - cost > threshold
```

因为 DeepSeek 便宜，你可以稍微多给一点上下文，但**不要**因此多说话。  
话少仍然是产品原则。

---

## 7. Live2D：已经选好 Haru

默认模型已经放进仓库：`assets/live2d/haru/`。

- **Haru**，Live2D 官方示例，Cubism 3/4（`Version: 3`）；
- 2 张贴图、8 个表情（F01–F08）、2 个 idle、4 个 `TapBody`；
- 标准口型参数 `ParamMouthOpenY`；
- 头/身体 hit area；
- 约 3.6MB（删掉预录语音后）。

详细说明、表情/动作映射和许可见 [assets/live2d/haru/README.md](../assets/live2d/haru/README.md)。

配置在 [config/avatar.haru.json](../config/avatar.haru.json)：

```json
{
  "model": "./live2d/haru/Haru.model3.json",
  "lipSync": { "param": "ParamMouthOpenY", "gain": 3.0 },
  "expressions": {
    "smile": "F01",
    "surprised": "F02",
    "angry": "F03",
    "sad": "F04",
    "happy": "F05",
    "serious": "F06",
    "embarrassed": "F07",
    "disappointed": "F08"
  }
}
```

技术路线：

- Cubism 3/4 → `pixi-live2d-display` + Pixi 6；
- 口型用 `say` 输出的 WAV 做振幅驱动；
- 表情/动作映射按 `config/avatar.haru.json`；
- 透明窗/点击穿透/多屏不变。

`say` 的好处是：有真实音频，振幅口型比“假装说话”自然。

> 如果你之后换成 Cubism 5 模型，再切官方 Cubism 5 Web SDK 或 `l2d`；现在不用纠结。

---

## 8. 两周冲刺（修订版）

### Week 1

**Day 1–2：Electron 壳**

- 透明置顶窗 + 托盘 + 快捷键 + 点击穿透；
- 双窗口：Avatar / Panel。

**Day 3–4：Live2D**

- 加载模型、idle、点击表情；
- 手动驱动 `ParamMouthOpenY`；
- 确认 60fps。

**Day 5–6：VS Code + 终端**

- VS Code 扩展：文件、诊断、Git、typing；
- zsh hook：命令、退出码、错误首行；
- 本地 HTTP/WS 桥。

**Day 7：DeepSeek 眼睛 + 第一句话**

- 截图 → base64 → `deepseek-flash` vision；
- 测试红→绿 → JSON 话术 → 气泡；
- 先不接 TTS。

### Week 2

**Day 8–9：`say` 嘴巴 + 口型**

- `say` 生成 WAV；
- Web Audio 播放 + 振幅口型；
- 预合成 10 句常用话术缓存。

**Day 10：macOS Speech 耳朵**

- Swift helper + push-to-talk；
- `contextualStrings` 加项目术语；
- 识别失败 fallback 到文本输入。

**Day 11：策略与静音**

- 预算、冷却、DND、访问仪式；
- typing 时取消主动话；
- “别吵了”。

**Day 12：记忆 + 今日回顾**

- SQLite：episodes / facts / feedback；
- 记录测试通过、专注时长、忽略；
- 18:30 生成回顾。

**Day 13–14：打包 + demo**

- DMG、登录自启、权限引导；
- 90 秒 demo：红→绿、卡住退让、下班回顾。

---

## 9. 这个方案的边界

### 能做好

- 看见 IDE/终端/Git 的工作状态；
- 看见当前窗口截图，理解报错/界面；
- 用自然语言聊工作；
- 用系统声音说话，Live2D 口型同步；
- push-to-talk 语音输入；
- 记住项目、偏好、今天发生了什么；
- 成本极低。

### 做不好

- **声音不像 anime 声优**：`say` 是系统朗读；
- **不能克隆音色**：没有 TTS 模型；
- **代码术语识别一般**：ASR 对 `useEffect`、`auth.spec.ts` 容易错；
- **视觉细节有限**：小字/复杂图表可能读错，重要判断仍要靠 IDE 文本；
- **没有真正的实时语音对话**：push-to-talk，不是全双工。

### 升级路径（以后）

1. 声音：本地 GPT-SoVITS / CosyVoice（需要 GPU/模型，不需要 API key）；
2. 耳朵：`whisper.cpp` small / Deepgram（如果要流式）；
3. 视觉：DeepSeek 已经够用；需要更强时再加一个 VLM；
4. 全双工：本地 VAD + 流式 ASR + 流式 TTS，工程量大，后置。

---

## 10. 下一步

模型已经解决：默认用 `assets/live2d/haru/`，不需要你再找。

现在只需要准备：

1. **DeepSeek API key**；
2. **一个常跑的测试命令**（`pnpm test` / `pytest` / `go test` / `cargo test`）；
3. 确认你接受 **Haru** 这个形象（安静、有点酷的“同桌”）；不喜欢再换 Hiyori/Mao。

我建议第一个可运行骨架只做：

- Electron 透明窗 + Live2D（Haru）+ 点击穿透；
- VS Code 扩展 + zsh hook；
- 测试红→绿 → `deepseek-flash` → 气泡；
- 先不接 `say`，确认“看见工作 → 判断 → 说一句”通了，再加嘴巴。

然后再加：

- `say` + 振幅口型；
- macOS Speech push-to-talk；
- 预算/冷却/记忆。

> 只有 DeepSeek API 不是限制，反而让第一版更聚焦：  
> **一个大脑、一双眼睛、一张系统嘴、两只系统耳朵，加上一个 Live2D 小人。**
