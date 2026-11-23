import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AvatarHitMask,
  ChatMessage,
  DemoState,
  DreamRun,
  HitRect,
  MemoryExport,
  ScanResult,
  UtterancePayload,
  UtterancePlan,
} from '../shared/types';
import { BrainService } from './brain';
import { startEventBridge, type EventBridge } from './eventBridge';
import { readActiveWindow } from './perception';
import { listSayVoices } from './tts';
import {
  createAvatarWindow,
  createPanelWindow,
  getAvatarWindow,
  hidePanel,
  positionAvatarWindow,
  sendToAll,
  setAvatarPosition,
  setQuitting,
  showPanel,
  togglePanel,
} from './windows';

let brain: BrainService;
let tray: Tray | null = null;
let hitRect: HitRect = { x: 0, y: 0, w: 0, h: 0 };
let hitMask: AvatarHitMask | null = null;
let bubbleRect: HitRect | null = null;
let avatarDragging = false;
let dragResetTimer: NodeJS.Timeout | null = null;
let hitTimer: NodeJS.Timeout | null = null;
let scanTimer: NodeJS.Timeout | null = null;
let dreamTimer: NodeJS.Timeout | null = null;
let foregroundTimer: NodeJS.Timeout | null = null;
let lastForegroundKey = '';
let eventBridge: EventBridge | null = null;

