export type ApiStatus = 'missing' | 'unchecked' | 'ok' | 'invalid' | 'error';

export type TestResult = 'pass' | 'fail' | 'none';

export type ScreenStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unavailable';

export type Emotion =
  | 'neutral'
  | 'smile'
  | 'surprised'
  | 'angry'
  | 'sad'
  | 'happy'
  | 'serious'
  | 'embarrassed'
  | 'disappointed'
  | 'celebrate'
  | 'tease'
  | 'think'
  | 'comfort';

export interface DemoState {
  testResult: TestResult;
  focusMin: number;
  idleSec: number;
  lastUpdated: number;
  app?: string;
  windowTitle?: string;
  activity?: string;
  lastScanAt?: number;
  lastCheckedAt?: number;
  lastAnalyzedAt?: number;
  confidence?: number;
  scanDurationMs?: number;
  ocrLines?: number;
  captureKind?: 'display' | 'window';
  displayName?: string;
  displayCount?: number;
  displayNames?: string[];
  evidence?: string[];
}

export interface UtterancePlan {
  say: boolean;
  displayText: string;
  speechText: string;
  emotion: Emotion;
  motion: string;
  urgency: 'low' | 'medium' | 'high';
  evidenceIds: string[];
  reason?: string;
}

export interface ScanStats {
  total: number;
  analyzed: number;
}

export interface AppStatus {
  apiStatus: ApiStatus;
  apiMessage: string;
  apiKeyPresent: boolean;
  modelName: string;
  visionModelName: string;
  platform: string;
  voice: string;
  voiceEnabled: boolean;
  voiceName: string;
  speechRate: number;
  persona: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  screenStatus: ScreenStatus;
  dnd: boolean;
  memoryCount: number;
  autoMemory: boolean;
  perceptionPausedUntil?: number;
  excludedApps: string[];
  visionCallsThisHour: number;
  scanStats: ScanStats;
  wikiPageCount: number;
  ruleCount: number;
  skillCount: number;
  lastDreamAt?: number;
  autoDream: boolean;
  dreamingAt: string;
  proactiveLearning: boolean;
  state: DemoState;
}

export type AnchorKind = 'work' | 'feeling' | 'open_loop' | 'moment';

export type CommitmentStatus = 'open' | 'done';

export interface DailyAnchor {
  id: string;
  day: string;
  text: string;
  kind: AnchorKind;
  source: MemorySource;
  confidence: number;
  at: number;
}

export interface Commitment {
  id: string;
  text: string;
  dueHint?: string;
  status: CommitmentStatus;
  at: number;
  lastAskedAt?: number;
}

export interface CompanionDay {
  day: string;
  callbackAt?: number;
  recapAt?: number;
  recapText?: string;
}

export interface CompanionToday {
  day: string;
  anchors: DailyAnchor[];
  commitments: Commitment[];
  callbackAt?: number;
  recapAt?: number;
  recapText?: string;
}

export type MemoryKind = 'project' | 'preference' | 'fact';
export type MemorySource = 'explicit' | 'tool' | 'auto' | 'migration';

export interface MemoryFact {
  id: string;
  text: string;
  kind: MemoryKind;
  pinned: boolean;
  source: MemorySource;
  confidence: number;
  at: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
}

export interface AgentSettings {
  dnd: boolean;
  voiceEnabled: boolean;
  autoMemory: boolean;
  perceptionPausedUntil?: number;
  excludedApps: string[];
  scanIntervalMs: number;
  avatarPosition?: { x: number; y: number };
  voiceName: string;
  speechRate: number;
  persona: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  /** 每晚把对话/活动/锚点整理成 wiki 与规则 */
  autoDream: boolean;
  dreamingAt: string;
  /** 从用户反馈里学习主动提醒规则 */
  proactiveLearning: boolean;
}

export type WikiPageType = 'project' | 'contact' | 'topic';

export interface WikiItem {
  id: string;
  text: string;
  status: 'open' | 'done';
  at: number;
  source?: string;
}

export interface WikiSource {
  ref: string;
  label: string;
  /** 写入时的 200–300 字快照：原行被保留策略裁掉后仍能解释这条记忆。 */
  excerpt?: string;
  at: number;
}

