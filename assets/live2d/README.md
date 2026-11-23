# Live2D 资产

## 默认：小黑（hijiki）

- 路径：`assets/live2d/hijiki/hijiki.model.json`
- 版本：Cubism 2（`Sample 1.0.0`）
- 特征：一只坐着的黑猫；1 个 idle + 8 个动作；没有表情文件；没有独立口型参数（说话时靠动作和身体反应）
- 配置：`config/avatar.json`（`scale: 0.6`，窗口 240×300）
- 运行时：`assets/live2d.min.js`（Cubism 2 Core）
- 许可与来源：见 [hijiki/README.md](hijiki/README.md)

选它的原因：**小、卡通、安静。** 黑猫坐在暖纸色的桌角，和“台灯下的同桌”是一套；比 Haru 小一圈，不挡工作区。黑猫在浅色桌面上对比清楚，没有角标和投影。

## 备选：Haru

- 路径：`assets/live2d/haru/Haru.model3.json`
- 版本：Cubism 3/4
- 特征：8 个表情、2 个 idle、4 个 `TapBody`、`ParamMouthOpenY` 口型
- 配置：`config/avatar.haru.json`（保留作备选）

`Live2DStage` 从 `pixi-live2d-display` 根入口加载，两套运行时（`live2d.min.js` + `live2dcubismcore.min.js`）都在页面里，所以把 `config/avatar.json` 的 `model` / `scale` / 动作映射换成 Haru 的那份即可切回，不用改渲染代码。

## 校验

```bash
npm run check:model
# 或指定模型
node scripts/check-live2d-model.mjs assets/live2d/haru/Haru.model3.json
```

输出 `missing: []` 即文件完整；Cubism 2 和 Cubism 3/4 都支持。
