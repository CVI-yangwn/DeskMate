# Haru（Live2D 模型包）

## 这是什么

- 角色：**Haru**，Live2D 官方示例模型。
- 版本：`Haru.model3.json` 的 `Version` 为 **3**，对应 **Cubism 3/4**，可直接用 `pixi-live2d-display`（PixiJS 6）加载。
- 用途：DeskMate 的默认桌面形象。
- 来源：[Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples) 的 `Samples/Resources/Haru`。

## 为什么选 Haru

| 需求 | Haru |
|---|---|
| Cubism 3/4，能直接用 `pixi-live2d-display` | ✅ |
| 有表情（情绪反馈） | ✅ 8 个（F01–F08） |
| 有 idle 动作 | ✅ 2 个 |
| 有点击动作 | ✅ 4 个 `TapBody` |
| 标准口型参数 | ✅ `ParamMouthOpenY` |
| 头和身体 hit area | ✅ `Head` / `Body` |
| 体积 | 约 3.6MB（删掉预录语音后），适合桌宠 |

角色气质：安静、稍微有点酷的“同桌”，适合“偶尔毒舌、不鸡汤”的 persona。  
如果你想要更软的邻家感，可以把 `assets/live2d/hiyori` 作为备选；Hiyori 的 idle 更多，但没有表情。

## 文件结构

```text
haru/
├─ Haru.model3.json
├─ Haru.moc3
├─ Haru.2048/
│  ├─ texture_00.png
│  └─ texture_01.png
├─ Haru.physics3.json
├─ Haru.pose3.json
├─ Haru.cdi3.json
├─ Haru.userdata3.json
├─ expressions/
│  ├─ F01.exp3.json ... F08.exp3.json
├─ motions/
│  ├─ haru_g_idle.motion3.json
│  ├─ haru_g_m01.motion3.json ... m26.motion3.json
├─ preview.jpg
└─ README.md
```

## 表情映射（DeskMate 用）

表情本身只有 F01–F08，没有语义名。下面按参数推测，实际以画面为准，跑起来后可微调：

| 语义 | 表情 | 说明 |
|---|---|---|
| neutral | 无 | 不叠加表情 |
| smile | `F01` | 嘴角轻微上扬 |
| surprised | `F02` | 睁眼、张嘴、眉毛变化 |
| angry | `F03` | 皱眉、嘴角下压 |
| sad | `F04` | 眉眼下垂、担心 |
| happy | `F05` | 眯眼笑 |
| serious | `F06` | 睁大眼、认真/有点不爽 |
| embarrassed | `F07` | 害羞（`ParamTere`） |
| disappointed | `F08` | 失落/无奈 |

## 动作映射（DeskMate 用）

| 语义 | 动作组 | index | 备注 |
|---|---|---|---|
| idle | `Idle` | 随机 | 2 个 idle |
| celebrate | `TapBody` | 0 | 先当庆祝，跑起来看实际动作再换 |
| tease | `TapBody` | 1 | 逗/吐槽 |
| comfort | `TapBody` | 2 | 安慰/关心 |
| think | `TapBody` | 3 | 思考 |

> `TapBody` 的 4 个动作原本带日语语音（`sounds/*.wav`）。为了不让 Haru 突然说日语，已经删除 `Haru.model3.json` 里的 `Sound` 字段和 `sounds/` 目录；所有声音统一走 DeskMate 的 TTS。

## 口型

- 口型参数：`ParamMouthOpenY`（0–1）。
- 用 `say` 生成的 WAV 播放时，取 `AnalyserNode` 的 RMS，乘一个增益（默认 3.0），再 clamp 到 1.0。
- 不建议直接用手写 sin 波，振幅驱动更自然。

## 使用

```ts
const model = await Live2DModel.from('./live2d/haru/Haru.model3.json');
model.anchor.set(0.5, 1);
model.scale.set(0.82);
```

打包时把 `assets/live2d/haru` 放进 Electron 的 `extraResources`，或者放在 `public/` 下由 Vite 复制。

## 校验

```bash
node scripts/check-live2d-model.mjs assets/live2d/haru/Haru.model3.json
```

应输出 `missing: []`，并且：

- `version: 3`
- `expressions: F01...F08`
- `motions: { Idle: 2, TapBody: 4 }`
- `lipSyncGroup: ["ParamMouthOpenY"]`
- `hitAreas: ["Head", "Body"]`

## 许可

- 模型在 Live2D **Free Material License** 下提供，使用需同意 [Live2D Cubism Sample Data Terms of Use](https://www.live2d.com/en/learn/sample/model-terms/)。
- 仓库根目录保留了 `assets/live2d/LICENSE-Live2D-CubismWebSamples.md` 和 `assets/live2d/NOTICE-Live2D.md`。
- 个人自用没问题；如果以后要商用/分发，重新确认 Live2D 的 SDK 与模型条款。

## 备注

- 这是 Cubism 3/4 模型，不是 Cubism 5；所以第一版用 `pixi-live2d-display`，不要用 Cubism 5 的 core 去加载。
- 如果 `pixi-live2d-display` 加载时报 `CubismCore is not defined`，检查 `public/live2dcubismcore.min.js` 是否在 bundle 之前加载。
