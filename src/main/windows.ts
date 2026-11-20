import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let avatarWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let quitting = false;
let savedPosition: { x: number; y: number } | null = null;

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.mjs');
}

function rendererFile(): string {
  return path.join(__dirname, '../renderer/index.html');
}

function loadRoute(win: BrowserWindow, route: 'avatar' | 'panel'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devUrl) {
    void win.loadURL(`${devUrl}#/${route}`);
  } else {
    void win.loadFile(rendererFile(), { hash: `/${route}` });
  }
}

export function createAvatarWindow(): BrowserWindow {
  if (avatarWindow && !avatarWindow.isDestroyed()) return avatarWindow;

  const win = new BrowserWindow({
    width: 240,
    height: 360,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  avatarWindow = win;

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => {
    win.showInactive();
    positionAvatarWindow();
  });

  win.on('closed', () => {
    if (avatarWindow === win) avatarWindow = null;
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting) return;
    console.warn('avatar renderer gone, recreating', details.reason);
    if (avatarWindow === win) avatarWindow = null;
    try {
      win.destroy();
    } catch {
      // window may already be gone
    }
    setTimeout(() => {
      if (!quitting) {
        createAvatarWindow();
        positionAvatarWindow();
      }
    }, 300);
  });
  win.webContents.on('unresponsive', () => {
    if (!quitting) win.reload();
  });

  loadRoute(win, 'avatar');
  return win;
}

export function createPanelWindow(): BrowserWindow {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;

  const win = new BrowserWindow({
    width: 480,
    height: 840,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: '同桌 DeskMate',
    backgroundColor: '#15131f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  panelWindow = win;

  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (panelWindow === win) panelWindow = null;
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting) return;
    console.warn('panel renderer gone, reloading', details.reason);
    win.reload();
  });
  win.webContents.on('unresponsive', () => {
    if (!quitting) win.reload();
  });

  loadRoute(win, 'panel');
  return win;
}

export function getAvatarWindow(): BrowserWindow | null {
  return avatarWindow && !avatarWindow.isDestroyed() ? avatarWindow : null;
}

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow && !panelWindow.isDestroyed() ? panelWindow : null;
}

export function setAvatarPosition(position: { x: number; y: number }): void {
  savedPosition = position;
  positionAvatarWindow();
}

export function positionAvatarWindow(): void {
  const win = getAvatarWindow();
  if (!win) return;

  const display = savedPosition
    ? screen.getDisplayNearestPoint(savedPosition)
    : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const [winWidth, winHeight] = win.getSize();

  if (savedPosition) {
    const maxX = x + Math.max(0, width - winWidth);
    const maxY = y + Math.max(0, height - winHeight);
    win.setPosition(
      Math.round(Math.min(Math.max(savedPosition.x, x), maxX)),
      Math.round(Math.min(Math.max(savedPosition.y, y), maxY)),
      false,
    );
    return;
  }

  const margin = 22;
  win.setPosition(
    Math.round(x + width - winWidth - margin),
    Math.round(y + height - winHeight - margin),
    false,
  );
}

export function showPanel(): void {
  const win = getPanelWindow();
  if (!win) return;
  win.show();
  win.focus();
}

export function hidePanel(): void {
  getPanelWindow()?.hide();
}

export function togglePanel(): void {
  const win = getPanelWindow();
  if (!win) return;
  if (win.isVisible()) hidePanel();
  else showPanel();
}

export function setQuitting(value: boolean): void {
  quitting = value;
}

export function sendToAll(channel: string, payload: unknown): void {
  for (const win of [getAvatarWindow(), getPanelWindow()]) {
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
