# 给 macOS DeepSeek Harness 的安装/运行指令

把下面整段复制给 macOS 上的 DeepSeek Harness。  
它会把服务器上的源码包下载到 Mac，安装依赖，配置内网 API，启动 DeskMate，并做基本验收。

```text
你是一个 macOS 上的 DeepSeek Harness 编码代理。请独立完成 DeskMate 的安装、构建和启动验收。

## 目标
在 ~/DeskMate 安装并运行 DeskMate：
- Electron + React + TypeScript
- Live2D Haru 透明桌面形象
- 前台窗口 + 屏幕截图感知
- 百度内网 oneapi：https://oneapi-comate.baidu-int.com/v1
- 文本模型 DeepSeek-V4.1-Flash
- 视觉模型 DeepSeek-V4-Flash-Vision-Exp
- macOS say 发声

## 硬约束
- 不要加 VS Code 插件，不要依赖 VS Code。
- 不要重构架构，不要改 src/main 的窗口/感知逻辑；只做安装、配置、运行和必要的小修复。
- 不要打印、提交、写日志或回显 DEEPSEEK_API_KEY。
- 如果遇到权限弹窗，停下来让用户点“允许”，不要绕过系统权限。
- 如果遇到无法解决的错误，保留完整日志并汇报，不要反复瞎改。

## 步骤

### 1. 下载源码
在 Mac 上执行：

mkdir -p "$HOME/DeskMate"
curl -fL --retry 3 --connect-timeout 10 \
  http://10.94.180.244:8989/deskmate-src.tar.gz \
  -o /tmp/deskmate-src.tar.gz
tar -xzf /tmp/deskmate-src.tar.gz -C "$HOME/DeskMate" --strip-components=1

如果 8989 连不上或 404：停下来，让用户从服务器复制
/ssd3/yangwennuo/code/MNL/work_agent/dist/deskmate-src.tar.gz
到 Mac 的 ~/Downloads，然后执行：
tar -xzf "$HOME/Downloads/deskmate-src.tar.gz" -C "$HOME/DeskMate" --strip-components=1

### 2. 检查 Node
执行：
node -v
npm -v

需要 Node >= 22。如果版本不够，先安装 Node 22+（Homebrew 或 nvm），再继续。

### 3. 安装与构建
cd "$HOME/DeskMate"
bash scripts/macos-setup.sh

这一步会：
- 复制 .env.example 为 .env.local；
- npm install；
- npm run typecheck；
- npm run build。

### 4. 配置 API
检查 .env.local，确保包含：

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://oneapi-comate.baidu-int.com/v1
DEEPSEEK_MODEL=DeepSeek-V4.1-Flash
DEEPSEEK_VISION_MODEL=DeepSeek-V4-Flash-Vision-Exp

如果 DEEPSEEK_API_KEY 为空：停下来，让用户自己把有效 key 填进 .env.local 的等号后面。
不要问用户要 key，不要打印 key，不要把它写进任何其他文件。

然后验证（不要把 key 打印出来）：
cd "$HOME/DeskMate"
set -a; . ./.env.local; set +a
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  "$DEEPSEEK_BASE_URL/models"

期望 HTTP 200。401 表示 key 无效；000/连不上表示需要公司网络/VPN。

### 5. 校验模型
cd "$HOME/DeskMate"
npm run check:model

期望输出里 missing: []。

### 6. 启动应用
cd "$HOME/DeskMate"
nohup npm run dev > /tmp/deskmate-dev.log 2>&1 &
echo $! > /tmp/deskmate-dev.pid
sleep 8
tail -60 /tmp/deskmate-dev.log

如果日志没有明显错误，检查本地事件桥：
curl -sS http://127.0.0.1:39876/health

期望 {"ok":true}。
如果没有，汇报 /tmp/deskmate-dev.log 的最后 80 行。

### 7. 权限
首次运行 macOS 会弹：
- 屏幕录制；
- 辅助功能。

让用户去“系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能”勾选 DeskMate（开发模式下可能显示为 Electron）。
授权后重启应用：
kill "$(cat /tmp/deskmate-dev.pid)" 2>/dev/null || true
cd "$HOME/DeskMate"
nohup npm run dev > /tmp/deskmate-dev.log 2>&1 &
echo $! > /tmp/deskmate-dev.pid
sleep 8
tail -40 /tmp/deskmate-dev.log

### 8. 验收
cd "$HOME/DeskMate"
npm run demo:pass

然后：
- 检查 /tmp/deskmate-dev.log 是否有报错；
- 让用户确认：桌面右下角有 Haru；面板能打开；点“扫描当前屏幕”后能看到当前应用/窗口/活动；点“模拟红→绿”后有气泡，macOS 上有 say 声音。

可选：截一张屏给用户确认：
screencapture -x /tmp/deskmate-proof.png

### 9. 汇报
最后用中文汇报：
- Node/npm 版本
- 源码下载/解压是否成功
- npm install / typecheck / build 是否成功
- API /models 的 HTTP 状态
- npm run check:model 的 missing 是否为空
- 事件桥 /health 是否 ok
- 屏幕录制 / 辅助功能是否已授权
- 应用是否启动，Haru/面板是否可见
- 任何错误日志（不要包含 key）

如果任何一步失败，停在那一步，汇报具体命令和错误，不要继续往下猜。
```

## 如果用户想手动跑

```bash
cd ~/DeskMate
npm run dev
```

然后在另一个终端：

```bash
cd ~/DeskMate
npm run demo:pass
```
