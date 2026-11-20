import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AppStatus,
  AvatarConfig,
  BubbleFeedbackAction,
  ChatMessage,
  ChatReply,
  CompanionToday,
  DeskMateApi,
  DreamRun,
  HitRect,
  IntentionOutcome,
  IntentionView,
  KnowledgeView,
  MemoryFact,
  SayVoice,
  ScanResult,
  UtterancePayload,
} from '../shared/types';

const api: DeskMateApi = {
  getStatus: () => ipcRenderer.invoke('app:status') as Promise<AppStatus>,

  getAvatarConfig: () =>
    ipcRenderer.invoke('avatar:config') as Promise<AvatarConfig>,

  testConnection: () => ipcRenderer.invoke('api:test') as Promise<AppStatus>,

  scanScreen: () => ipcRenderer.invoke('screen:scan') as Promise<ScanResult>,

  simulateTest: (result) =>
    ipcRenderer.invoke('demo:test', result) as Promise<UtterancePayload>,

  chat: (text: string, history: ChatMessage[] = []) =>
    ipcRenderer.invoke('chat:send', text, history) as Promise<ChatReply>,

  getChatHistory: () => ipcRenderer.invoke('chat:history') as Promise<ChatMessage[]>,

  getMemoryFacts: () => ipcRenderer.invoke('memory:facts') as Promise<MemoryFact[]>,

  getCompanionToday: () =>
    ipcRenderer.invoke('companion:today') as Promise<CompanionToday>,

  getIntentions: () => ipcRenderer.invoke('intentions:view') as Promise<IntentionView>,

  sendIntentionFeedback: (id: string, outcome: IntentionOutcome) =>
    ipcRenderer.invoke('intentions:feedback', id, outcome) as Promise<IntentionView>,

  addAnchor: (text: string, kind?: 'work' | 'feeling' | 'open_loop' | 'moment') =>
    ipcRenderer.invoke('companion:add-anchor', text, kind) as Promise<CompanionToday>,

  deleteAnchor: (id: string) =>
    ipcRenderer.invoke('companion:delete-anchor', id) as Promise<CompanionToday>,

  addCommitment: (text: string, dueHint?: string) =>
    ipcRenderer.invoke('companion:add-commitment', text, dueHint) as Promise<CompanionToday>,

  completeCommitment: (id: string, done: boolean) =>
    ipcRenderer.invoke('companion:complete-commitment', id, done) as Promise<CompanionToday>,

  deleteCommitment: (id: string) =>
    ipcRenderer.invoke('companion:delete-commitment', id) as Promise<CompanionToday>,

  updateAnchor: (id: string, text: string, kind: 'work' | 'feeling' | 'open_loop' | 'moment') =>
    ipcRenderer.invoke('companion:update-anchor', id, text, kind) as Promise<CompanionToday>,

  sendBubbleFeedback: (eventType: string, action: BubbleFeedbackAction) =>
    ipcRenderer.invoke('feedback:bubble', eventType, action) as Promise<void>,

  getVoiceOptions: () => ipcRenderer.invoke('voice:list') as Promise<SayVoice[]>,

  setVoiceSettings: (voiceName: string, speechRate: number) =>
    ipcRenderer.invoke('settings:set-voice-settings', voiceName, speechRate) as Promise<AppStatus>,

  setPersona: (text: string) =>
    ipcRenderer.invoke('settings:set-persona', text) as Promise<AppStatus>,

  setQuietHours: (enabled: boolean, start: string, end: string) =>
    ipcRenderer.invoke('settings:set-quiet-hours', enabled, start, end) as Promise<AppStatus>,

  setDreaming: (enabled: boolean, at: string) =>
    ipcRenderer.invoke('settings:set-dreaming', enabled, at) as Promise<AppStatus>,

  setProactiveLearning: (enabled: boolean) =>
    ipcRenderer.invoke('settings:set-proactive-learning', enabled) as Promise<AppStatus>,

  getKnowledge: () => ipcRenderer.invoke('knowledge:view') as Promise<KnowledgeView>,

  runDreaming: () => ipcRenderer.invoke('knowledge:dream') as Promise<DreamRun>,

  deleteWikiPage: (id: string) =>
    ipcRenderer.invoke('knowledge:delete-page', id) as Promise<KnowledgeView>,

  setRuleActive: (id: string, active: boolean) =>
    ipcRenderer.invoke('knowledge:set-rule', id, active) as Promise<KnowledgeView>,

  deleteRule: (id: string) =>
    ipcRenderer.invoke('knowledge:delete-rule', id) as Promise<KnowledgeView>,

  openKnowledgeFolder: () =>
    ipcRenderer.invoke('knowledge:open-folder') as Promise<string>,

  exportMemory: () => ipcRenderer.invoke('memory:export') as Promise<string | null>,

  addMemory: (text: string, kind?: 'project' | 'preference' | 'fact') =>
    ipcRenderer.invoke('memory:add', text, kind) as Promise<AppStatus>,

  updateMemory: (id: string, text: string, kind: 'project' | 'preference' | 'fact') =>
    ipcRenderer.invoke('memory:update', id, text, kind) as Promise<AppStatus>,

  pinFact: (id: string, pinned: boolean) =>
    ipcRenderer.invoke('memory:pin', id, pinned) as Promise<AppStatus>,

  setAutoMemory: (enabled: boolean) =>
    ipcRenderer.invoke('settings:set-auto-memory', enabled) as Promise<AppStatus>,

  clearMemory: () => ipcRenderer.invoke('memory:clear') as Promise<AppStatus>,

  forgetFact: (id: string) =>
    ipcRenderer.invoke('memory:forget', id) as Promise<AppStatus>,

  setDnd: (enabled: boolean) =>
    ipcRenderer.invoke('settings:set-dnd', enabled) as Promise<AppStatus>,

  setVoice: (enabled: boolean) =>
    ipcRenderer.invoke('settings:set-voice', enabled) as Promise<AppStatus>,

  pausePerception: (minutes: number) =>
    ipcRenderer.invoke('perception:pause', minutes) as Promise<AppStatus>,

  resumePerception: () =>
    ipcRenderer.invoke('perception:resume') as Promise<AppStatus>,

  setPrivacySettings: (excludedApps: string[]) =>
    ipcRenderer.invoke('settings:set-privacy', excludedApps) as Promise<AppStatus>,

  openPanel: () => ipcRenderer.invoke('panel:open') as Promise<void>,

  closePanel: () => ipcRenderer.invoke('panel:close') as Promise<void>,

  setHitRect: (rect: HitRect) =>
    ipcRenderer.invoke('avatar:hit-rect', rect) as Promise<void>,

  beginAvatarDrag: () => ipcRenderer.send('avatar:drag-start'),

  moveAvatar: (dx: number, dy: number) => ipcRenderer.send('avatar:drag-move', dx, dy),

  endAvatarDrag: () => ipcRenderer.send('avatar:drag-end'),

  onUtterance: (callback: (payload: UtterancePayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: UtterancePayload) => {
      callback(payload);
    };
    ipcRenderer.on('avatar:perform', listener);
    return () => ipcRenderer.removeListener('avatar:perform', listener);
  },

  onStatus: (callback: (status: AppStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: AppStatus) => {
      callback(status);
    };
    ipcRenderer.on('status:changed', listener);
    return () => ipcRenderer.removeListener('status:changed', listener);
  },

  onOpenCompanion: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('panel:open-companion', listener);
    return () => ipcRenderer.removeListener('panel:open-companion', listener);
  },
};

contextBridge.exposeInMainWorld('deskmate', api);