export interface WikiChange {
  at: number;
  note: string;
}

/** 一页只对应一个真实实体：项目、人、长期话题。 */
export interface WikiPage {
  id: string;
  type: WikiPageType;
  name: string;
  aliases: string[];
  summary: string;
  items: WikiItem[];
  sources: WikiSource[];
  changeLog: WikiChange[];
  createdAt: number;
  updatedAt: number;
  lastDreamedAt?: number;
}

export type ProactiveDecision = 'tell_now' | 'follow_up_later' | 'stay_silent';

export interface ProactiveRule {
  id: string;
  /** 事件类型，或 any 表示所有主动消息 */
  kind: string;
  label: string;
  decision: ProactiveDecision;
  windowStart?: string;
  windowEnd?: string;
  reason: string;
  source: 'explicit' | 'dreaming' | 'feedback';
  seen: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProactiveClue {
  id: string;
  kind: string;
  label: string;
  decision: ProactiveDecision;
  seen: number;
  note: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type ProactiveOutcome =
  | 'none'
  | 'dismissed'
  | 'opened'
  | 'replied_positive'
  | 'replied_negative';

export interface ProactiveDelivery {
  id: string;
  eventType: string;
  text: string;
  at: number;
  outcome: ProactiveOutcome;
  suppressed: boolean;
}

export interface DailyReport {
  day: string;
  text: string;
  createdAt: number;
}

export interface DreamRun {
  id: string;
  day: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'ok' | 'error' | 'skipped';
  pages: number;
  rules: number;
  message: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  when: string;
  source: 'builtin' | 'user';
  path: string;
}

export interface MemoryHealth {
  pages: number;
  unsourcedPages: number;
  prunedSources: number;
  stalePages: number;
  duplicateOpenItems: number;
  messages: number;
  activityRows: number;
  oldestActivityAt?: number;
  injectionChars: number;
  checkedAt: number;
}

export interface KnowledgeView {
  pages: WikiPage[];
  rules: ProactiveRule[];
  clues: ProactiveClue[];
  reports: DailyReport[];
  skills: SkillInfo[];
  agentSummary: string;
  health: MemoryHealth;
  lastRun: DreamRun | null;
  dreamingEnabled: boolean;
  dreamingAt: string;
  wikiDir: string;
}

export interface SayVoice {
  name: string;
  locale: string;
}

export type BubbleFeedbackAction = 'dismiss' | 'open';

export interface MemoryExport {
  exportedAt: number;
  facts: MemoryFact[];
  anchors: DailyAnchor[];
  commitments: Commitment[];
  companionDays: CompanionDay[];
  wikiPages: WikiPage[];
  rules: ProactiveRule[];
}

/** 一段连续的“在同一件事上”的操作，是 DeskMate 对意图的最小建模单位。 */
export interface Intention {
  id: string;
  app: string;
  title: string;
  /** 在处理的文件/页面；同一 App 里换它会切成新的一段 */
  entity?: string;
  text: string;
  startAt: number;
  endAt: number;
  stepCount: number;
  confidence: number;
  source: 'deepseek' | 'local';
  at: number;
}

export type IntentionOutcome = 'accepted' | 'rejected';

export interface IntentionPrediction {
  id: string;
  text: string;
  app: string;
  confidence: number;
  decision: 'push' | 'discard';
  reason: string;
  at: number;
  outcome?: IntentionOutcome;
  outcomeAt?: number;
}

export interface IntentionView {
  current: Intention | null;
  recent: Intention[];
  prediction: IntentionPrediction | null;
  todayCount: number;
}

export interface Inspection {
  app: string;
  title: string;
  /** 副屏/环境里看到、但不属于当前任务的东西，只作线索 */
  ambient?: string[];
  activity: string;
  testStatus: TestResult;
  progress: number;
  struggle: number;
  evidence: string[];
  confidence: number;
}

export interface ScanResult {
  state: DemoState;
  inspection: Inspection | null;
  plan: UtterancePayload | null;
  screenStatus: ScreenStatus;
  message: string;
  changed: boolean;
  durationMs: number;
  source: 'deepseek' | 'mock' | 'cache' | 'local';
}

export interface AvatarConfig {
  schema: string;
  id: string;
  name: string;
  model: string;
  scale: number;
  anchor: [number, number];
  lipSync: { param: string; gain: number; max: number };
  expressions: Record<string, string | null>;
  motions: Record<string, string[]>;
  hitAreas: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface UtterancePayload {
  plan: UtterancePlan;
  state: DemoState;
  speakingMs: number;
  source: 'deepseek' | 'mock';
  origin: 'chat' | 'proactive' | 'demo' | 'scan' | 'dream';
  eventType?: string;
}

export interface ChatReply {
  text: string;
  source: 'deepseek' | 'mock';
}

export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskMateApi {
  getStatus(): Promise<AppStatus>;
  getAvatarConfig(): Promise<AvatarConfig>;
  testConnection(): Promise<AppStatus>;
  scanScreen(): Promise<ScanResult>;
  simulateTest(result: 'pass' | 'fail'): Promise<UtterancePayload>;
  chat(text: string, history?: ChatMessage[]): Promise<ChatReply>;
  getChatHistory(): Promise<ChatMessage[]>;
  getMemoryFacts(): Promise<MemoryFact[]>;
  addMemory(text: string, kind?: MemoryKind): Promise<AppStatus>;
  updateMemory(id: string, text: string, kind: MemoryKind): Promise<AppStatus>;
  pinFact(id: string, pinned: boolean): Promise<AppStatus>;
  setAutoMemory(enabled: boolean): Promise<AppStatus>;
  clearMemory(): Promise<AppStatus>;
  forgetFact(id: string): Promise<AppStatus>;
  setDnd(enabled: boolean): Promise<AppStatus>;
  setVoice(enabled: boolean): Promise<AppStatus>;
  pausePerception(minutes: number): Promise<AppStatus>;
  resumePerception(): Promise<AppStatus>;
  setPrivacySettings(excludedApps: string[]): Promise<AppStatus>;
  getCompanionToday(): Promise<CompanionToday>;
  getIntentions(): Promise<IntentionView>;
  sendIntentionFeedback(id: string, outcome: IntentionOutcome): Promise<IntentionView>;
  addAnchor(text: string, kind?: AnchorKind): Promise<CompanionToday>;
  deleteAnchor(id: string): Promise<CompanionToday>;
  addCommitment(text: string, dueHint?: string): Promise<CompanionToday>;
  completeCommitment(id: string, done: boolean): Promise<CompanionToday>;
  deleteCommitment(id: string): Promise<CompanionToday>;
  updateAnchor(id: string, text: string, kind: AnchorKind): Promise<CompanionToday>;
  sendBubbleFeedback(eventType: string, action: BubbleFeedbackAction): Promise<void>;
  getVoiceOptions(): Promise<SayVoice[]>;
  setVoiceSettings(voiceName: string, speechRate: number): Promise<AppStatus>;
  setPersona(text: string): Promise<AppStatus>;
  setQuietHours(enabled: boolean, start: string, end: string): Promise<AppStatus>;
  setDreaming(enabled: boolean, at: string): Promise<AppStatus>;
  setProactiveLearning(enabled: boolean): Promise<AppStatus>;
  getKnowledge(): Promise<KnowledgeView>;
  runDreaming(): Promise<DreamRun>;
  deleteWikiPage(id: string): Promise<KnowledgeView>;
  setRuleActive(id: string, active: boolean): Promise<KnowledgeView>;
  deleteRule(id: string): Promise<KnowledgeView>;
  openKnowledgeFolder(): Promise<string>;
  exportMemory(): Promise<string | null>;
  onOpenCompanion(cb: () => void): () => void;
  openPanel(): Promise<void>;
  closePanel(): Promise<void>;
  setHitRect(rect: HitRect): Promise<void>;
  beginAvatarDrag(): void;
  moveAvatar(dx: number, dy: number): void;
  endAvatarDrag(): void;
  onUtterance(cb: (payload: UtterancePayload) => void): () => void;
  onStatus(cb: (status: AppStatus) => void): () => void;
}
