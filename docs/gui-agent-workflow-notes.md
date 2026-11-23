# GUI Agent 工作流调研：他们怎么规划，哪些能抄

> 时间：2026-11-23
> 目的：给 DeskMate 增加“通用 GUI 操作”提供设计输入。只看**工作流**——怎么观察、怎么定位、怎么动手、怎么验证、怎么收场；不评模型强弱。
> 结论先行：成熟方案不是“一个大模型看屏幕然后点”，而是把循环拆成五段：**观察 → 定位 → 动作（按能力降级）→ 验证（读回，而不是假设成功）→ 记录/学习**。模型只是其中一段。

---

## 0. 一句话结论

这一波 GUI agent 的真正分水岭，不在“能不能点中”，而在三件事：

1. **观察是否双通道**：结构化树（AX/DOM）说“有什么可点”，截图说“是哪一个”。
2. **动作是否有阶梯**：优先走可自验证的通道，失败再降级，而不是一上来就模拟鼠标。
3. **是否验证感知**：把“我发了点击”和“界面真的变了”分开；没有读回，就不算成功。

---

## 1. 五种流派

| 流派 | 代表 | 工作流特征 | 优点 | 代价 |
|---|---|---|---|---|
| **端到端原生 CUA** | UI-TARS-2、Fara1.5、Holo、MAI-UI | 单模型把感知、推理、动作、记忆统一，直接输出动作 | 延迟低、演示顺滑 | 不可审计、难局部修改；GUI-only 有上限（UI-TARS-2 自己加了文件系统/终端） |
| **编排式 Agent** | Agent-S、Cua、Claude computer use | planner / grounder / actor / verifier 分离，harness 拥有循环 | 可换模型、可加护栏、可审计 | 每步多次调用，工程复杂 |
| **纯结构化** | vercel-labs/agent-desktop、page-agent、browser-use | 只读 AX/DOM，元素带 ref，不截图 | 准、快、便宜、可验证 | 覆盖不全：canvas、游戏、自绘控件读不到 |
| **混合阶梯** | Cua Driver | AX → 背景像素 → page → 前台，运行时探测能力 | 通用性与可靠性最平衡；不写 App 适配器 | 需要处理多档降级与“未确认”状态 |
| **接口进化** | Agent S4、UI-Evol | 从轨迹里长出自定义接口/知识库，把重复任务编译成宏 | 同模型 3.8x 提升（S4） | 需要任务量与验证器，冷启动慢 |

> 对 DeskMate 最相关的是第 3、4、5 类：**结构化优先、像素兜底、成功轨迹沉淀成技能**。第 1 类学不来（要训练），第 2 类可以借结构。

---

## 2. 七个可复用的设计模式

### P1 双通道观察：树 + 截图

Cua Driver 的 `get_window_state` 一次返回**该窗口的无障碍树 + 截图**：树给出 role、label、`element_token`，截图告诉你“是哪一个”，并补上树漏掉/标错的东西。

- 指令文本放在截图**之前**（Anthropic 文档明确说这能提升点击准确率）。
- 小字/密集 UI 用 `zoom` 抓局部原图，而不是把整屏放大。
- 密集界面可用“编号元素”（OmniParser / Set-of-Mark 路线）：先解析成带编号的框，再让模型选编号，比直接回归坐标准、可解释。

### P2 动作阶梯：AX → 背景像素 → 前台

Cua Driver 的“background-first action ladder”值得直接抄：

| 档位 | 做法 | 能否自验证 | 适用 |
|---|---|---|---|
| 1 | 无障碍动作（macOS `AXPerformAction`） | ✅ 读回即可确认 | 原生控件 |
| 2 | 背景像素（按同一张截图的 x,y 投递，不抬窗、不动真实指针） | ❌ 只能“疑似生效” | 自绘控件、Electron |
| 3 | 前台（抬窗、真实输入、结束恢复原 App） | ❌ | 游戏、Blender 这类 canvas、焦点轮询应用 |

关键细节：背景投递时 Agent 有自己的光标叠加层，**不抢用户鼠标**；只有降到前台才接管。跨档重试只重试那一个动作，不重跑整段。

### P3 “发出事件 ≠ 生效”

这是最容易被忽略、也最值钱的一条。Cua Driver 把结果分成五态：

- `confirmed`：只有无障碍读回能给；
- `unverifiable`：事件投递了，但对方可能“回显了却没应用”（Electron/Catalyst/网页内容常见）；
- `suspected_noop`：看起来什么都没发生；
- `partial`：部分生效；
- `refused`：拒绝执行，并带 `escalation {recommended: px | page | foreground, reason}`。

