# Memory evals

`scripts/eval-memory.mjs` 是零模型的检索体检。

## 最快：用现有 wiki 自动出题

```bash
node --experimental-strip-types --no-warnings scripts/eval-memory.mjs --auto
```

每页生成“现在是什么状态 / 还有什么没做完”两题，检查正确页面能否进 top-4。它只验证检索，不验证回答质量。

## 真实评测：最近 30 个问题

复制 `memory-questions.example.json` 为 `memory-questions.json`，换成最近 3–4 周真实问过的问题，标上 gold 页面（没有就留空）：

```json
[
  { "question": "上周那个决定改了吗？", "goldPage": "DeskMate" }
]
```

```bash
node --experimental-strip-types --no-warnings scripts/eval-memory.mjs \
  --questions evals/memory-questions.json --out /tmp/memory-eval.md
```

看 `Recall@4`、零命中率、注入字符均值。建议每月跑一次；连续两个月 Recall@4 < 70% 再考虑双链/embedding。
