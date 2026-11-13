import fs from 'node:fs';
import path from 'node:path';
import { app, screen } from 'electron';
import type {
  AnchorKind,
  ApiStatus,
  AppStatus,
  AvatarConfig,
  ChatMessage,
  ChatReply,
  BubbleFeedbackAction,
  Commitment,
  CompanionToday,
  DailyAnchor,
  DemoState,
  Inspection,
  MemoryExport,
  MemoryFact,
  MemoryKind,
  ScanResult,
  TestResult,
  UtterancePayload,
  UtterancePlan,
} from '../shared/types';
import { AGENT_TOOLS } from './agentTools';
import {
  buildEveningFallback,
  buildMorningFallback,
  extractLocalSignals,
  isEveningWindow,
  isMorningWindow,
  isQuietHours,
  localDay,
  previousDay,
  recapDayFor,
} from './companion';
import {
  DeepSeekClient,
  DeepSeekError,
  type CompanionAnchorCandidate,
  type CompanionCommitmentCandidate,
  type MemoryCandidate,
} from './deepseek';
import { fallbackCorrection, isCorrectionCue } from './correction';
import { getDeepSeekEnv } from './env';
import { MemoryStore } from './memory';
import { MockBrain } from './mockBrain';
import { runOcr } from './ocr';
import {
  captureActiveWindow,
  captureAllDisplays,
  type CapturedFrame,
  displayForWindow,
  getIdleSeconds,
  getScreenStatus,
  readActiveWindow,
  readOpenWindows,
  rectsIntersect,
} from './perception';
import { speakWithSay } from './tts';

const SPEECH_COOLDOWN_MS = 2 * 60_000;

const MEETING_APPS = [
  'zoom',
  'microsoft teams',
  'teams',
  'google meet',
  'meet.google',
  'tencent meeting',
  '腾讯会议',
  '飞书会议',
  'webex',
  'whereby',
  'around',
];

const MEETING_TITLE_PATTERNS =
  /(zoom meeting|google meet|microsoft teams|teams meeting|tencent meeting|webex meeting|腾讯会议|飞书会议)/;

type CompanionMomentKind = 'morning' | 'evening';

interface CompanionMoment {
  text: string;
  kind: CompanionMomentKind;
  day: string;
  source: 'deepseek' | 'mock';
}

const INITIAL_STATE: DemoState = {
  testResult: 'none',
  focusMin: 0,
  idleSec: 0,
  lastUpdated: Date.now(),
  app: 'unknown',
  windowTitle: 'unknown',
  activity: '等待第一次扫描',
  evidence: [],
};

const APP_ALIAS_GROUPS: string[][] = [
  ['calculator', '计算器'],
  ['keychain access', '钥匙串访问'],
  ['system settings', '系统设置', 'system preferences', '系统偏好设置'],
  ['passwords', '密码'],
  ['1password'],
  ['activity monitor', '活动监视器'],
];

function appAliasKey(name: string): string {
  const normalized = name.trim().toLowerCase();
  const group = APP_ALIAS_GROUPS.find((items) => items.includes(normalized));
  return group?.[0] ?? normalized;
}

function detectOcrTest(text?: string): TestResult {
  if (!text) return 'none';
  if (/(\d+)\s+failed\b|\bFAILED\b|BUILD FAILED|TEST FAILED|测试失败|失败\s*[:：]/i.test(text)) return 'fail';
  if (/BUILD SUCCESS|All tests passed|tests? passed|测试通过|全部通过/i.test(text)) return 'pass';
  return 'none';
}

export class BrainService {
  private readonly client = new DeepSeekClient(getDeepSeekEnv());
  private readonly mock = new MockBrain();
  private readonly memory = new MemoryStore(app.getPath('userData'));
  private readonly listeners = new Set<(status: AppStatus) => void>();
  private state: DemoState = { ...INITIAL_STATE };
  private apiStatus: ApiStatus;
  private apiMessage: string;
  private lastScanStartedAt = 0;
  private lastSpokenAt = 0;
  private lastSpokenText = '';
  private lastFocusMilestone = 0;
  private lastIdleNudgeAt = 0;
  private lastIdleSec = 0;
  private lastObservationAt = 0;
  private lastObservationKey = '';
  private lastUserAskedToRemember = false;
  private lastAnalyzedAt = 0;
  private scanStats = { total: 0, analyzed: 0 };
  private scanInFlight: Promise<ScanResult> | null = null;
  private visionHourStartedAt = Date.now();
  private visionCallsThisHour = 0;

  constructor() {
    this.client.setPersona(this.memory.getSettings().persona);
    if (this.client.configured) {
      this.apiStatus = 'unchecked';
      this.apiMessage = '已配置 DeepSeek key，点击“测试连接”验证';
    } else {
      this.apiStatus = 'missing';
      this.apiMessage = '未配置 DEEPSEEK_API_KEY，当前使用本地 mock';
    }
  }

  getStatus(): AppStatus {
    const settings = this.memory.getSettings();
    return {
      apiStatus: this.apiStatus,
      apiMessage: this.apiMessage,
      apiKeyPresent: this.client.configured,
      modelName: this.client.model,
      visionModelName: this.client.visionModel,
      platform: process.platform,
      voice:
        process.platform === 'darwin'
          ? `macOS say（${settings.voiceName}）`
          : '未接语音（当前平台不是 macOS）',
      voiceEnabled: settings.voiceEnabled,
      voiceName: settings.voiceName,
      speechRate: settings.speechRate,
      persona: settings.persona,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      screenStatus: getScreenStatus(),
      dnd: settings.dnd,
      memoryCount: this.memory.getFactCount(),
      autoMemory: settings.autoMemory,
      perceptionPausedUntil: settings.perceptionPausedUntil,
      excludedApps: settings.excludedApps,
      visionCallsThisHour: this.visionCallsThisHour,
      scanStats: { ...this.scanStats },
      state: { ...this.state },
    };
  }

