/**
 * App 内路径冒烟：直接实例化 BrainService，让它通过 chatWithTools 调 gui_task。
 * 运行：esbuild 打包后 `DESKMATE_GUI=1 electron .tmp/gui-brain-smoke.mjs`
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';
import { BrainService } from '../src/main/brain';

const root = process.cwd();
const gui = path.join(root, 'native/gui');
const axdump = path.join(root, 'native/axdump');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function press(label: string): boolean {
  try {
    execFileSync(gui, ['press', '--bundle', 'com.apple.calculator', '--label', label], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  try {
    execFileSync('caffeinate', ['-u', '-t', '10']);
    execFileSync('open', ['-b', 'com.apple.calculator']);
    await sleep(2200);
    execFileSync('osascript', ['-e', 'tell application "Calculator" to activate']);
    await sleep(800);

    let cleared = false;
    for (let i = 0; i < 5 && !cleared; i += 1) {
      cleared = press('清除');
      if (!cleared) await sleep(600);
    }
    console.log('cleared:', cleared);
    press('7');
    await sleep(400);

    const message = process.env.SMOKE_MESSAGE ?? '用 GUI 操作：点击计算器上的数字 7，让显示区只显示 7。';
    console.log('message:', message);
    const brain = new BrainService();
    const reply = await brain.chat(message, []);
    console.log('reply:', JSON.stringify(reply).slice(0, 800));

    const ax = JSON.parse(execFileSync(axdump, ['--bundle', 'com.apple.calculator'], { encoding: 'utf8' }));
    const texts = ax.nodes.filter((n: { role: string }) => n.role === 'AXStaticText').map((n: { value?: string }) => n.value).filter(Boolean);
    console.log('calculator display:', texts.join(' | '));
  } catch (error) {
    console.error('SMOKE FAILED:', String(error).slice(0, 800));
  } finally {
    app.exit(0);
  }
});
