# GUI loop 骨架与离线评测（v0）

> 2026-11-23 落地。目标不是“能点”，而是先把**执行环的形状**和**可靠性的数量级**固定下来，再决定要不要接真实鼠标。
> 相关调研：[gui-agent-workflow-notes.md](gui-agent-workflow-notes.md)

---

## 1. 这次做了什么

| 文件 | 作用 |
|---|---|
| `src/main/gui/types.ts` | 公共类型：Rect / Observation / Target / Delivery / Trace / 事件 |
| `src/main/gui/geometry.ts` | 归一化坐标、IoU、命中判定、稳定签名 |
| `src/main/gui/prompt.ts` | 定位与验证的 prompt 构造 + 回复解析（指令在图前、网格、JSON 约束） |
| `src/main/gui/loop.ts` | 唯一的执行环：OBSERVE → LOCATE → GUARD → PREVIEW → ACT → VERIFY |
| `src/main/gui/scenarios.ts` | 20 条简单任务（点击/输入/滚动/下拉/不可逆/1–3 步） |
| `src/main/gui/simulate.ts` | 可调错误率的假定位器/假验证器 + 指标聚合 |
| `scripts/gui-eval.mjs` | 评测 CLI：扫“单步定位率 → 任务成功率” |
| `scripts/test-gui-loop.mjs` | 13 条单元测试（重试、阶梯、熔断、假成功、解析） |

没有改 Electron 主进程、没有申请新权限、没有接真实鼠标。

---

## 2. 执行环的契约

```text
OBSERVE → LOCATE → GUARD → PREVIEW → ACT → VERIFY
             ↑                              │
             └──────── RETRY(≤N) ←──────────┘
```

**刻意的约束：**

- 一步一个动作，不做批量（batch 会放大“动作前确认”的难度）；
- 最多 3 步、每步最多 3 次尝试、整个任务 8–11 次定位预算；
- 失败不“重试到成功”；走完动作阶梯还不行就停；
- 不可逆动作默认 `confirm`，**没有确认回调就拒绝**（安全默认）；
- 相同目标连续失败 → `loop_detected`，而不是继续点；
- 动作后必须 `verify`，`confirmed` 才算这一步完成。

**动作阶梯：**

| 档位 | 语义 | 验证 |
|---|---|---|
| `ax` | 无障碍动作 | 读回可 `confirmed` |
| `bg_pixel` | 背景像素投递，不抬窗、不动真实指针 | 只能 `unverifiable`，要再观察 |
| `foreground` | 前台真实输入 | 同上，最后兜底 |

---

## 3. 怎么跑

```bash
export PATH="$PWD/.node/node-v22.23.4-darwin-arm64/bin:$PATH"

npm run typecheck
node --experimental-strip-types --no-warnings --test scripts/test-gui-loop.mjs
SIMS=100 node --experimental-strip-types --no-warnings scripts/gui-eval.mjs
```

`SIMS` 控制每条任务的模拟次数；`--json` 输出原始指标。

---

## 4. 当前数字（SIMS=100，固定种子）

| 单步定位 | 任务成功率 | 假成功 | 单步成功率 | 平均尝试 | 点错目标 |
|---|---|---|---|---|---|
| 60% | 80.2% | 3.5% | 84.1% | 2.08 | 41.5% |
| 70% | 86.7% | 2.1% | 89.5% | 1.91 | 29.6% |
| 80% | 94.0% | 1.1% | 95.3% | 1.70 | 16.3% |
| 90% | 99.4% | 0.1% | 99.5% | 1.50 | 1.3% |
| 95% | 99.5% | 0.1% | 99.6% | 1.43 | 1.4% |

> **2026-11-23 真实校准**：同一台机器、当前屏幕，0..1 坐标下 click 命中 **68–75%**、±4px **75–78%**、IoU≥0.5 约 **35%**；改用 0–999 后降到 **63%**（20 目标 × 3 轮，详见 [gui-grounding-calibration.md](gui-grounding-calibration.md) 第 10 节）。坐标空间应按模型配置。
> 因此下面这张表应理解为“给定单步命中率”的敏感度曲线；默认 80% 偏乐观，真实回填后 1–3 步任务约 87%，但**假成功约 15%**。

### 怎么读这张表

- **这是上界，不是预期。** 模拟里验证器接近完美（漏判 5%）、重试会重新定位、任务只有 1–3 步、目标单一。真实环境里错误是相关的、界面会变、验证器更瞎。
- **重试能把 60% 的单步救到 80%。** 靠的不是模型变准，而是“验证 → 重新定位”这个环。
- **假成功是最该盯的指标。** 60% 时 3.5% 的任务会“报告完成但点错了”；这比失败更危险。降低它只能靠更强的验证（读回、断言具体状态），不能靠多试。
- **`stickyRate` 是相关性的旋钮。** 默认 0.5：上一轮点错，这一轮有一半概率还点同一个地方。把它调到 1，曲线会显著变差——这也是真实系统的样子。

---

## 5. 下一步（按顺序）

1. **接一个真实定位器**：`VisionGrounder`，用 `DeepSeek-V4-Flash-Vision-Exp` + 截图 + `prompt.ts`，先只读、不点，用 20 条场景量真实 grounding。
2. **录屏回放**：把真实截图存成 fixture，跑同一套 loop，验证坐标归一化与 Retina 换算。
3. **`native/gui.swift`**：click/type/key/scroll，先只做前台模式；配合“用户一动鼠标就让位”。
4. **Action Card + 审计表**：preview 高亮、不可逆确认、`actions` 表。
5. **Watcher**：把“到条件就做”接到同一套 loop 上（影子模式 → 转正）。

> 在第 1 步拿到真实 grounding 数字之前，不建议写 `native/gui.swift` 的像素级点击——否则调的是“点击实现”，不是“产品可行性”。

---

## 6. 已知的坑（留给下一版）

- 多屏 / Retina：归一化只在单屏内成立；跨屏要带 display id 和 origin。
- 中文输入：真实实现要用剪贴板 + Cmd+V，不能逐字 key。
- 锁屏 / 息屏：合成事件大概率不生效，必须有“只通知不动手”的降级。
- 验证器成本：每次 verify 也是一次 VLM 调用，预算要算进去。
- 场景覆盖：目前 20 条都是单窗口、单目标；还没有“目标被遮挡”“弹窗抢焦点”“滚动后目标移位”。