> 产品含义：**不要用“点击成功”当成功**。要么读回，要么再截一张图问“变了吗”，否则一律算未确认。

### P4 验证感知控制 + 一致同意的 DONE

- Anthropic 的提示词实践：每一步后截图，用一句话说“截图显示了什么、这一步是否成功”，确认后才继续。
- CANDID（arXiv 2611.24977）发现本地 CUA 的两个高频故障：**僵化的动作循环**和**过早宣布 DONE**；解法是循环恢复（过滤重复行为）+ **全体一致才允许终止**。
- Fara1.5 的数据管线用三类验证器：任务正确性、效率、**关键点依从**（该做的步骤有没有跳过）。

### P5 循环与卡死处理

- 相同 `(target, action)` 连续出现 → 强制换策略或放弃；
- `stale_element_token` → 重新快照，而不是硬点旧坐标；
- 步数、时间、token 三预算；超预算问人；
- 失败两次即升级（换档 / 换目标 / 停），**绝不“重试到成功”**。

### P6 计划-动作一致性：错在动作，不在计划

PACT（arXiv 2611.22591）指出：GUI agent 经常“计划是对的，动作却执行错了”，一个执行错误就能毁掉整条链；修复应该在动作层，而不是把整个计划重写。

IntentScore（arXiv 2604.05157）用 plan-aware 打分器给候选动作排序，接到 Agent S3 上把 OSWorld 成功率提了 6.9 个点——说明**动作级 re-rank** 比“再想一遍”更划算。

### P7 记忆：不要回放原始历史，要沉淀接口

- Efficient GUI Agents  survey（arXiv 2609.02309）总结的五条趋势：选择性读取、全局到局部的视觉分配、**可恢复记忆**而非原始历史回放、验证感知控制、GUI/非 GUI 混合运行时。
- Agent S4（arXiv 2610.28601）：让 meta-agent 从轨迹里演化出“接口仓库”，同一个 Qwen3.8-27B 在 OSWorld V2 上达到 21.3%，是同模型固定接口版本的 3.8 倍。
- UI-Evol（arXiv 2505.21964）：知识 90% 正确，执行成功率也只有 41%——**知道怎么做 ≠ 做得到**，所以要把“动作序列”本身沉淀下来。

> 对 DeskMate：每次成功任务后，把 `目标 → 元素 → 动作 → 验证条件` 存成一条可复用 skill；下次先查 skill，再走通用循环。这和你现有的 `skills/` 体系是同一件事。

---

## 3. 安全：三条必须继承的教训

1. **跨屏组合伤害**（SEAM，arXiv 2611.22971）：指令和每一屏单独看都无害，组合起来才有害；通用 agent 在最多 **92%** 的 run 里照做。更关键的是：**同样的警告，写在用户指令里能拦住，写在屏幕上就拦不住**。
   → 对 watcher 的直接含义：**屏幕内容永远不能成为授权来源**；只有用户消息/预置规则能授权。
2. **Prompt injection**：Anthropic 在工具返回的截图上跑分类器，命中后让模型先确认“这条指令是不是用户说的”；同时要求对金融交易、接受条款等动作做人审。
3. **人类接管**：可见的光标/高亮、随时可停、前台操作前告知。可见性不是装饰，是信任的来源。

---

## 4. 数据：别被 demo 骗

| 数据 | 含义 |
|---|---|
| OSWorld V2 严格二值：开源 SOTA **21.3%**，GPT-5.5 13.0%，Opus 4.8 20.6% | 长程桌面任务仍然很难 |
| OSWorld 原版：Agent S3 **72.6%**（首个超人类） | 不同 benchmark 不可直接比较 |
| UI-Evol：知识 90% 正确 → 执行成功 **41%** | “会”与“做得到”之间有巨大鸿沟 |
| SEAM：最高 **92%** 的伤害执行率 | 安全识别不等于安全执行 |
| Agent S4：同模型换接口 **3.8x** | 接口/harness 的收益可能大于换模型 |

结论：**单步可用，长链不可靠**。产品必须按“1–3 步 + 每步验证 + 随时中断”设计，而不是承诺“什么都能干”。

---

## 5. 映射到 DeskMate 的 GUI-only 工作流

### 5.1 状态机

```text
IDLE
  └─(任务/条件触发)→ OBSERVE ─→ LOCATE ─→ PREVIEW ─→ ACT ─→ VERIFY
                         ↑                                  │
                         └──────── RETRY(≤1) ←──────────────┤
                                                            ├→ DONE
                                                            └→ ESCALATE / ABORT
```

### 5.2 五个角色（可以是同一个模型的三段 prompt）

