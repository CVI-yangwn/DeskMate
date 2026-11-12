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
  unchangedCount?: number;
  ocrLines?: number;
  captureKind?: 'display' | 'window';
  displayName?: string;
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
  cacheHits: number;
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
  screenStatus: ScreenStatus;
  dnd: boolean;
  memoryCount: number;
  autoMemory: boolean;
  perceptionPausedUntil?: number;
  excludedApps: string[];
  visionBudgetPerHour: number;
  visionCallsThisHour: number;
  scanStats: ScanStats;
  state: DemoState;
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
  visionBudgetPerHour: number;
  scanIntervalMs: number;
  proactiveCooldownMs: number;
  avatarPosition?: { x: number; y: number };
}

export interface Inspection {
  app: string;
  title: string;
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
  origin: 'chat' | 'proactive' | 'demo';
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
  setPrivacySettings(excludedApps: string[], visionBudgetPerHour: number): Promise<AppStatus>;
  openPanel(): Promise<void>;
  closePanel(): Promise<void>;
  setHitRect(rect: HitRect): Promise<void>;
  beginAvatarDrag(): void;
  moveAvatar(dx: number, dy: number): void;
  endAvatarDrag(): void;
  onUtterance(cb: (payload: UtterancePayload) => void): () => void;
  onStatus(cb: (status: AppStatus) => void): () => void;
}
