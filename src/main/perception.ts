import { desktopCapturer, powerMonitor, screen, systemPreferences } from 'electron';
import type { Display, NativeImage } from 'electron';
import { activeWindow, openWindows } from 'get-windows';
import type { ScreenStatus } from '../shared/types';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActiveWindowInfo {
  app: string;
  title: string;
  id?: number;
  url?: string;
  bounds?: WindowBounds;
}

export type CaptureKind = 'display' | 'window';

export interface CapturedFrame {
  base64: string;
  app: string;
  title: string;
  width: number;
  height: number;
  hash: string;
  capturedAt: number;
  captureKind: CaptureKind;
  displayId?: string;
  displayName?: string;
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

export function rectsIntersect(a: WindowBounds, b: WindowBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSelfWindow(app: string, title: string): boolean {
  return app === 'DeskMate' || app === 'Electron' || title.includes('DeskMate');
}

function toInfo(win: {
  title: string;
  id: number;
  owner: { name: string };
  bounds: WindowBounds;
  url?: string;
}): ActiveWindowInfo {
  return {
    app: win.owner.name,
    title: win.title,
    id: win.id,
    url: win.url,
    bounds: {
      x: win.bounds.x,
      y: win.bounds.y,
      width: win.bounds.width,
      height: win.bounds.height,
    },
  };
}

function sourceWindowId(sourceId: string): string | null {
  const match = /^window:(\d+):/.exec(sourceId);
  return match?.[1] ?? null;
}

export async function readOpenWindows(): Promise<ActiveWindowInfo[]> {
  try {
    const windows = await withTimeout(openWindows(), 5_000, []);
    return windows
      .filter((candidate) => !isSelfWindow(candidate.owner.name, candidate.title))
      .map(toInfo);
  } catch {
    return [];
  }
}

export async function readActiveWindow(): Promise<ActiveWindowInfo | null> {
  try {
    const win = await withTimeout(activeWindow(), 4_000, null);
    if (win && !isSelfWindow(win.owner.name, win.title)) {
      return toInfo(win);
    }

    // 面板打开时，前台窗口是 DeskMate 自己；退回到下一个真实窗口。
    return (await readOpenWindows())[0] ?? null;
  } catch {
    return null;
  }
}

export function displayForWindow(win: ActiveWindowInfo | null): Display {
  if (win?.bounds) {
    try {
      return screen.getDisplayMatching(win.bounds);
    } catch {
      // fall through to the display under the cursor
    }
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function displayLabel(display: Display): string {
  const label = display.label?.trim();
  return label || `显示器 ${display.id}`;
}

function encodeThumbnail(image: NativeImage, maxWidth: number): NativeImage {
  const size = image.getSize();
  if (size.width <= maxWidth) return image;
  return image.resize({
    width: maxWidth,
    height: Math.round((size.height * maxWidth) / size.width),
  });
}

async function captureDisplay(
  display: Display,
  active: ActiveWindowInfo | null,
  maxWidth: number,
): Promise<CapturedFrame | null> {
  const aspect = display.size.width > 0 ? display.size.height / display.size.width : 0.75;
  const thumbnailHeight = Math.max(1, Math.round(maxWidth * aspect));
  const sources = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: thumbnailHeight },
    }),
    8_000,
    [],
  );

  const source =
    sources.find((item) => item.display_id === String(display.id)) ??
    (sources.length === 1 ? sources[0] : undefined);

  if (!source || source.thumbnail.isEmpty()) return null;

  const image = encodeThumbnail(source.thumbnail, maxWidth);
  const resized = image.getSize();
  const jpeg = image.toJPEG(72);
  const name = displayLabel(display);

  return {
    base64: jpeg.toString('base64'),
    app: active?.app ?? 'Desktop',
    title: active?.title ?? name,
    width: resized.width,
    height: resized.height,
    hash: perceptualHash(image),
    capturedAt: Date.now(),
    captureKind: 'display',
    displayId: String(display.id),
    displayName: name,
  };
}

/**
 * 抓当前前台窗口所在显示器的整屏。找不到对应显示器 source 时返回 null，
 * 调用方可以退回到 captureActiveWindow()。
 */
export async function captureFocusedDisplay(
  active: ActiveWindowInfo | null,
  maxWidth = 1280,
): Promise<CapturedFrame | null> {
  if (getScreenStatus() === 'denied' || getScreenStatus() === 'restricted') {
    return null;
  }

  const display = displayForWindow(active);
  try {
    return await captureDisplay(display, active, maxWidth);
  } catch {
    return null;
  }
}

export async function captureActiveWindow(maxWidth = 1280): Promise<CapturedFrame | null> {
  if (getScreenStatus() === 'denied' || getScreenStatus() === 'restricted') {
    return null;
  }

  const current = await readActiveWindow();
  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: {
          width: maxWidth,
          height: Math.round(maxWidth * 0.75),
        },
      }),
      8_000,
      [],
    );

    if (sources.length === 0) return null;

    const source =
      (current?.id
        ? sources.find((item) => sourceWindowId(item.id) === String(current.id))
        : undefined) ??
      sources.find((item) => item.name === current?.title) ??
      sources[0];

    if (!source || source.thumbnail.isEmpty()) return null;

    const image = encodeThumbnail(source.thumbnail, maxWidth);
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
      captureKind: 'window',
    };
  } catch {
    return null;
  }
}
