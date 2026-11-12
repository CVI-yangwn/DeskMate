import { desktopCapturer, powerMonitor, systemPreferences } from 'electron';
import type { NativeImage } from 'electron';
import { activeWindow, openWindows } from 'get-windows';
import type { ScreenStatus } from '../shared/types';

export interface ActiveWindowInfo {
  app: string;
  title: string;
  id?: number;
  url?: string;
}

export interface CapturedWindow {
  base64: string;
  app: string;
  title: string;
  width: number;
  height: number;
  hash: string;
  capturedAt: number;
}

export function getScreenStatus(): ScreenStatus {
  if (process.platform !== 'darwin') return 'unavailable';
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status as ScreenStatus;
  } catch {
    return 'unknown';
  }
}

function perceptualHash(image: NativeImage): string {
  const small = image.resize({ width: 16, height: 16, quality: 'good' });
  const bitmap = small.toBitmap();
  if (bitmap.length < 16 * 16 * 3) return '';

  const gray: number[] = [];
  for (let index = 0; index < 16 * 16; index += 1) {
    const offset = index * 4;
    gray.push(
      0.299 * (bitmap[offset] ?? 0) +
        0.587 * (bitmap[offset + 1] ?? 0) +
        0.114 * (bitmap[offset + 2] ?? 0),
    );
  }
  const average = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < gray.length; index += 1) {
    if (gray[index] > average) {
      bytes[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
    }
  }
  return bytes.toString('hex');
}

export function hashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 256;
  let distance = 0;
  for (let index = 0; index < a.length; index += 2) {
    let xor = parseInt(a.slice(index, index + 2), 16) ^ parseInt(b.slice(index, index + 2), 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

export function getIdleSeconds(): number {
  try {
    return powerMonitor.getSystemIdleTime();
  } catch {
    return 0;
  }
}

function isSelfWindow(app: string, title: string): boolean {
  return app === 'DeskMate' || app === 'Electron' || title.includes('DeskMate');
}

function toInfo(win: {
  title: string;
  id: number;
  owner: { name: string };
}): ActiveWindowInfo {
  return {
    app: win.owner.name,
    title: win.title,
    id: win.id,
    url: (win as unknown as { url?: string }).url,
  };
}

export async function readActiveWindow(): Promise<ActiveWindowInfo | null> {
  try {
    const win = await activeWindow();
    if (win && !isSelfWindow(win.owner.name, win.title)) {
      return toInfo(win);
    }

    // 面板打开时，前台窗口是 DeskMate 自己；退回到下一个真实窗口。
    const windows = await openWindows();
    for (const candidate of windows) {
      if (!isSelfWindow(candidate.owner.name, candidate.title)) {
        return toInfo(candidate);
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function captureActiveWindow(maxWidth = 1280): Promise<CapturedWindow | null> {
  if (getScreenStatus() === 'denied' || getScreenStatus() === 'restricted') {
    return null;
  }

  const current = await readActiveWindow();
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: maxWidth,
        height: Math.round(maxWidth * 0.75),
      },
    });

    if (sources.length === 0) return null;

    const source =
      (current?.id
        ? sources.find((item) => item.id.endsWith(String(current.id)))
        : undefined) ??
      sources.find((item) => item.name === current?.title) ??
      sources[0];

    if (!source || source.thumbnail.isEmpty()) return null;

    const size = source.thumbnail.getSize();
    const image =
      size.width > maxWidth
        ? source.thumbnail.resize({
            width: maxWidth,
            height: Math.round((size.height * maxWidth) / size.width),
          })
        : source.thumbnail;

    const resized = image.getSize();
    const jpeg = image.toJPEG(72);

    return {
      base64: jpeg.toString('base64'),
      app: current?.app ?? source.name,
      title: current?.title ?? source.name,
      width: resized.width,
      height: resized.height,
      hash: perceptualHash(image),
      capturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
