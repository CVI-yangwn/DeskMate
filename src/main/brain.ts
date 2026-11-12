import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  ApiStatus,
  AppStatus,
  AvatarConfig,
  ChatMessage,
  ChatReply,
  DemoState,
  Inspection,
  MemoryFact,
  MemoryKind,
  ScanResult,
  TestResult,
  UtterancePayload,
  UtterancePlan,
} from '../shared/types';
import { AGENT_TOOLS } from './agentTools';
import { DeepSeekClient, DeepSeekError } from './deepseek';
import { getDeepSeekEnv } from './env';
import { MemoryStore } from './memory';
import { MockBrain } from './mockBrain';
import { runOcr } from './ocr';
import {
  captureActiveWindow,
  getIdleSeconds,
  getScreenStatus,
  hashDistance,
  readActiveWindow,
} from './perception';
import { speakWithSay } from './tts';

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

function textSimilarity(a: string, b: string): number {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (text: string) => {
    const set = new Set<string>();
    for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2));
    return set;
  };
  const aSet = grams(left);
  const bSet = grams(right);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const gram of aSet) if (bSet.has(gram)) overlap += 1;
  return overlap / new Set([...aSet, ...bSet]).size;
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
  private lastProactiveAt = 0;
  private lastFocusMilestone = 0;
  private lastIdleNudgeAt = 0;
  private lastUserAskedToRemember = false;
  private lastScreenHash = '';
  private lastScreenApp = '';
  private lastScreenTitle = '';
  private lastAnalyzedAt = 0;
  private unchangedCount = 0;
  private lastOcrText = '';
  private lastOcrCritical = new Set<string>();
  private scanStats = { total: 0, analyzed: 0, cacheHits: 0 };
  private scanInFlight: Promise<ScanResult> | null = null;
  private visionHourStartedAt = Date.now();
  private visionCallsThisHour = 0;

  constructor() {
    if (this.client.configured) {
      this.apiStatus = 'unchecked';
      this.apiMessage = '已配置 DeepSeek key，点击“测试连接”验证';
    } else {
      this.apiStatus = 'missing';
      this.apiMessage = '未配置 DEEPSEEK_API_KEY，当前使用本地 mock';
    }
  }

  getStatus(): AppStatus {
    return {
      apiStatus: this.apiStatus,
      apiMessage: this.apiMessage,
      apiKeyPresent: this.client.configured,
      modelName: this.client.model,
      visionModelName: this.client.visionModel,
      platform: process.platform,
      voice:
        process.platform === 'darwin'
          ? 'macOS say（Tingting）'
          : '未接语音（当前平台不是 macOS）',
      voiceEnabled: this.memory.getSettings().voiceEnabled,
      screenStatus: getScreenStatus(),
      dnd: this.memory.getSettings().dnd,
      memoryCount: this.memory.getFactCount(),
      autoMemory: this.memory.getSettings().autoMemory,
      perceptionPausedUntil: this.memory.getSettings().perceptionPausedUntil,
      excludedApps: this.memory.getSettings().excludedApps,
      visionBudgetPerHour: this.memory.getSettings().visionBudgetPerHour,
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

  setPrivacySettings(excludedApps: string[], visionBudgetPerHour: number): AppStatus {
    this.memory.updateSettings({
      excludedApps: Array.isArray(excludedApps) ? excludedApps : [],
      visionBudgetPerHour,
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

  private resetVisionWindow(): void {
    if (Date.now() - this.visionHourStartedAt >= 60 * 60_000) {
      this.visionHourStartedAt = Date.now();
      this.visionCallsThisHour = 0;
    }
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
    this.lastProactiveAt = 0;
    this.lastFocusMilestone = 0;
    this.lastIdleNudgeAt = 0;
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

  private ocrSimilarity(text: string): number {
    if (!text || !this.lastOcrText) return 0;
    return textSimilarity(text, this.lastOcrText);
  }

  private ocrCriticalChanged(text: string): boolean {
    const critical = /\b(pass|passed|fail|failed|error|errors)\b|通过|失败|报错|错误/i;
    const current = new Set(
      text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((line) => line && critical.test(line)),
    );
    if (current.size !== this.lastOcrCritical.size) return true;
    for (const line of current) if (!this.lastOcrCritical.has(line)) return true;
    return false;
  }

  private rememberOcr(text: string): void {
    this.lastOcrText = text;
    const critical = /\b(pass|passed|fail|failed|error|errors)\b|通过|失败|报错|错误/i;
    this.lastOcrCritical = new Set(
      text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((line) => line && critical.test(line)),
    );
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

    if (active && this.isAppExcluded(active.app)) {
      this.unchangedCount += 1;
      this.state = {
        ...this.state,
        app: active.app,
        windowTitle: active.title,
        activity: `已跳过隐私应用「${active.app}」，不截图、不分析。`,
        lastScanAt: Date.now(),
        lastCheckedAt: Date.now(),
        confidence: 1,
        evidence: ['隐私排除规则命中'],
        unchangedCount: this.unchangedCount,
        focusMin: this.nextFocusMin(idleSec, Date.now(), active.app),
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
        source: 'cache',
      };
    }

    const captured = await captureActiveWindow(1280);

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

    const sameWindow =
      captured.app === this.lastScreenApp && captured.title === this.lastScreenTitle;
    const distance = hashDistance(captured.hash, this.lastScreenHash);
    const ocr = await runOcr(captured.base64);
    const ocrSimilarity = sameWindow ? this.ocrSimilarity(ocr?.text ?? '') : 0;
    const criticalOcrChanged = sameWindow ? this.ocrCriticalChanged(ocr?.text ?? '') : true;
    const hashUnchanged = Boolean(this.lastScreenHash) && sameWindow && distance <= 8;
    const unchanged = hashUnchanged || (sameWindow && ocrSimilarity >= 0.8 && !criticalOcrChanged);
    const stale = Date.now() - this.lastAnalyzedAt;
    if (unchanged && stale < 10 * 60_000) {
      this.unchangedCount += 1;
      this.scanStats.cacheHits += 1;
      this.state = {
        ...this.state,
        idleSec,
        lastScanAt: Date.now(),
        lastCheckedAt: Date.now(),
        unchangedCount: this.unchangedCount,
        focusMin: this.nextFocusMin(idleSec, Date.now(), active?.app ?? this.state.app),
      };
      this.emit();

      return {
        state: { ...this.state },
        inspection: null,
        plan: null,
        screenStatus,
        message: '屏幕没有明显变化，沿用上次分析。',
        changed: false,
        durationMs: Date.now() - started,
        source: 'cache',
      };
    }

    const ocrTest = detectOcrTest(ocr?.text);
    this.resetVisionWindow();
    const visionBudget = this.memory.getSettings().visionBudgetPerHour;
    const budgetBlocked = this.shouldTryApi() && this.visionCallsThisHour >= visionBudget;

    let inspection: Inspection;
    let source: 'deepseek' | 'mock' | 'local' = 'mock';

    if (budgetBlocked) {
      const localPreview = (ocr?.lines ?? [])
        .filter((line) => line.confidence >= 0.5)
        .slice(0, 3)
        .map((line) => line.text)
        .join(' | ')
        .slice(0, 180);
      inspection = {
        app: captured.app,
        title: captured.title,
        activity:
          this.state.activity && this.state.activity !== INITIAL_STATE.activity
            ? this.state.activity
            : `视觉预算已用完，仅本地 OCR 读取了 ${ocr?.lines.length ?? 0} 行。`,
        testStatus: ocrTest,
        progress: 0,
        struggle: 0,
        evidence: localPreview ? [`OCR: ${localPreview}`, '视觉预算已用完'] : ['视觉预算已用完'],
        confidence: ocr?.lines.length ? 0.45 : 0,
      };
      source = 'local';
    } else if (this.shouldTryApi()) {
      this.visionCallsThisHour += 1;
      try {
        inspection = await this.client.inspectScreenshot(
          captured.base64,
          captured.app,
          captured.title,
          'low',
          ocr?.text,
        );
        source = 'deepseek';
        if (this.apiStatus !== 'ok') {
          this.apiStatus = 'ok';
          this.apiMessage = 'DeepSeek 连接正常';
        }
      } catch (error) {
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
    if (ocr?.lines.length) {
      const preview = ocr.lines
        .filter((line) => line.confidence >= 0.5)
        .slice(0, 3)
        .map((line) => line.text)
        .join(' | ')
        .slice(0, 180);
      if (preview) evidence.push(`OCR: ${preview}`);
    }

    const previousTest = this.state.testResult;
    const nextTest =
      inspection.testStatus === 'none' ? this.state.testResult : inspection.testStatus;
    const analyzedAt = Date.now();

    this.lastScreenHash = captured.hash;
    this.lastScreenApp = captured.app;
    this.lastScreenTitle = captured.title;
    this.lastAnalyzedAt = analyzedAt;
    this.unchangedCount = 0;
    this.scanStats.analyzed += 1;
    this.rememberOcr(ocr?.text ?? '');

    this.state = {
      ...this.state,
      app: inspection.app || captured.app,
      windowTitle: inspection.title || captured.title,
      activity: inspection.activity || this.state.activity,
      testResult: nextTest,
      idleSec,
      lastScanAt: analyzedAt,
      lastCheckedAt: analyzedAt,
      lastAnalyzedAt: analyzedAt,
      confidence: inspection.confidence,
      scanDurationMs: analyzedAt - started,
      unchangedCount: 0,
      ocrLines: ocr?.lines.length ?? 0,
      lastUpdated: analyzedAt,
      evidence: evidence.slice(0, 8),
      focusMin: this.nextFocusMin(idleSec, analyzedAt, inspection.app || captured.app),
    };

    let planPayload: UtterancePayload | null = null;
    let event: string | null = null;
    let critical = false;

    if (previousTest === 'fail' && nextTest === 'pass') {
      event = `test-pass: 截图显示测试从失败变为通过（${this.state.activity}）`;
      critical = true;
    } else if (allowProactive) {
      event = this.pickProactiveEvent(idleSec, now);
    }

    if (event && this.canProactive(critical)) {
      if (event.startsWith('idle:')) {
        this.lastIdleNudgeAt = now;
      } else if (event.startsWith('focus-milestone:')) {
        this.lastFocusMilestone = Math.floor(this.state.focusMin / 25);
      }

      const generated = await this.generatePlan(event);
      const speakingMs =
        this.isVoiceEnabled() && generated.plan.say ? speakWithSay(generated.plan.speechText) : 0;
      planPayload = {
        plan: generated.plan,
        state: { ...this.state },
        speakingMs,
        source: generated.source,
        origin: 'proactive',
      };
      this.lastProactiveAt = Date.now();
      if (generated.plan.say) {
        this.memory.appendMessage('assistant', generated.plan.displayText);
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
          : source === 'local'
            ? `视觉预算已用完（${this.visionCallsThisHour}/${visionBudget}），仅本地 OCR。`
            : ocr?.lines.length
              ? `已扫描（视觉 + 本地 OCR ${ocr.lines.length} 行）。`
              : '已扫描。',
      changed: true,
      durationMs: analyzedAt - started,
      source,
    };
  }

  private pickProactiveEvent(idleSec: number, now: number): string | null {
    if (this.memory.getSettings().dnd) return null;

    if (this.state.focusMin < 25) this.lastFocusMilestone = 0;

    if (idleSec >= 600 && now - this.lastIdleNudgeAt >= 30 * 60_000) {
      return `idle: 用户已经 ${Math.round(idleSec / 60)} 分钟没有操作`;
    }

    const milestone = Math.floor(this.state.focusMin / 25);
    if (this.state.focusMin >= 25 && milestone > this.lastFocusMilestone && idleSec < 300) {
      return `focus-milestone: 连续专注 ${this.state.focusMin} 分钟`;
    }

    return null;
  }

  private canProactive(critical: boolean): boolean {
    const settings = this.memory.getSettings();
    if (settings.dnd) return false;
    const cooldown = critical ? 60_000 : settings.proactiveCooldownMs;
    return Date.now() - this.lastProactiveAt >= cooldown;
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
    const speakingMs = this.isVoiceEnabled() && plan.say ? speakWithSay(plan.speechText) : 0;
    this.emit();

    return {
      plan,
      state: { ...this.state },
      speakingMs,
      source: generated.source,
      origin: 'demo',
    };
  }

  async chat(text: string, history: ChatMessage[] = []): Promise<ChatReply> {
    const message = text.trim().slice(0, 1000);
    if (!message) return { text: '你说。', source: 'mock' };

    const autoMemoryEnabled = this.memory.getSettings().autoMemory;
    const explicitRemember = /(记住|记一下|别忘|以后都|以后请)/.test(message);
    this.lastUserAskedToRemember = explicitRemember;
    const memoryText = `${
      autoMemoryEnabled
        ? '【自动记忆已开启：稳定的偏好/项目会自动保存，不需要询问用户是否记住。】\n'
        : '【自动记忆已关闭：不要主动保存普通陈述，也不要声称记住了；只有用户明确要求时才可调用 remember。】\n'
    }${this.memory.getContext(message, 12)}`;
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
        const facts = this.memory.getFacts(20);
        replyText = facts.length
          ? `我记得这些：\n${facts.map((fact) => `- ${fact.text}`).join('\n')}`
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
      source === 'deepseek' &&
      !autoFact &&
      !rememberedByTool &&
      this.memory.getSettings().autoMemory &&
      message.length >= 8
    ) {
      void this.extractAutoMemories(message, replyText);
    }

    return { text: replyText, source };
  }

  private async extractAutoMemories(userMessage: string, assistantReply: string): Promise<void> {
    if (!this.memory.getSettings().autoMemory || !this.shouldTryApi()) return;
    if (/^(扫描|打开|关闭|测试|你好|嗨|在吗|谢谢)/.test(userMessage.trim()) && userMessage.length < 24) {
      return;
    }

    try {
      const candidates = await this.client.extractMemories(userMessage, assistantReply);
      let added = 0;
      for (const candidate of candidates) {
        if (candidate.confidence < 0.6) continue;
        this.memory.remember(candidate.text, candidate.kind, {
          source: 'auto',
          confidence: candidate.confidence,
        });
        added += 1;
      }
      if (added > 0) this.emit();
    } catch (error) {
      console.warn(
        '自动记忆提取失败',
        error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
      );
    }
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