  getChatHistory(): ChatMessage[] {
    return this.memory.getMessages(60);
  }

  getMemoryFacts(): MemoryFact[] {
    return this.memory.getFacts(100);
  }

  getCompanionToday(): CompanionToday {
    return this.memory.getCompanionToday();
  }

  addAnchor(text: string, kind: AnchorKind = 'work'): CompanionToday {
    this.memory.addAnchor(text, kind, { source: 'explicit', confidence: 1 });
    this.emit();
    return this.getCompanionToday();
  }

  deleteAnchor(id: string): CompanionToday {
    this.memory.deleteAnchor(id);
    this.emit();
    return this.getCompanionToday();
  }

  addCommitment(text: string, dueHint?: string): CompanionToday {
    this.memory.addCommitment(text, dueHint);
    this.emit();
    return this.getCompanionToday();
  }

  completeCommitment(id: string, done = true): CompanionToday {
    this.memory.completeCommitment(id, done);
    this.emit();
    return this.getCompanionToday();
  }

  deleteCommitment(id: string): CompanionToday {
    this.memory.deleteCommitment(id);
    this.emit();
    return this.getCompanionToday();
  }

  updateAnchor(id: string, text: string, kind: AnchorKind): CompanionToday {
    this.memory.updateAnchor(id, text, kind);
    this.emit();
    return this.getCompanionToday();
  }

  recordBubbleFeedback(eventType: string, action: BubbleFeedbackAction): void {
    this.memory.recordBubbleFeedback(eventType, action);
  }

  exportMemory(): MemoryExport {
    return this.memory.exportData();
  }

  speak(text: string): number {
    const settings = this.memory.getSettings();
    return speakWithSay(text, {
      voice: settings.voiceName,
      rate: settings.speechRate,
    });
  }

  setVoiceSettings(voiceName: string, speechRate: number): AppStatus {
    this.memory.updateSettings({ voiceName, speechRate });
    this.emit();
    return this.getStatus();
  }

  setPersona(text: string): AppStatus {
    this.memory.updateSettings({ persona: text });
    this.client.setPersona(text);
    this.emit();
    return this.getStatus();
  }

  setQuietHours(enabled: boolean, start: string, end: string): AppStatus {
    this.memory.updateSettings({
      quietHoursEnabled: enabled,
      quietStart: start,
      quietEnd: end,
    });
    this.emit();
    return this.getStatus();
  }

  addMemory(text: string, kind?: MemoryFact['kind']): AppStatus {
    this.memory.addFact(text, kind);
    this.emit();
    return this.getStatus();
  }

  updateFact(id: string, text: string, kind: MemoryKind): AppStatus {
    this.memory.updateFact(id, text, kind);
    this.emit();
    return this.getStatus();
  }

  pinFact(id: string, pinned: boolean): AppStatus {
    this.memory.pinFact(id, pinned);
    this.emit();
    return this.getStatus();
  }

  setAutoMemory(enabled: boolean): AppStatus {
    this.memory.updateSettings({ autoMemory: enabled });
    this.emit();
    return this.getStatus();
  }

  pausePerception(minutes = 15): AppStatus {
    const safeMinutes = Math.min(240, Math.max(1, Math.round(minutes)));
    this.memory.updateSettings({
      perceptionPausedUntil: Date.now() + safeMinutes * 60_000,
    });
    this.emit();
    return this.getStatus();
  }

  resumePerception(): AppStatus {
    this.memory.updateSettings({ perceptionPausedUntil: undefined });
    this.emit();
    return this.getStatus();
  }

  setPrivacySettings(excludedApps: string[]): AppStatus {
    this.memory.updateSettings({
      excludedApps: Array.isArray(excludedApps) ? excludedApps : [],
    });
    this.emit();
    return this.getStatus();
  }

  private isAppExcluded(app: string): boolean {
    const normalized = app.trim().toLowerCase();
    if (!normalized) return false;
    const appKey = appAliasKey(normalized);
    return this.memory.getSettings().excludedApps.some((item) => {
      const itemKey = appAliasKey(item);
      return (
        appKey === itemKey ||
        normalized.includes(item.toLowerCase()) ||
        item.toLowerCase().includes(normalized)
      );
    });
  }

  private noteVisionCall(): void {
    if (Date.now() - this.visionHourStartedAt >= 60 * 60_000) {
      this.visionHourStartedAt = Date.now();
      this.visionCallsThisHour = 0;
    }
    this.visionCallsThisHour += 1;
  }

  isPerceptionPaused(): boolean {
    const until = this.memory.getSettings().perceptionPausedUntil ?? 0;
    return until > Date.now();
  }

  forgetFact(id: string): AppStatus {
    this.memory.forgetFact(id);
    this.emit();
    return this.getStatus();
  }

  clearMemory(): AppStatus {
    this.memory.clear();
    this.lastSpokenAt = 0;
    this.lastSpokenText = '';
    this.lastFocusMilestone = 0;
    this.lastIdleNudgeAt = 0;
    this.lastIdleSec = 0;
    this.lastObservationAt = 0;
    this.lastObservationKey = '';
    this.emit();
    return this.getStatus();
  }

  setDnd(enabled: boolean): AppStatus {
    this.memory.updateSettings({ dnd: enabled });
    this.emit();
    return this.getStatus();
  }

  setVoice(enabled: boolean): AppStatus {
    this.memory.updateSettings({ voiceEnabled: enabled });
    this.emit();
    return this.getStatus();
  }

  isDnd(): boolean {
    return this.memory.getSettings().dnd;
  }

  isVoiceEnabled(): boolean {
    return this.memory.getSettings().voiceEnabled;
  }

  getScanIntervalMs(): number {
    return this.memory.getSettings().scanIntervalMs;
  }

  getAvatarPosition(): { x: number; y: number } | undefined {
    return this.memory.getSettings().avatarPosition;
  }

