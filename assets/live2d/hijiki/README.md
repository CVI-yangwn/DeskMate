# Hijiki / 小黑

一只坐着的黑猫 Live2D 模型，用作 DeskMate 的默认桌面形象。

## 文件

| 文件 | 用途 |
|---|---|
| `hijiki.model.json` | Cubism 2 模型设置 |
| `moc/hijiki.moc` | 模型数据 |
| `moc/hijiki.2048/texture_00.png` | 贴图 |
| `hijiki.pose.json` | 手臂显隐 |
| `mtn/00_idle.mtn` | idle |
| `mtn/01–08.mtn` | 8 个动作（点头、甩尾、张嘴等） |

## 来源与许可

- 模型名：hijiki（Live2D 的黑猫示例模型）
- 本次资源取自 `live2d_api` 的镜像仓库 [`akyuu-cn/thermal-cat`](https://github.com/akyuu-cn/thermal-cat)（`live2d_api/model/hijiki`）
- 运行时：`assets/live2d.min.js`，Live2D Cubism 2 Core；使用条款见 [Live2D 官方文档](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)
- 用途：个人原型 / 非商业；**商用或再分发前请向 Live2D 确认模型与运行时的授权**。

## 切换

`config/avatar.json`：

```json
{
  "id": "hijiki",
  "model": "./live2d/hijiki/hijiki.model.json",
  "scale": 0.6
}
```

模型没有表情文件，`config/avatar.json` 里的 `expressions` 全部为 `null`；说话时用 `motions` 里的动作，口型参数 `PARAM_MOUTH_OPEN_Y` 不存在时会自动跳过。