| 角色 | 输入 | 输出 | 备注 |
|---|---|---|---|
| Planner | 用户一句话 + 当前屏 | 1–3 步计划 | 不展开长链 |
| Grounder | 截图（带网格/编号）+ 目标描述 | `{label, bbox, confidence}` | 指令在图前；低置信度直接问人 |
| Actor | 目标 + 动作 | 执行（按阶梯） | 记录 delivery 档位 |
| Verifier | 动作后截图 + 成功条件 | `confirmed / unverifiable / failed` + 一句证据 | 不确认就不算完 |
| Guard | 动作 + 上下文 | 放行 / 需确认 / 拒绝 | 不可逆动作、跨屏组合、敏感 App |

### 5.3 每一步的数据结构

```ts
interface Step {
  intent: string;
  target: { label: string; bbox: [number, number, number, number]; confidence: number };
  action: { type: 'click' | 'type' | 'key' | 'scroll'; args: Record<string, unknown> };
  delivery: 'ax' | 'bg_pixel' | 'foreground';
  expect: string;                       // 自然语言成功条件
  verify: { result: 'confirmed' | 'unverifiable' | 'failed'; evidence: string };
}
```

### 5.4 具体规则（可直接当验收标准）

- 一次任务最多 **3 步**，每步最多 **1 个动作**；
- 动作前 **PREVIEW**：高亮目标 + 一行“我要点这个”，可被用户打断；
- 动作后 **0.5–2s** 再截图验证；连续 2 次 `failed` → 停；
- 相同 `(target, action)` 连续 2 次 → 判循环，换策略或放弃；
- 锁屏/息屏 → 只通知，不动手；
- 每任务设模型调用预算（例如 8 次），超了问人；
- 成功任务写回 `skills/`：`目标 → 元素 → 动作 → 验证条件`。

### 5.5 Watcher（“看着，到条件就做”）

```text
每 10–30s：本地 OCR / 像素差分（便宜）
   └─ 命中候选 → 截取区域 → VLM 判定（贵，少量）
        └─ 判定为真 → 走 5.1 的状态机（1 步动作）
             └─ 验证通过 → 记录 → 解除武装（等状态回落再重新武装）
```

- 条件建议“自然语言 + 结构化 predicate”双写：自然语言给人看，predicate 给机器判定；
- 新 watcher 先跑**影子模式**（只通知不动手），命中 N 次且用户确认后再“转正”；
- 这与 DeskMate 现有的 `proactive_clues` / `proactive_rules` 是同一套语义，只是把“说不说”换成“做不做”。

---

## 6. 不建议抄的部分

| 不要抄 | 原因 |
|---|---|
| 端到端训练 CUA 模型 | 成本与数据量都不是个人项目能承担的 |
| 刷 OSWorld/WebVoyager 分数 | 与“帮一个人做三件小事”的目标无关 |
| 为每个 App 写 adapter | 你明确要通用；应做**运行时能力探测**，不是静态适配 |
| 相信模型说 DONE | CANDID 已证明这是高频故障 |
| 把 GUI 当唯一通道 | UI-TARS-2 自己都加了文件系统/终端；保留 hybrid 口子，但 v1 可以只用 GUI |
| “重试到成功” | 误操作会累积；失败两次必须升级或停 |

---

## 7. 参考

**框架 / 产品**
- Cua Driver：https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works
- vercel-labs/agent-desktop：https://github.com/vercel-labs/agent-desktop
- Agent-S：https://github.com/simular-ai/Agent-S
- UI-TARS-desktop：https://github.com/bytedance/UI-TARS-desktop
- OmniParser：https://github.com/microsoft/OmniParser
- page-agent：https://github.com/alibaba/page-agent
- Anthropic computer use：https://docs.anthropic.com/en/docs/agents-and-tools/computer-use

**论文**
- Agent S2（组合式 generalist-specialist、Mixture-of-Grounding、层次规划）：arXiv 2504.00906
- Agent S4（Evolving Agent Interfaces）：arXiv 2610.28601
- UI-TARS-2（多轮 RL、混合 GUI 环境）：arXiv 2509.02544
- Fara1.5（环境/求解器/验证器数据管线）：arXiv 2606.20785
- CANDID（本地 CUA 的执行控制、DONE 门控）：arXiv 2611.24977
- PACT（计划-动作一致性）：arXiv 2611.22591
- SEAM（跨屏组合伤害）：arXiv 2611.22971
- IntentScore（动作级打分/re-rank）：arXiv 2604.05157
- Efficient GUI Agents（观察/记忆/动作/运行时综述）：arXiv 2609.02309
- UI-Evol（知识-执行鸿沟）：arXiv 2505.21964