  saveAvatarPosition(position: { x: number; y: number }): void {
    this.memory.updateSettings({ avatarPosition: position });
  }

  getAvatarConfig(): AvatarConfig {
    const candidates = [
      path.join(process.cwd(), 'config/avatar.haru.json'),
      path.join(app.getPath('userData'), 'config/avatar.haru.json'),
      path.join(app.getAppPath(), 'config/avatar.haru.json'),
      path.join(process.resourcesPath, 'config/avatar.haru.json'),
    ];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as AvatarConfig;
      }
    }

    throw new Error('找不到 config/avatar.haru.json');
  }

  subscribe(listener: (status: AppStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  async testConnection(): Promise<AppStatus> {
    if (!this.client.configured) {
      this.apiStatus = 'missing';
      this.apiMessage = '未配置 DEEPSEEK_API_KEY';
      this.emit();
      return this.getStatus();
    }

    try {
      await this.client.testConnection();
      this.apiStatus = 'ok';
      this.apiMessage = 'DeepSeek 连接正常';
    } catch (error) {
      this.noteApiError(error);
    }

    this.emit();
    return this.getStatus();
  }

  async scanScreen(allowProactive = true): Promise<ScanResult> {
    if (this.scanInFlight) return this.scanInFlight;

    const inFlight = this.performScan(allowProactive);
    this.scanInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.scanInFlight === inFlight) this.scanInFlight = null;
    }
  }

  private nextFocusMin(idleSec: number, at: number, app?: string): number {
    if (idleSec >= 300 || app === 'loginwindow') return 0;
    const gap = at - (this.state.lastScanAt ?? at);
    if (!Number.isFinite(gap) || gap < 0 || gap > 10 * 60_000) return 0;
    return this.state.focusMin + Math.round(gap / 60_000);
  }

  private async performScan(allowProactive: boolean): Promise<ScanResult> {
    const started = Date.now();
    const now = started;
    if (now - this.lastScanStartedAt < 2500) {
      return {
        state: { ...this.state },
        inspection: null,
        plan: null,
        screenStatus: getScreenStatus(),
        message: '扫描太频繁，等两秒再试。',
        changed: false,
        durationMs: 0,
        source: 'mock',
      };
    }
    this.lastScanStartedAt = now;
    this.scanStats.total += 1;

    const screenStatus = getScreenStatus();
    const active = await readActiveWindow();
    const idleSec = getIdleSeconds();
    const previousIdleSec = this.lastIdleSec;
    this.lastIdleSec = idleSec;

    if (active && this.isAppExcluded(active.app)) {
      this.state = {
        ...this.state,
        app: active.app,
        windowTitle: active.title,
        activity: `已跳过隐私应用「${active.app}」，不截图、不分析。`,
        lastScanAt: Date.now(),
        lastCheckedAt: Date.now(),
        confidence: 1,
        evidence: ['隐私排除规则命中'],
        focusMin: this.nextFocusMin(idleSec, Date.now(), active.app),
        captureKind: undefined,
        displayName: undefined,
      };
      this.emit();
      return {
        state: { ...this.state },
        inspection: null,
        plan: null,
        screenStatus,
        message: `已跳过隐私应用：${active.app}`,
        changed: false,
        durationMs: Date.now() - started,
        source: 'mock',
      };
    }

    const display = displayForWindow(active);
    const visibleWindows = await readOpenWindows();
    const allDisplays = screen.getAllDisplays();
    // 任意一块屏上出现隐私应用时，整屏截图退回到前台窗口，避免把隐私内容拍进去。
    const privacyFallback = visibleWindows.some((win) => {
      if (!win.bounds || win.app === active?.app || !this.isAppExcluded(win.app)) return false;
      return allDisplays.some((item) => rectsIntersect(win.bounds!, item.bounds));
    });

    let frames: CapturedFrame[] = privacyFallback
      ? []
      : await captureAllDisplays(active, 1280);
    if (privacyFallback) {
      const single = await captureActiveWindow(1280);
      if (single) frames = [single];
    }
    if (frames.length === 0 && active) {
      const single = await captureActiveWindow(1280);
      if (single) frames = [single];
    }
    frames = frames.filter((frame) => !this.isAppExcluded(frame.app));
    const captured = frames[0] ?? null;

    if (!captured) {
      this.state = {
        ...this.state,
        idleSec,
        lastScanAt: Date.now(),
        lastCheckedAt: Date.now(),
        lastUpdated: Date.now(),
        app: active?.app ?? this.state.app,
        windowTitle: active?.title ?? this.state.windowTitle,
      };
      this.emit();

      return {
        state: { ...this.state },
        inspection: null,
        plan: null,
        screenStatus,
        message:
          screenStatus === 'denied' || screenStatus === 'restricted'
            ? '屏幕录制权限被拒绝。去“系统设置 → 隐私与安全性 → 屏幕录制”勾选 DeskMate，然后重启。'
            : process.platform === 'darwin'
              ? '抓不到当前窗口。可能是权限没给，或者窗口最小化了。'
              : '当前平台不是 macOS，无法抓取窗口。',
        changed: false,
        durationMs: Date.now() - started,
        source: 'mock',
      };
    }

    const ocrResults = await Promise.all(frames.map((frame) => runOcr(frame.base64)));
    const ocrText = ocrResults
      .map((result, index) =>
        result
          ? `【${frames[index].displayName ?? `显示器 ${index + 1}`}】\n${result.text}`
          : '',
      )
      .filter(Boolean)
      .join('\n\n');
    const ocrLines = ocrResults.reduce((sum, result) => sum + (result?.lines.length ?? 0), 0);
    const ocrTest = detectOcrTest(ocrText);

    let inspection: Inspection;
    let source: 'deepseek' | 'mock' = 'mock';

    if (this.shouldTryApi()) {
      this.noteVisionCall();
      try {
        inspection = await this.client.inspectScreens(
          frames.map((frame, index) => ({
            base64: frame.base64,
            label: frame.displayName ?? `显示器 ${index + 1}`,
          })),
          captured.app,
          captured.title,
          'low',
          ocrText,
        );
        source = 'deepseek';
        if (this.apiStatus !== 'ok') {
          this.apiStatus = 'ok';
          this.apiMessage = 'DeepSeek 连接正常';
        }
      } catch (error) {
        console.warn(
          '视觉分析失败',
          error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        );
        this.noteApiError(error);
        const fallback = this.mock.inspectScreenshot(captured.app, captured.title);
        inspection = {
          ...fallback,
          activity:
            this.state.activity && this.state.activity !== INITIAL_STATE.activity
              ? this.state.activity
              : '暂时看不清屏幕内容，保留上一次状态',
        };
      }
    } else {
      inspection = this.mock.inspectScreenshot(captured.app, captured.title);
    }

    if (inspection.testStatus === 'none' && ocrTest !== 'none') {
      inspection.testStatus = ocrTest;
    }

    const evidence = [...inspection.evidence];
    const ocrPreview = ocrResults
      .flatMap((result) => result?.lines ?? [])
      .filter((line) => line.confidence >= 0.5)
      .slice(0, 3)
      .map((line) => line.text)
      .join(' | ')
      .slice(0, 220);
    if (ocrPreview) evidence.push(`OCR: ${ocrPreview}`);

    evidence.push(
      frames.length > 1
        ? `截图范围：${frames.length} 块显示器（${frames
            .map((frame, index) => frame.displayName ?? `显示器 ${index + 1}`)
            .join(' + ')}）`
        : captured.captureKind === 'display'
          ? `截图范围：整屏${captured.displayName ? `（${captured.displayName}）` : ''}`
          : privacyFallback
            ? '截图范围：同屏有隐私应用，退回前台窗口'
            : '截图范围：前台窗口',
    );

    const previousTest = this.state.testResult;
    const nextTest =
      inspection.testStatus === 'none' ? this.state.testResult : inspection.testStatus;
    const analyzedAt = Date.now();

    this.lastAnalyzedAt = analyzedAt;
    this.scanStats.analyzed += 1;

    this.state = {
      ...this.state,
      app: captured.app || inspection.app,
      windowTitle: captured.title || inspection.title,
      activity: inspection.activity || this.state.activity,
      testResult: nextTest,
      idleSec,
      lastScanAt: analyzedAt,
      lastCheckedAt: analyzedAt,
      lastAnalyzedAt: analyzedAt,
      confidence: inspection.confidence,
      scanDurationMs: analyzedAt - started,
      ocrLines,
      displayCount: frames.length,
      displayNames: frames
        .map((frame) => frame.displayName)
        .filter((name): name is string => Boolean(name)),
      lastUpdated: analyzedAt,
      captureKind: captured.captureKind,
      displayName: captured.displayName,
      evidence: evidence.slice(0, 8),
      focusMin: this.nextFocusMin(idleSec, analyzedAt, captured.app || inspection.app),
    };

    this.maybeAutoAnchors(previousTest, nextTest, analyzedAt);

    const recordedActivity = this.state.activity?.trim();
    if (
      recordedActivity &&
      recordedActivity !== INITIAL_STATE.activity &&
      !/^（mock）/.test(recordedActivity) &&
      !/暂时看不清|屏幕已锁定|已跳过隐私/.test(recordedActivity)
    ) {
      this.memory.appendObservation({
        at: analyzedAt,
        app: this.state.app,
        title: this.state.windowTitle,
        activity: recordedActivity,
        displayNames: this.state.displayNames,
        confidence: this.state.confidence,
        captureKind: this.state.captureKind,
      });
    }

    let planPayload: UtterancePayload | null = null;
    let event: string | null = null;
    const dnd = this.memory.getSettings().dnd;
    const quiet = this.isQuietContext(now, active, display);
    let companionMoment: CompanionMoment | null = null;

    if (!dnd && !quiet && previousTest === 'fail' && nextTest === 'pass') {
      event = `test-pass: 截图显示测试从失败变为通过（${this.state.activity}）`;
    } else if (allowProactive && !dnd && !quiet) {
      // buildObservationEvent 有副作用（更新 idle/focus 状态），先调用再决定是否让位给陪伴时刻。
      // 陪伴时刻优先于普通观察：早上接昨天、晚上收尾，都是一天一次。
      const observation = this.buildObservationEvent(idleSec, now, previousIdleSec);
      companionMoment = await this.maybeCompanionMoment(now, idleSec);
      if (!companionMoment) event = observation;
    }

    if (companionMoment) {
      const plan = this.makeCompanionPlan(companionMoment.text, companionMoment.kind);
      const eventType = `companion:${companionMoment.kind}`;
      const canSpeak = Date.now() - this.lastSpokenAt >= SPEECH_COOLDOWN_MS;
      const muted = this.memory.isEventMuted(eventType);
      console.info(
        `[companion] ${companionMoment.kind} ${muted ? 'muted' : canSpeak ? 'speak' : 'cooldown'}`,
      );

      if (canSpeak && !muted) {
        const speakingMs = this.isVoiceEnabled() ? this.speak(plan.speechText) : 0;
        planPayload = {
          plan,
          state: { ...this.state },
          speakingMs,
          source: companionMoment.source,
          origin: 'proactive',
          eventType,
        };
        this.lastSpokenAt = Date.now();
        this.lastSpokenText = plan.displayText;
        if (companionMoment.kind === 'morning') {
          this.memory.markCallback(companionMoment.day);
        } else {
          this.memory.markRecap(companionMoment.day, plan.displayText);
        }
        this.memory.appendMessage('assistant', plan.displayText);
      }
    } else if (event) {
      const eventType = event.split(':')[0];
      // 测试红绿是低频高价值事件，不参与“同类降频”。
      const muted = eventType !== 'test-pass' && this.memory.isEventMuted(eventType);
      if (muted) {
        console.info(`[proactive] ${eventType} muted`);
      } else {
        const generated = await this.generatePlan(event);
        const plan = this.ensureAudible(event, generated.plan);
        const canSpeak = Date.now() - this.lastSpokenAt >= SPEECH_COOLDOWN_MS;
        console.info(
          `[proactive] ${eventType} ${plan.say ? (canSpeak ? 'speak' : 'cooldown') : 'silent'}`,
        );

        if (plan.say && canSpeak) {
          const speakingMs = this.isVoiceEnabled() ? this.speak(plan.speechText) : 0;
          planPayload = {
            plan,
            state: { ...this.state },
            speakingMs,
            source: generated.source,
            origin: 'proactive',
            eventType,
          };
          this.lastSpokenAt = Date.now();
          this.lastSpokenText = plan.displayText;
          if (event.startsWith('idle:')) this.lastIdleNudgeAt = now;
          else if (event.startsWith('focus-milestone:')) {
            this.lastFocusMilestone = Math.floor(this.state.focusMin / 25);
          }
          this.memory.appendMessage('assistant', plan.displayText);
        }
      }
    }

    this.emit();

    return {
      state: { ...this.state },
      inspection,
      plan: planPayload,
      screenStatus,
      message: planPayload
        ? '已主动关注当前状态。'
        : source === 'mock'
          ? '已截图，但视觉模型不可用，已用本地 OCR 兜底。'
          : ocrLines > 0
            ? `已扫描（视觉 + 本地 OCR ${ocrLines} 行）。`
            : '已扫描。',
      changed: true,
      durationMs: analyzedAt - started,
      source,
    };
  }

  private buildObservationEvent(
    idleSec: number,
    now: number,
    wasIdle: number,
  ): string | null {
    // 离开 10 分钟以上再回来，先打个招呼。
    if (wasIdle >= 600 && idleSec < 60) {
      return `return: 用户离开 ${Math.round(wasIdle / 60)} 分钟后回来了`;
    }

    if (idleSec >= 600) {
      if (now - this.lastIdleNudgeAt >= 30 * 60_000) {
        return `idle: 用户已经 ${Math.round(idleSec / 60)} 分钟没有操作`;
      }
      return null;
    }

    if (this.state.focusMin < 25) this.lastFocusMilestone = 0;

    const milestone = Math.floor(this.state.focusMin / 25);
    if (this.state.focusMin >= 25 && milestone > this.lastFocusMilestone && idleSec < 300) {
      return `focus-milestone: 连续专注 ${this.state.focusMin} 分钟`;
    }

    const activity = this.state.activity?.trim();
    if (!activity || activity === INITIAL_STATE.activity) return null;

    // 普通观察默认安静：同一活动 10 分钟内不重复，活动刚变化也至少隔 3 分钟。
    const key = `${this.state.app ?? ''}|${this.state.windowTitle ?? ''}|${activity.slice(0, 40)}`;
    const gap = now - this.lastObservationAt;
    if (key === this.lastObservationKey && gap < 10 * 60_000) return null;
    if (key !== this.lastObservationKey && gap < 3 * 60_000) return null;
    this.lastObservationAt = now;
    this.lastObservationKey = key;

    const previous = this.lastSpokenText
      ? `\n上一句你刚说过：「${this.lastSpokenText.slice(0, 60)}」，不要重复。`
      : '';
    return `observe: 用户正在「${activity.slice(0, 80)}」${previous}`;
  }

  private maybeAutoAnchors(
    previousTest: TestResult,
    nextTest: TestResult,
    now: number,
  ): void {
    const day = localDay(new Date(now));
    if (this.memory.countAutoAnchors(day) >= 2) return;

    const activity = (
      this.state.activity?.trim() ||
      this.state.windowTitle?.trim() ||
      this.state.app?.trim() ||
      ''
    ).slice(0, 80);
    if (!activity) return;
    if (/等待第一次扫描|暂时看不清|屏幕已锁定|已跳过隐私/.test(activity)) return;

    if (previousTest === 'fail' && nextTest === 'pass') {
      this.addAutoAnchor(`测试红转绿：${activity}`, 'work', 'test-pass', day, now);
    }
    if (nextTest === 'fail' && this.state.focusMin >= 30) {
      this.addAutoAnchor(`测试还红着：${activity}`, 'open_loop', 'stuck-30', day, now);
    }
    if (this.state.focusMin >= 90) {
      this.addAutoAnchor(`连续专注 90 分钟：${activity}`, 'moment', 'focus-90', day, now);
    } else if (this.state.focusMin >= 60) {
      this.addAutoAnchor(`连续专注 60 分钟：${activity}`, 'moment', 'focus-60', day, now);
    }
  }

  private addAutoAnchor(
    text: string,
    kind: AnchorKind,
    eventKey: string,
    day: string,
    at: number,
  ): void {
    if (this.memory.countAutoAnchors(day) >= 2) return;
    if (this.memory.hasAutoAnchorEvent(day, eventKey)) return;
    const anchor = this.memory.addAnchor(text, kind, {
      source: 'auto',
      confidence: 0.85,
      day,
      at,
    });
    if (anchor) this.memory.markAutoAnchorEvent(day, eventKey, anchor.id);
  }

  private isQuietContext(
    now: number,
    active: {
      app?: string;
      title?: string;
      bounds?: { x: number; y: number; width: number; height: number };
    } | null,
    display: {
      bounds: { x: number; y: number; width: number; height: number };
    },
  ): boolean {
    const settings = this.memory.getSettings();
    if (
      isQuietHours(
        new Date(now),
        settings.quietHoursEnabled,
        settings.quietStart,
        settings.quietEnd,
      )
    ) {
      return true;
    }

    if (!active) return false;
    const appName = active.app?.trim().toLowerCase() ?? '';
    if (appName && MEETING_APPS.some((name) => appName.includes(name))) return true;
    const title = active.title?.trim().toLowerCase() ?? '';
    if (title && MEETING_TITLE_PATTERNS.test(title)) return true;

    // 只把“真正铺满整块屏幕”的窗口当作全屏；最大化窗口通常留着菜单栏，不算。
    const bounds = active.bounds;
    const screenBounds = display.bounds;
    if (!bounds || !screenBounds) return false;
    return (
      bounds.width >= screenBounds.width * 0.98 &&
      bounds.height >= screenBounds.height * 0.98 &&
      Math.abs(bounds.x - screenBounds.x) <= 2 &&
      Math.abs(bounds.y - screenBounds.y) <= 2
    );
  }

  private async maybeCompanionMoment(
    now: number,
    idleSec: number,
  ): Promise<CompanionMoment | null> {
    if (this.memory.getSettings().dnd) return null;
    if (Date.now() - this.lastSpokenAt < SPEECH_COOLDOWN_MS) return null;

    const current = new Date(now);
    const today = localDay(current);
    const todayRecord = this.memory.getCompanionDay(today);

    // 白天第一次看到用户：接上昨天，最多一次。
    if (isMorningWindow(current) && !todayRecord.callbackAt && idleSec < 300) {
      const anchors = this.memory.getAnchors(previousDay(today), 3);
      const commitments = this.recentCommitments(now);
      if (anchors.length === 0 && commitments.length === 0) return null;
      if (this.memory.isEventMuted('companion:morning')) return null;
      const generated = await this.generateCompanionText('morning', anchors, commitments);
      return generated.text
        ? { text: generated.text, kind: 'morning', day: today, source: generated.source }
        : null;
    }

    // 晚上用户空闲下来：一句收尾 + 一个具体问题，最多一次。
    // 过了午夜还算“昨天”的收尾，避免 00:30 时找不到今天的锚点。
    const recapDay = recapDayFor(current);
    const recapRecord = this.memory.getCompanionDay(recapDay);
    if (isEveningWindow(current) && !recapRecord.recapAt && idleSec >= 300) {
      const anchors = this.memory.getAnchors(recapDay, 3);
      if (anchors.length === 0) return null;
      if (this.memory.isEventMuted('companion:evening')) return null;
      const commitments = this.recentCommitments(now);
      const generated = await this.generateCompanionText('evening', anchors, commitments);
      return generated.text
        ? { text: generated.text, kind: 'evening', day: recapDay, source: generated.source }
        : null;
    }

    return null;
  }

  private recentCommitments(now: number): Commitment[] {
    // 只接最近三天的承诺，避免把上周的事反复翻出来。
    return this.memory
      .getCommitments('open', 5)
      .filter((commitment) => now - commitment.at <= 3 * 24 * 60 * 60_000)
      .slice(0, 3);
  }

  private async generateCompanionText(
    kind: CompanionMomentKind,
    anchors: DailyAnchor[],
    commitments: Commitment[],
  ): Promise<{ text: string; source: 'deepseek' | 'mock' }> {
    if (this.shouldTryApi()) {
      try {
        const text = await this.client.generateCompanionLine(
          kind,
          anchors.map((anchor) => anchor.text),
          commitments.map((commitment) => commitment.text),
        );
        if (text) return { text, source: 'deepseek' };
      } catch (error) {
        this.noteApiError(error);
      }
    }

    return {
      text:
        kind === 'morning'
          ? buildMorningFallback(anchors, commitments)
          : buildEveningFallback(anchors, commitments),
      source: 'mock',
    };
  }

  private makeCompanionPlan(text: string, kind: CompanionMomentKind): UtterancePlan {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      say: true,
      displayText: clean.slice(0, 90),
      speechText: clean,
      emotion: kind === 'evening' ? 'comfort' : 'think',
      motion: 'think',
      urgency: 'low',
      evidenceIds: [`companion:${kind}`],
      reason: kind === 'morning' ? '次日问候' : '晚间一句',
    };
  }

  private ensureAudible(event: string, plan: UtterancePlan): UtterancePlan {
    if (plan.say) return plan;
    if (!event.startsWith('return:')) return plan;

    const text = '回来了。刚才那会儿我帮你看着。';
    return {
      ...plan,
      say: true,
      displayText: text,
      speechText: text,
      emotion: 'think',
      motion: 'think',
      reason: '主动反馈保底',
    };
  }

  async simulateTest(result: 'pass' | 'fail'): Promise<UtterancePayload> {
    this.state = {
      ...this.state,
      testResult: result,
      lastUpdated: Date.now(),
      focusMin: result === 'pass' ? this.state.focusMin + 1 : this.state.focusMin,
    };

    const event =
      result === 'pass'
        ? `test-pass: 手动模拟测试从失败变为通过`
        : `test-fail: 手动模拟测试再次失败`;

    const generated = await this.generatePlan(event);
    // 手动模拟是验收入口：即使模型选择沉默，也要给出可见气泡和语音反馈。
    const plan = generated.plan.say
      ? generated.plan
      : {
          ...generated.plan,
          say: true,
          displayText: result === 'pass' ? '绿了！测试通过了。' : '又红了。要不要先看最近一次报错？',
          speechText: result === 'pass' ? '绿了！测试通过了。' : '又红了。要不要先看最近一次报错？',
          emotion: result === 'pass' ? ('celebrate' as const) : ('comfort' as const),
          motion: result === 'pass' ? 'celebrate' : 'comfort',
          reason: '手动模拟验收：确保气泡和语音反馈',
        };
    const speakingMs = this.isVoiceEnabled() && plan.say ? this.speak(plan.speechText) : 0;
    this.emit();

    return {
      plan,
      state: { ...this.state },
      speakingMs,
      source: generated.source,
      origin: 'demo',
      eventType: result === 'pass' ? 'test-pass' : 'test-fail',
    };
  }

  async chat(text: string, history: ChatMessage[] = []): Promise<ChatReply> {
    const message = text.trim().slice(0, 1000);
    if (!message) return { text: '你说。', source: 'mock' };

    const autoMemoryEnabled = this.memory.getSettings().autoMemory;
    const explicitRemember = /(记住|记一下|别忘|以后都|以后请)/.test(message);
    this.lastUserAskedToRemember = explicitRemember;
    const companion = this.memory.getCompanionToday();
    const companionLines = [
      companion.anchors.length
        ? `今天的锚点：${companion.anchors
            .slice(0, 3)
            .map((anchor) => anchor.text)
            .join('；')}`
        : '',
      companion.commitments.some((item) => item.status === 'open')
        ? `未完成的承诺：${companion.commitments
            .filter((item) => item.status === 'open')
            .slice(0, 3)
            .map((item) => item.text)
            .join('；')}`
        : '',
    ].filter(Boolean);
    const activityContext = this.memory.getActivityContext(120, 24);
    const correctionContext = this.memory.getRecentCorrectionContext(5);
    const memoryText = `${
      autoMemoryEnabled
        ? '【自动记忆已开启：稳定的偏好/项目会自动保存，不需要询问用户是否记住。】\n'
        : '【自动记忆已关闭：不要主动保存普通陈述，也不要声称记住了；只有用户明确要求时才可调用 remember。】\n'
    }${this.memory.getContext(message, 12)}${
      companionLines.length ? `\n${companionLines.join('\n')}` : ''
    }${activityContext ? `\n\n【最近活动时间线（可回答“我刚才在干嘛”）】\n${activityContext}` : ''}${
      correctionContext ? `\n\n【用户纠正过的事实，优先于上面的时间线】\n${correctionContext}` : ''
    }`;
    const correction = await this.handleCorrection(message, history);
    if (correction) {
      this.memory.appendMessage('user', message);
      this.memory.appendMessage('assistant', correction.text);
      this.emit();
      return correction;
    }
    let replyText = '';
    let source: 'deepseek' | 'mock' = 'mock';
    let rememberedByTool = false;

    if (this.shouldTryApi()) {
      try {
        replyText = await this.client.chatWithTools(
          this.state,
          history,
          message,
          memoryText,
          AGENT_TOOLS,
          async (name, args) => {
            const output = await this.executeTool(name, args);
            if (
              name === 'remember' &&
              output &&
              typeof output === 'object' &&
              (output as { ok?: unknown }).ok === true
            ) {
              rememberedByTool = true;
            }
            return output;
          },
        );
        source = 'deepseek';
        if (this.apiStatus !== 'ok') {
          this.apiStatus = 'ok';
          this.apiMessage = 'DeepSeek 连接正常';
          this.emit();
        }
      } catch (error) {
        this.noteApiError(error);
      }
    }

    const autoFact = rememberedByTool ? null : this.autoRemember(message);
    if (!replyText) {
      if (autoFact) {
        replyText = `记住了：${autoFact.text}`;
      } else if (/(你记得|记住了什么|你的记忆|有哪些记忆)/.test(message)) {
        const facts = this.memory.getFacts(12);
        const anchors = this.memory.getAnchors(undefined, 5);
        const commitments = this.memory.getCommitments('open', 5);
        const lines = [
          ...facts.map((fact) => `- ${fact.text}`),
          ...anchors.map((anchor) => `- [${anchor.day}] ${anchor.text}`),
          ...commitments.map(
            (commitment) =>
              `- [答应 ${new Date(commitment.at).toLocaleDateString('zh-CN')}] ${commitment.text}`,
          ),
        ];
        replyText = lines.length
          ? `我记得这些：\n${lines.join('\n')}`
          : '我还没有保存长期记忆。';
      } else {
        replyText = this.mock.chat(this.state, message).text;
      }
      source = 'mock';
    }

    if (!autoMemoryEnabled && !explicitRemember && /记(下|住)了/.test(replyText)) {
      const remainder = replyText
        .split(/(?<=[。！？!?\n])/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence && !/记(下|住)了/.test(sentence))
        .join(' ')
        .trim();
      replyText = `我明白了。自动记忆当前关闭，这条不会保存。${
        remainder ? `\n${remainder}` : ''
      }`;
    }

    this.memory.appendMessage('user', message);
    this.memory.appendMessage('assistant', replyText);
    this.emit();

    if (
      !autoFact &&
      !rememberedByTool &&
      this.memory.getSettings().autoMemory &&
      message.length >= 8
    ) {
      void this.extractCompanionSignals(message, replyText);
    }

    return { text: replyText, source };
  }

  private async handleCorrection(
    message: string,
    history: ChatMessage[],
  ): Promise<ChatReply | null> {
    if (!isCorrectionCue(message)) return null;

    const previous = [...history]
      .reverse()
      .find((item) => item.role === 'assistant')?.text ?? '';
    let corrected: { correctedActivity: string; minutes: number; confidence: number } | null = null;
    let source: 'deepseek' | 'mock' = 'mock';

    if (this.shouldTryApi()) {
      try {
        const candidate = await this.client.extractCorrection(message, previous);
        if (candidate?.correctedActivity) {
          corrected = candidate;
          source = 'deepseek';
          if (this.apiStatus !== 'ok') {
            this.apiStatus = 'ok';
            this.apiMessage = 'DeepSeek 连接正常';
          }
        }
      } catch (error) {
        this.noteApiError(error);
      }
    }

    if (!corrected) {
      const local = fallbackCorrection(message);
      if (local) corrected = { ...local, confidence: 0.65 };
    }

    if (!corrected?.correctedActivity) {
      return {
        text: '哪里不对？你把正确的那段活动告诉我，我记下来。',
        source,
      };
    }

    const now = Date.now();
    const minutes = Math.min(720, Math.max(5, Math.round(corrected.minutes || 30)));
    const correctedActivity = corrected.correctedActivity
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    this.memory.addCorrection({
      startAt: now - minutes * 60_000,
      endAt: now,
      wrongText: previous.slice(0, 240),
      correctedText: correctedActivity,
      confidence: corrected.confidence ?? 0.8,
    });

    const windowLabel =
      minutes >= 60 ? `过去 ${Math.round(minutes / 60)} 小时` : `刚才 ${minutes} 分钟`;
    const wrong = previous.trim()
      ? `，不是「${previous.replace(/\s+/g, ' ').slice(0, 40)}」`
      : '';
    return {
      text: `明白了：${windowLabel}你是在「${correctedActivity}」${wrong}。这条纠正我记下了，之后回答“刚才在干嘛”会优先用它。`,
      source,
    };
  }

  private async extractCompanionSignals(
    userMessage: string,
    assistantReply: string,
  ): Promise<void> {
    if (!this.memory.getSettings().autoMemory) return;
    if (/^(扫描|打开|关闭|测试|你好|嗨|在吗|谢谢)/.test(userMessage.trim()) && userMessage.length < 24) {
      return;
    }

    let facts: MemoryCandidate[] = [];
    let anchors: CompanionAnchorCandidate[] = [];
    let commitments: CompanionCommitmentCandidate[] = [];
    let usedApi = false;

    if (this.shouldTryApi()) {
      try {
        const signals = await this.client.extractCompanionSignals(userMessage, assistantReply);
        facts = signals.facts;
        anchors = signals.anchors;
        commitments = signals.commitments;
        usedApi = true;
      } catch (error) {
        console.warn(
          '陪伴记忆提取失败，改用本地规则',
          error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        );
      }
    }

    if (!usedApi) {
      const local = extractLocalSignals(userMessage);
      anchors = local.anchors;
      commitments = local.commitments;
    }

    let added = 0;
    for (const candidate of facts) {
      if (candidate.confidence < 0.6) continue;
      this.memory.remember(candidate.text, candidate.kind, {
        source: 'auto',
        confidence: candidate.confidence,
      });
      added += 1;
    }
    for (const anchor of anchors) {
      if (anchor.confidence < 0.5) continue;
      if (
        this.memory.addAnchor(anchor.text, anchor.kind, {
          source: 'auto',
          confidence: anchor.confidence,
        })
      ) {
        added += 1;
      }
    }
    for (const commitment of commitments) {
      if (commitment.confidence < 0.5) continue;
      if (this.memory.addCommitment(commitment.text, commitment.dueHint)) added += 1;
    }
    if (added > 0) this.emit();
  }

  private autoRemember(message: string): MemoryFact | null {
    const match =
      message.match(/^(?:请|帮我)?记住[：:，,\s]*(.+)$/s) ??
      message.match(/(?:以后都|以后请)[：:，,\s]*(.+)$/s);
    return match?.[1] ? this.memory.remember(match[1]) : null;
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case 'remember': {
        if (!this.memory.getSettings().autoMemory && !this.lastUserAskedToRemember) {
          return { ok: false, error: '自动记忆已关闭，只有用户明确要求时才能保存' };
        }
        const kind = args.kind === 'project' || args.kind === 'preference' ? args.kind : undefined;
        const fact = this.memory.remember(typeof args.text === 'string' ? args.text : '', kind, {
          source: 'tool',
          confidence: 1,
        });
        return fact ? { ok: true, fact } : { ok: false, error: '要记住的内容为空' };
      }
      case 'search_memory': {
        const query = typeof args.query === 'string' ? args.query : '';
        return { facts: this.memory.search(query, 10) };
      }
      case 'lookup_activity': {
        const minutes = Math.min(
          24 * 60,
          Math.max(5, Math.round(Number(args.minutes) || 60)),
        );
        const timeline = this.memory.getActivityContext(minutes, 40);
        return {
          minutes,
          timeline: timeline || '没有这段时间的活动记录。',
        };
      }
      case 'scan_screen': {
        const result = await this.scanScreen(false);
        return {
          app: result.state.app,
          title: result.state.windowTitle,
          activity: result.state.activity,
          testResult: result.state.testResult,
          message: result.message,
        };
      }
      case 'set_dnd': {
        const enabled = Boolean(args.enabled);
        this.setDnd(enabled);
        return { dnd: enabled };
      }
      default:
        return { error: `未知工具：${name}` };
    }
  }

  private async generatePlan(event: string): Promise<{
    plan: UtterancePlan;
    source: 'deepseek' | 'mock';
  }> {
    let plan = this.mock.generatePlan(this.state, event);
    let source: 'deepseek' | 'mock' = 'mock';

    if (this.shouldTryApi()) {
      try {
        plan = await this.client.generatePlan(this.state, event);
        source = 'deepseek';
        if (this.apiStatus !== 'ok') {
          this.apiStatus = 'ok';
          this.apiMessage = 'DeepSeek 连接正常';
        }
      } catch (error) {
        this.noteApiError(error);
        plan = this.mock.generatePlan(this.state, event);
        source = 'mock';
      }
    }

    return { plan, source };
  }

  private shouldTryApi(): boolean {
    return this.client.configured && this.apiStatus !== 'invalid';
  }

  private noteApiError(error: unknown): void {
    if (error instanceof DeepSeekError) {
      if (error.status === 401 || error.status === 403) {
        this.apiStatus = 'invalid';
        this.apiMessage = 'API key 无效或没有权限 (401)，已切换本地 mock';
        return;
      }
      this.apiStatus = 'error';
      this.apiMessage = `DeepSeek 请求失败 (${error.status})，已切换本地 mock`;
      return;
    }

    this.apiStatus = 'error';
    this.apiMessage = 'DeepSeek 请求失败，已切换本地 mock';
  }
}
