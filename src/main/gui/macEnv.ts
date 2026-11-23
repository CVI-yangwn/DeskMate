import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, screen } from 'electron';
import { captureFocusedDisplay, readActiveWindow } from '../perception.ts';
import { LocalMacEnvironment } from './environment.ts';
import type { GuiEnvironmentDeps, GuiObservation } from './environment.ts';

const execFileAsync = promisify(execFile);

function guiBinary(): string {
  const candidates = [
    path.join(process.cwd(), 'native/gui'),
    path.join(app.getAppPath(), 'native/gui'),
    path.join(process.resourcesPath, 'native/gui'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('找不到 native/gui，先编译：swiftc -O native/gui.swift -o native/gui');
  return found;
}

async function capture(): Promise<GuiObservation> {
  if (process.platform !== 'darwin') throw new Error('GUI 环境目前只支持 macOS');
  const active = await readActiveWindow();
  const frame = await captureFocusedDisplay(active, 1280);
  if (!frame) throw new Error('截屏失败：检查屏幕录制权限');
  // 锁屏/休眠时 screencapture 会给出接近全黑的图；别对着黑图点。
  if (frame.base64.length < 30_000) {
    throw new Error('屏幕可能是锁屏/黑屏，GUI 操作已中止');
  }
  const display =
    screen.getAllDisplays().find((item) => String(item.id) === frame.displayId) ??
    screen.getPrimaryDisplay();
  return {
    screenshot: `data:image/jpeg;base64,${frame.base64}`,
    width: frame.width,
    height: frame.height,
    screenWidth: display.size.width,
    screenHeight: display.size.height,
    app: frame.app,
    title: frame.title,
  };
}

async function act(
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; message: string; error?: string }> {
  const binary = guiBinary();
  const run = (args: string[]) => execFileAsync(binary, args, { timeout: 8_000 });
  try {
    switch (action) {
      case 'move': {
        const x = Number(params.x);
        const y = Number(params.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { success: false, message: 'move 缺少 x/y', error: 'bad-args' };
        }
        await run(['move', '--x', String(x), '--y', String(y)]);
        return { success: true, message: `moved (${x}, ${y})` };
      }
      case 'click': {
        const x = Number(params.x);
        const y = Number(params.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { success: false, message: 'click 缺少 x/y', error: 'bad-args' };
        }
        const button = String(params.button ?? 'left');
        const count = Math.min(3, Math.max(1, Number(params.num_clicks) || 1));
        await run([
          'click',
          '--x',
          String(x),
          '--y',
          String(y),
          '--button',
          button,
          '--count',
          String(count),
        ]);
        return { success: true, message: `clicked ${button} x${count} (${x}, ${y})` };
      }
      case 'drag': {
        const x1 = Number(params.x1);
        const y1 = Number(params.y1);
        const x2 = Number(params.x2);
        const y2 = Number(params.y2);
        if (![x1, y1, x2, y2].every(Number.isFinite)) {
          return { success: false, message: 'drag 缺少起点/终点', error: 'bad-args' };
        }
        const duration = Math.min(3000, Math.max(100, Number(params.duration) || 500));
        await run([
          'drag',
          '--x1',
          String(x1),
          '--y1',
          String(y1),
          '--x2',
          String(x2),
          '--y2',
          String(y2),
          '--duration',
          String(duration),
        ]);
        return { success: true, message: `dragged (${x1},${y1}) -> (${x2},${y2})` };
      }
      case 'type': {
        const text = String(params.text ?? '');
        if (!text) return { success: false, message: 'type 缺少 text', error: 'bad-args' };
        await run(['type', '--text', text]);
        return { success: true, message: `typed ${text.slice(0, 40)}` };
      }
      case 'press_key': {
        const key = String(params.key ?? '');
        if (!key) return { success: false, message: 'press_key 缺少 key', error: 'bad-args' };
        await run(['key', '--combo', key]);
        return { success: true, message: `pressed ${key}` };
      }
      case 'hotkey': {
        const keys = Array.isArray(params.keys) ? params.keys.map(String) : [];
        if (keys.length < 2) return { success: false, message: 'hotkey 需要至少两个键', error: 'bad-args' };
        await run(['key', '--combo', keys.join('+')]);
        return { success: true, message: `pressed ${keys.join('+')}` };
      }
      case 'scroll': {
        const dy = Number(params.dy) || 0;
        const args = ['scroll', '--dy', String(dy)];
        if (Number.isFinite(Number(params.x)) && Number.isFinite(Number(params.y))) {
          args.push('--x', String(params.x), '--y', String(params.y));
        }
        await run(args);
        return { success: true, message: `scrolled ${dy}` };
      }
      default:
        return { success: false, message: `不支持的动作：${action}`, error: 'unsupported-action' };
    }
  } catch (error) {
    return { success: false, message: `执行失败：${String(error).slice(0, 200)}`, error: 'exec-failed' };
  }
}

export function createLocalMacEnvironment(): LocalMacEnvironment {
  const deps: GuiEnvironmentDeps = {
    capture,
    act,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  return new LocalMacEnvironment(deps);
}