function assetPath(name: string): string {
  const candidates = [
    path.join(process.cwd(), 'assets', name),
    path.join(process.resourcesPath, 'assets', name),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}

function startHitTestLoop(): void {
  if (hitTimer) clearInterval(hitTimer);

  hitTimer = setInterval(() => {
    const win = getAvatarWindow();
    if (!win || !win.isVisible()) return;

    // 拖动期间保持鼠标事件开启，避免窗口移动时被 hit-test 切成点击穿透。
    if (avatarDragging) {
      win.setIgnoreMouseEvents(false, { forward: true });
      return;
    }

    const point = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    const localX = point.x - bounds.x;
    const localY = point.y - bounds.y;

    let inside = false;

    // 气泡是 DOM，单独给一个矩形；猫本体用像素掩码走轮廓。
    if (bubbleRect) {
      inside =
        localX >= bubbleRect.x &&
        localX <= bubbleRect.x + bubbleRect.w &&
        localY >= bubbleRect.y &&
        localY <= bubbleRect.y + bubbleRect.h;
    }

    if (!inside && hitMask) {
      const col = Math.floor(localX / hitMask.cell);
      const row = Math.floor(localY / hitMask.cell);
      inside =
        col >= 0 &&
        row >= 0 &&
        col < hitMask.cols &&
        row < hitMask.rows &&
        hitMask.mask[row * hitMask.cols + col] === 1;
    } else if (!inside && !hitMask) {
      inside =
        localX >= hitRect.x &&
        localX <= hitRect.x + hitRect.w &&
        localY >= hitRect.y &&
        localY <= hitRect.y + hitRect.h;
    }

    win.setIgnoreMouseEvents(!inside, { forward: true });
  }, 50);
}

function openCompanionCapture(): void {
  showPanel();
  setTimeout(() => sendToAll('panel:open-companion', null), 160);
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(assetPath('trayTemplate.png')).resize({
      width: 18,
      height: 18,
    });
    if (process.platform === 'darwin') icon.setTemplateImage(true);

    tray = new Tray(icon);
    tray.setToolTip('同桌 DeskMate');

    const moveToCursorDisplay = () => {
      const win = getAvatarWindow();
      if (!win) return;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const [width, height] = win.getSize();
      const area = display.workArea;
      const position = {
        x: Math.round(area.x + area.width - width - 22),
        y: Math.round(area.y + area.height - height - 22),
      };
      setAvatarPosition(position);
      brain.saveAvatarPosition(position);
    };

    const menu = Menu.buildFromTemplate([
      { label: '打开面板', click: () => showPanel() },
      { label: '记一下…', click: openCompanionCapture },
      { label: '把小黑叫到当前屏幕', click: moveToCursorDisplay },
      { type: 'separator' },
      {
        label: '模拟测试通过',
        click: () => {
          void runDemo('pass');
        },
      },
      {
        label: '模拟测试失败',
        click: () => {
          void runDemo('fail');
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          setQuitting(true);
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(menu);
    tray.on('click', () => togglePanel());
  } catch (error) {
    console.warn('Tray 创建失败（Linux 可能缺少 libappindicator）', error);
  }
}

async function runDemo(result: 'pass' | 'fail') {
  const payload = await brain.simulateTest(result);
  sendToAll('avatar:perform', payload);
  return payload;
}

function performUtterance(
  plan: UtterancePlan,
  state: DemoState,
  source: 'deepseek' | 'mock',
  origin: 'scan' | 'proactive' | 'demo' | 'dream',
  eventType = 'unknown',
): UtterancePayload {
  const speakingMs = brain.isVoiceEnabled() && plan.say ? brain.speak(plan.speechText) : 0;
  const payload: UtterancePayload = { plan, state, speakingMs, source, origin, eventType };
  sendToAll('avatar:perform', payload);
  return payload;
}

function announceDream(run: DreamRun): void {
  if (run.status !== 'ok') return;
  if (run.pages === 0 && run.rules === 0) return;
  if (brain.isDnd() || brain.isQuietNow()) return;
  const bits = [
    run.pages ? `${run.pages} 页知识` : '',
    run.rules ? `${run.rules} 条提醒规则` : '',
  ].filter(Boolean);
  if (bits.length === 0) return;
  const text = `我把今天的记忆整理好了：${bits.join('、')}。`;
  performUtterance(
    {
      say: true,
      displayText: text,
      speechText: text,
      emotion: 'smile',
      motion: 'nod',
      urgency: 'low',
      evidenceIds: ['dream'],
      reason: '夜间整理完成',
    },
    brain.getStatus().state,
    brain.getStatus().apiStatus === 'ok' ? 'deepseek' : 'mock',
    'dream',
    'dream',
  );
}

async function checkDreaming(): Promise<void> {
  try {
    const run = await brain.maybeRunDreaming();
    if (run) announceDream(run);
  } catch (error) {
    console.warn('夜间整理失败', error);
  }
}

function startDreamLoop(): void {
  // 启动后先让扫描/问候跑起来，再检查昨晚是否漏了整理。
  setTimeout(() => void checkDreaming(), 15_000);
  if (dreamTimer) clearInterval(dreamTimer);
  dreamTimer = setInterval(() => void checkDreaming(), 5 * 60_000);
}

function sendScanStartBubble(): void {
  const win = getAvatarWindow();
  if (!win) return;
  const payload: UtterancePayload = {
    plan: {
      say: true,
      displayText: '让我看看…',
      speechText: '',
      emotion: 'think',
      motion: 'think',
      urgency: 'low',
      evidenceIds: ['scan-start'],
      reason: '扫描开始',
    },
    state: brain.getStatus().state,
    speakingMs: 0,
    source: 'mock',
    origin: 'scan',
  };
  win.webContents.send('avatar:perform', payload);
}

function buildScanFeedback(result: ScanResult): UtterancePayload {
  const text = (
    result.changed && result.state.activity
      ? result.state.activity
      : result.message
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  const displayText = text || '我看了一眼屏幕。';
  return performUtterance(
    {
      say: true,
      displayText,
      speechText: displayText.slice(0, 120),
      emotion: 'think',
      motion: 'think',
      urgency: 'low',
      evidenceIds: ['scan'],
      reason: '手动扫描反馈',
    },
    result.state,
    result.source === 'deepseek' ? 'deepseek' : 'mock',
    'scan',
    'scan',
  );
}

function sendStartupGreeting(): void {
  if (!brain || brain.isDnd()) return;
  console.info('[presence] startup greeting');
  const text = brain.isVoiceEnabled()
    ? '我来了。今天也一起上班吧。'
    : '我来了。语音现在静音，点我打开面板可以开声音。';
  performUtterance(
    {
      say: true,
      displayText: text,
      speechText: text,
      emotion: 'smile',
      motion: 'tease',
      urgency: 'low',
      evidenceIds: ['startup'],
      reason: '启动问候',
    },
    brain.getStatus().state,
    'mock',
    'proactive',
    'startup',
  );
}

async function scanAndBroadcast(interactive = false) {
  if (interactive) sendScanStartBubble();
  const result = await brain.scanScreen();
  if (result.plan) {
    sendToAll('avatar:perform', result.plan);
  } else if (interactive) {
    // 手动扫描至少要给一个可见反馈，不能“点了没反应”。
    result.plan = buildScanFeedback(result);
    console.info('[presence] interactive scan feedback');
  }
  lastForegroundKey = `${result.state.app ?? ''}|${result.state.windowTitle ?? ''}`;
  console.info(
    `[scan] ${result.changed ? 'changed' : 'cached'} source=${result.source} ${result.durationMs}ms capture=${result.state.captureKind ?? 'window'} displays=${result.state.displayCount ?? 1}`,
  );
  sendToAll('status:changed', brain.getStatus());
  return result;
}

function startPerceptionLoop(): void {
  if (process.platform !== 'darwin' || process.env.DESKMATE_AUTO_SCAN === '0') {
    return;
  }

  const baseInterval = Math.max(
    20_000,
    Number(process.env.DESKMATE_SCAN_INTERVAL_MS ?? brain.getScanIntervalMs()) ||
      brain.getScanIntervalMs(),
  );

  const nextDelay = (result: Awaited<ReturnType<typeof scanAndBroadcast>>): number => {
    if (!result.changed) return 30_000;
    if (result.state.idleSec > 300) return 180_000;
    return baseInterval;
  };

  const schedule = (delay: number) => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(async () => {
      if (brain.isDnd() || brain.isPerceptionPaused()) {
        schedule(60_000);
        return;
      }
      try {
        const result = await scanAndBroadcast();
        schedule(nextDelay(result));
      } catch (error) {
        console.warn('自动扫描失败', error);
        schedule(baseInterval);
      }
    }, delay);
  };

  schedule(5_000);

  if (foregroundTimer) clearInterval(foregroundTimer);
  foregroundTimer = setInterval(async () => {
    if (brain.isDnd() || brain.isPerceptionPaused()) return;
    const active = await readActiveWindow();
    if (!active) return;
    const key = `${active.app}|${active.title}`;
    if (lastForegroundKey && key !== lastForegroundKey) {
      lastForegroundKey = key;
      try {
        const result = await scanAndBroadcast();
        if (scanTimer) clearTimeout(scanTimer);
        schedule(nextDelay(result));
      } catch (error) {
        console.warn('前台窗口变化触发扫描失败', error);
      }
    } else {
      lastForegroundKey = key;
    }
  }, 12_000);
}

function memoryExportMarkdown(data: MemoryExport): string {
  const lines: string[] = [
    '# DeskMate 记忆导出',
    '',
    `导出时间：${new Date(data.exportedAt).toLocaleString('zh-CN')}`,
    '',
    '## 长期事实',
  ];
  if (data.facts.length === 0) lines.push('（暂无）');
  for (const fact of data.facts) lines.push(`- [${fact.kind}] ${fact.text}`);

  lines.push('', '## 锚点');
  if (data.anchors.length === 0) lines.push('（暂无）');
  for (const anchor of data.anchors) {
    lines.push(`- ${anchor.day} [${anchor.kind}] ${anchor.text}`);
  }

  lines.push('', '## 承诺');
  if (data.commitments.length === 0) lines.push('（暂无）');
  for (const commitment of data.commitments) {
    lines.push(`- [${commitment.status === 'done' ? 'x' : ' '}] ${commitment.text}`);
  }

  lines.push('', '## 日结标记');
  if (data.companionDays.length === 0) lines.push('（暂无）');
  for (const day of data.companionDays) {
    const bits = [
      day.callbackAt ? '有次日问候' : '',
      day.recapText ? `晚间一句：${day.recapText}` : '',
    ].filter(Boolean);
    if (bits.length) lines.push(`- ${day.day}：${bits.join('；')}`);
  }

  lines.push('', '## 个人 wiki');
  if (data.wikiPages.length === 0) lines.push('（暂无）');
  for (const page of data.wikiPages) {
    lines.push(
      '',
      `### ${page.name}（${page.type}）`,
      '',
      page.summary,
      '',
      ...page.items.map((item) => `- [${item.status === 'done' ? 'x' : ' '}] ${item.text}`),
    );
  }

  lines.push('', '## 学到的提醒规则');
  if (data.rules.length === 0) lines.push('（暂无）');
  for (const rule of data.rules) {
    lines.push(
      `- ${rule.label} · ${rule.kind} · ${rule.decision}${
        rule.windowStart ? ` · ${rule.windowStart}-${rule.windowEnd}` : ''
      }${rule.active ? '' : '（已暂停）'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function registerIpc(): void {
  ipcMain.handle('app:status', () => brain.getStatus());
  ipcMain.handle('avatar:config', () => brain.getAvatarConfig());
  ipcMain.handle('api:test', () => brain.testConnection());

  ipcMain.handle('demo:test', (_event, result: 'pass' | 'fail') => runDemo(result));

  ipcMain.handle('screen:scan', () => scanAndBroadcast(true));

  ipcMain.handle(
    'chat:send',
    async (_event, text: string, history: ChatMessage[] = []) => {
      const reply = await brain.chat(text, history);
      const spoken = reply.text.replace(/\s+/g, ' ').trim();

      // 聊天回复也走同一套 say + 气泡/口型通道。
      if (spoken) {
        const speechText = spoken.slice(0, 240);
        const speakingMs = brain.isVoiceEnabled() ? brain.speak(speechText) : 0;
        sendToAll('avatar:perform', {
          plan: {
            say: true,
            displayText: spoken.slice(0, 90),
            speechText,
            emotion: 'neutral',
            motion: 'think',
            urgency: 'low',
            evidenceIds: ['chat-reply'],
            reason: '聊天回复自动朗读',
          },
          state: brain.getStatus().state,
          speakingMs,
          source: reply.source,
          origin: 'chat',
          eventType: 'chat',
        });
      }

      return reply;
    },
  );

  ipcMain.handle('chat:history', () => brain.getChatHistory());
  ipcMain.handle('memory:facts', () => brain.getMemoryFacts());
  ipcMain.handle('memory:clear', () => brain.clearMemory());
  ipcMain.handle('memory:forget', (_event, id: string) => brain.forgetFact(String(id)));
  ipcMain.handle('memory:add', (_event, text: string, kind) => brain.addMemory(String(text), kind));
  ipcMain.handle('memory:pin', (_event, id: string, pinned: boolean) => brain.pinFact(String(id), Boolean(pinned)));
  ipcMain.handle('memory:update', (_event, id: string, text: string, kind) =>
    brain.updateFact(String(id), String(text), kind),
  );
  ipcMain.handle('companion:today', () => brain.getCompanionToday());
  ipcMain.handle('intentions:view', () => brain.getIntentions());
  ipcMain.handle('intentions:feedback', (_event, id: string, outcome: string) =>
    brain.recordIntentionFeedback(String(id), outcome === 'accepted' ? 'accepted' : 'rejected'),
  );
  ipcMain.handle('companion:add-anchor', (_event, text: string, kind?: string) =>
    brain.addAnchor(
      String(text),
      kind === 'feeling' || kind === 'open_loop' || kind === 'moment' ? kind : 'work',
    ),
  );
  ipcMain.handle('companion:delete-anchor', (_event, id: string) =>
    brain.deleteAnchor(String(id)),
  );
  ipcMain.handle('companion:add-commitment', (_event, text: string, dueHint?: string) =>
    brain.addCommitment(String(text), dueHint ? String(dueHint) : undefined),
  );
  ipcMain.handle('companion:complete-commitment', (_event, id: string, done: boolean) =>
    brain.completeCommitment(String(id), Boolean(done)),
  );
  ipcMain.handle('companion:delete-commitment', (_event, id: string) =>
    brain.deleteCommitment(String(id)),
  );
  ipcMain.handle('companion:update-anchor', (_event, id: string, text: string, kind?: string) =>
    brain.updateAnchor(
      String(id),
      String(text),
      kind === 'feeling' || kind === 'open_loop' || kind === 'moment' ? kind : 'work',
    ),
  );
  ipcMain.handle('feedback:bubble', (_event, eventType: string, action: string) => {
    brain.recordBubbleFeedback(String(eventType), action === 'open' ? 'open' : 'dismiss');
  });
  ipcMain.handle('voice:list', () => listSayVoices());
  ipcMain.handle('settings:set-voice-settings', (_event, voiceName: string, speechRate: number) =>
    brain.setVoiceSettings(String(voiceName), Number(speechRate) || 180),
  );
  ipcMain.handle('settings:set-persona', (_event, text: string) => brain.setPersona(String(text)));
  ipcMain.handle('settings:set-quiet-hours', (_event, enabled: boolean, start: string, end: string) =>
    brain.setQuietHours(Boolean(enabled), String(start), String(end)),
  );
  ipcMain.handle('memory:export', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出 DeskMate 记忆',
      message: '导出文件包含个人记忆与屏幕活动摘要，请勿放在 iCloud/共享目录。',
      defaultPath: path.join(
        app.getPath('documents'),
        `deskmate-memory-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    const data = brain.exportMemory();
    const content = result.filePath.toLowerCase().endsWith('.md')
      ? memoryExportMarkdown(data)
      : JSON.stringify(data, null, 2);
    fs.writeFileSync(result.filePath, content, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(result.filePath, 0o600);
    return result.filePath;
  });
  ipcMain.handle('settings:set-auto-memory', (_event, enabled: boolean) =>
    brain.setAutoMemory(Boolean(enabled)),
  );
  ipcMain.handle('settings:set-dnd', (_event, enabled: boolean) => brain.setDnd(Boolean(enabled)));
  ipcMain.handle('settings:set-voice', (_event, enabled: boolean) => brain.setVoice(Boolean(enabled)));
  ipcMain.handle('perception:pause', (_event, minutes: number) => brain.pausePerception(Number(minutes) || 15));
  ipcMain.handle('perception:resume', () => brain.resumePerception());
  ipcMain.handle('settings:set-privacy', (_event, apps: string[]) =>
    brain.setPrivacySettings(Array.isArray(apps) ? apps : []),
  );
  ipcMain.handle('settings:set-dreaming', (_event, enabled: boolean, at: string) =>
    brain.setDreaming(Boolean(enabled), String(at)),
  );
  ipcMain.handle('settings:set-proactive-learning', (_event, enabled: boolean) =>
    brain.setProactiveLearning(Boolean(enabled)),
  );
  ipcMain.handle('knowledge:view', () => brain.getKnowledge());
  ipcMain.handle('knowledge:dream', async () => {
    const run = await brain.runDreaming(true);
    announceDream(run);
    return run;
  });
  ipcMain.handle('knowledge:delete-page', (_event, id: string) =>
    brain.deleteWikiPage(String(id)),
  );
  ipcMain.handle('knowledge:set-rule', (_event, id: string, active: boolean) =>
    brain.setRuleActive(String(id), Boolean(active)),
  );
  ipcMain.handle('knowledge:delete-rule', (_event, id: string) => brain.deleteRule(String(id)));
  ipcMain.handle('knowledge:open-folder', async () => {
    const dir = brain.getKnowledge().wikiDir;
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('panel:open', () => {
    showPanel();
  });

  ipcMain.handle('panel:close', () => {
    hidePanel();
  });

  ipcMain.handle('avatar:hit-rect', (_event, rect: HitRect) => {
    hitRect = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      w: Math.max(0, Math.round(rect.w)),
      h: Math.max(0, Math.round(rect.h)),
    };
  });

  ipcMain.on('avatar:hit-mask', (_event, mask: AvatarHitMask) => {
    if (
      !mask ||
      !Array.isArray(mask.mask) ||
      !Number.isFinite(mask.cols) ||
      !Number.isFinite(mask.rows) ||
      !Number.isFinite(mask.cell) ||
      mask.cols <= 0 ||
      mask.rows <= 0
    ) {
      return;
    }
    hitMask = mask;
  });

  ipcMain.on('avatar:bubble-rect', (_event, rect: HitRect | null) => {
    bubbleRect = rect && rect.w > 0 && rect.h > 0 ? rect : null;
  });

  ipcMain.on('avatar:drag-start', () => {
    avatarDragging = true;
    if (dragResetTimer) clearTimeout(dragResetTimer);
    // 渲染进程在拖动中崩溃时，不能把点击穿透永久关掉。
    dragResetTimer = setTimeout(() => {
      avatarDragging = false;
    }, 10_000);
  });

  ipcMain.on('avatar:drag-move', (_event, dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const win = getAvatarWindow();
    if (!win) return;

    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    const nextX = Math.round(x + dx);
    const nextY = Math.round(y + dy);
    const display = screen.getDisplayNearestPoint({
      x: nextX + Math.round(w / 2),
      y: nextY + Math.round(h / 2),
    });
    const area = display.workArea;
    const maxX = area.x + Math.max(0, area.width - w);
    const maxY = area.y + Math.max(0, area.height - h);
    const clampedX = Math.min(Math.max(nextX, area.x), maxX);
    const clampedY = Math.min(Math.max(nextY, area.y), maxY);
    win.setPosition(clampedX, clampedY, false);
  });

  ipcMain.on('avatar:drag-end', () => {
    avatarDragging = false;
    if (dragResetTimer) {
      clearTimeout(dragResetTimer);
      dragResetTimer = null;
    }
    const win = getAvatarWindow();
    if (win) {
      const [x, y] = win.getPosition();
      brain.saveAvatarPosition({ x, y });
      setAvatarPosition({ x, y });
    }
  });
}

function registerShortcuts(): void {
  const ok = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    togglePanel();
  });
  if (!ok) console.warn('全局快捷键注册失败：CommandOrControl+Shift+Space');

  const captureOk = globalShortcut.register('CommandOrControl+Shift+M', openCompanionCapture);
  if (!captureOk) console.warn('全局快捷键注册失败：CommandOrControl+Shift+M');
}

app.setName('DeskMate');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showPanel();
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  brain = new BrainService();
  brain.startWatchers();

  // 让主进程也能收到状态变化，并广播给两个窗口
  brain.subscribe((status) => sendToAll('status:changed', status));

  createAvatarWindow();
  createPanelWindow();
  const savedAvatarPosition = brain.getAvatarPosition();
  if (savedAvatarPosition) setAvatarPosition(savedAvatarPosition);
  registerIpc();
  registerShortcuts();
  createTray();
  startHitTestLoop();
  positionAvatarWindow();

  try {
    eventBridge = await startEventBridge({
      onTestResult: (result) => runDemo(result),
    });
    console.info(`Event bridge: http://127.0.0.1:${eventBridge.port}/event`);
  } catch (error) {
    console.warn('Event bridge 启动失败（端口 39876 可能被占用）', error);
  }

  startPerceptionLoop();
  startDreamLoop();

  // 启动后先露个面，让用户知道搭子在。
  setTimeout(sendStartupGreeting, 2500);

  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  screen.on('display-metrics-changed', () => positionAvatarWindow());
  screen.on('display-added', () => positionAvatarWindow());
  screen.on('display-removed', () => positionAvatarWindow());

  // 默认收起面板，避免启动时突然弹窗；用户可通过小黑、托盘或快捷键打开。
});

app.on('activate', () => {
  showPanel();
});

app.on('before-quit', () => {
  setQuitting(true);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (hitTimer) clearInterval(hitTimer);
  if (dragResetTimer) clearTimeout(dragResetTimer);
  if (scanTimer) clearTimeout(scanTimer);
  if (dreamTimer) clearInterval(dreamTimer);
  if (foregroundTimer) clearInterval(foregroundTimer);
  void eventBridge?.close();
});

app.on('window-all-closed', () => {
  // 菜单栏应用：关窗不退出
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

