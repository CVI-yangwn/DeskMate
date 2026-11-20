import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

/**
 * 光标处的文本上下文。
 *
 * 这不是键盘监听：不装 event tap、不读键码，只问系统“当前聚焦的文本框里有什么”。
 * 好处是中文输入法的结果已经提交，拿到的就是用户真正写下的字；
 * 代价是只有暴露无障碍文本的 App 才读得到（原生控件通常可以，
 * Chromium 系需要 AXManualAccessibility，IM 类自定义输入框往往读不到）。
 */
export interface FocusedText {
  app: string;
  title: string;
  bounds?: { x: number; y: number; width: number; height: number };
  role: string;
  doc: string;
  selected: string;
  context: string;
  caret: number;
  valueLength: number;
}

interface AxPayload {
  ok?: boolean;
  app?: string;
  title?: string;
  role?: string;
  doc?: string;
  selected?: string;
  context?: string;
  caret?: number;
  valueLength?: number;
  reason?: string;
  bounds?: { x?: number; y?: number; width?: number; height?: number };
}

function binaryPath(): string | null {
  if (process.platform !== 'darwin') return null;
  const candidates = [
    path.join(process.cwd(), 'native/ax'),
    path.join(app.getAppPath(), 'native/ax'),
    path.join(process.resourcesPath, 'native/ax'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export async function readFocusedText(): Promise<FocusedText | null> {
  const binary = binaryPath();
  if (!binary) return null;

  try {
    const { stdout } = await execFileAsync(binary, [], {
      timeout: 1_500,
      maxBuffer: 512 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as AxPayload;
    if (!parsed?.ok) {
      if (parsed?.reason && parsed.reason !== 'no-focused-element') {
        console.info(`[ax] ${parsed.reason}`);
      }
      return null;
    }
    const raw = parsed.bounds;
    const bounds =
      raw && Number(raw.width) > 0 && Number(raw.height) > 0
        ? {
            x: Math.round(Number(raw.x) || 0),
            y: Math.round(Number(raw.y) || 0),
            width: Math.round(Number(raw.width) || 0),
            height: Math.round(Number(raw.height) || 0),
          }
        : undefined;

    return {
      app: String(parsed.app ?? '').slice(0, 80),
      title: String(parsed.title ?? '').slice(0, 200),
      ...(bounds ? { bounds } : {}),
      role: String(parsed.role ?? '').slice(0, 40),
      doc: String(parsed.doc ?? '').slice(0, 400),
      selected: String(parsed.selected ?? '').slice(0, 400),
      context: String(parsed.context ?? '').slice(0, 900),
      caret: Number(parsed.caret) || 0,
      valueLength: Number(parsed.valueLength) || 0,
    };
  } catch {
    return null;
  }
}
