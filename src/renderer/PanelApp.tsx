import { useEffect, useRef, useState } from 'react';
import type {
  AnchorKind,
  AppStatus,
  ChatMessage,
  CompanionToday,
  MemoryFact,
  MemoryKind,
  SayVoice,
} from '../shared/types';

function now(): number {
  return Date.now();
}

function statusLabel(status: AppStatus['apiStatus']): string {
  switch (status) {
    case 'ok':
      return 'DeepSeek 已连接';
    case 'invalid':
      return 'API key 无效';
    case 'error':
      return 'API 请求失败';
    case 'missing':
      return '未配置 API key';
    default:
      return '未验证';
  }
}

function statusClass(status: AppStatus['apiStatus']): string {
  if (status === 'ok') return 'pill pill-ok';
  if (status === 'invalid' || status === 'error') return 'pill pill-bad';
  return 'pill pill-warn';
}

function sourceLabel(source: 'deepseek' | 'mock' | 'cache' | 'local' | null): string {
  if (source === 'deepseek') return 'DeepSeek';
  if (source === 'cache') return '缓存';
  if (source === 'local') return '本地';
  if (source === 'mock') return 'mock';
  return '';
}

function meaningful(value?: string): string {
  const text = value?.trim() ?? '';
  return text && text !== 'unknown' ? text : '';
}

const MEMORY_SOURCE_LABEL = {
  explicit: '手动',
  tool: '工具',
  auto: '自动',
  migration: '迁移',
} as const;

const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  project: '项目',
  preference: '偏好',
  fact: '事实',
};

const ANCHOR_KIND_LABEL: Record<AnchorKind, string> = {
  work: '在做',
  feeling: '心情',
  open_loop: '没完成',
  moment: '瞬间',
};

function formatClock(value?: number): string {
  if (!value) return '未扫描';
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PanelApp() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<'deepseek' | 'mock' | 'cache' | 'local' | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companion, setCompanion] = useState<CompanionToday | null>(null);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionError, setCompanionError] = useState('');
  const [newAnchor, setNewAnchor] = useState('');
  const [newAnchorKind, setNewAnchorKind] = useState<AnchorKind>('work');
  const [newCommitment, setNewCommitment] = useState('');
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);
  const [anchorEditText, setAnchorEditText] = useState('');
  const [anchorEditKind, setAnchorEditKind] = useState<AnchorKind>('work');
  const [voiceOptions, setVoiceOptions] = useState<SayVoice[]>([]);
  const [voiceDraft, setVoiceDraft] = useState('Tingting');
  const [rateDraft, setRateDraft] = useState(180);
  const [personaDraft, setPersonaDraft] = useState('');
  const [quietDraftEnabled, setQuietDraftEnabled] = useState(false);
  const [quietStartDraft, setQuietStartDraft] = useState('23:30');
  const [quietEndDraft, setQuietEndDraft] = useState('08:00');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryFilter, setMemoryFilter] = useState<'all' | MemoryKind | 'pinned'>('all');
  const [newFact, setNewFact] = useState('');
  const [newKind, setNewKind] = useState<MemoryKind>('fact');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [excludedDraft, setExcludedDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState<MemoryKind>('fact');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.deskmate.getStatus().then(setStatus).catch(console.error);
    const offStatus = window.deskmate.onStatus(setStatus);
    const offUtterance = window.deskmate.onUtterance((payload) => {
      setStatus((prev) => (prev ? { ...prev, state: payload.state } : prev));
      setSource(payload.source);
      if (payload.origin === 'chat') return;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: payload.plan.say
            ? payload.plan.displayText
            : `（这次它选择沉默：${payload.plan.reason ?? '不打扰'}）`,
          at: now(),
        },
      ]);
    });

    return () => {
      offStatus();
      offUtterance();
    };
  }, []);

  useEffect(() => {
    void window.deskmate
      .getChatHistory()
      .then((history) => {
        if (history.length > 0) setMessages(history);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!memoryOpen) return;
    void window.deskmate.getMemoryFacts().then(setFacts).catch(console.error);
  }, [memoryOpen, status?.memoryCount]);

  useEffect(() => {
    if (!companionOpen) return;
    void loadCompanion();
  }, [companionOpen]);

  useEffect(() => {
    void loadCompanion();
    const timer = window.setInterval(() => void loadCompanion(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return window.deskmate.onOpenCompanion(() => {
      setCompanionOpen(true);
      void loadCompanion();
      window.setTimeout(() => anchorInputRef.current?.focus(), 120);
    });
  }, []);

  useEffect(() => {
    if (!settingsOpen || !status) return;
    setVoiceDraft(status.voiceName || 'Tingting');
    setRateDraft(status.speechRate || 180);
    setPersonaDraft(status.persona || '');
    setQuietDraftEnabled(Boolean(status.quietHoursEnabled));
    setQuietStartDraft(status.quietStart || '23:30');
    setQuietEndDraft(status.quietEnd || '08:00');
    void window.deskmate.getVoiceOptions().then(setVoiceOptions).catch(console.error);
  }, [settingsOpen]);

  useEffect(() => {
    if (!status) return;
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          role: 'assistant',
          text:
            status.apiStatus === 'missing'
              ? '我在。先提醒一句：还没配置 DeepSeek key，现在我会用本地 mock 回你。'
              : '我在。你先忙，我不吵；需要的时候敲我一下。',
          at: now(),
        },
      ];
    });
  }, [status]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(96, Math.max(38, el.scrollHeight))}px`;
  }, [input]);

  async function runDemo(result: 'pass' | 'fail') {
    if (busy) return;
    setBusy(true);
    try {
      await window.deskmate.simulateTest(result);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `出错了：${String(error)}`, at: now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function scanScreen() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.deskmate.scanScreen();
      setStatus((prev) =>
        prev
          ? { ...prev, state: result.state, screenStatus: result.screenStatus }
          : prev,
      );
      setSource(result.source);
      if (!result.plan) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: result.message, at: now() },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `扫描失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await window.deskmate.testConnection();
      setStatus(next);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `连接检查：${next.apiMessage}`, at: now() },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `连接检查失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDnd() {
    if (!status) return;
    try {
      const next = await window.deskmate.setDnd(!status.dnd);
      setStatus(next);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `切换勿扰失败：${String(error)}`, at: now() },
      ]);
    }
  }

  async function toggleVoice() {
    if (!status) return;
    try {
      const next = await window.deskmate.setVoice(!status.voiceEnabled);
      setStatus(next);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `切换语音失败：${String(error)}`, at: now() },
      ]);
    }
  }

  async function openSettings() {
    if (!status) return;
    setExcludedDraft(status.excludedApps.join('\n'));
    setVoiceDraft(status.voiceName || 'Tingting');
    setRateDraft(status.speechRate || 180);
    setPersonaDraft(status.persona || '');
    setQuietDraftEnabled(Boolean(status.quietHoursEnabled));
    setQuietStartDraft(status.quietStart || '23:30');
    setQuietEndDraft(status.quietEnd || '08:00');
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!status || settingsBusy) return;
    const apps = excludedDraft
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSettingsBusy(true);
    try {
      let next = await window.deskmate.setPrivacySettings(apps);
      next = await window.deskmate.setVoiceSettings(voiceDraft, rateDraft);
      next = await window.deskmate.setPersona(personaDraft);
      next = await window.deskmate.setQuietHours(
        quietDraftEnabled,
        quietStartDraft,
        quietEndDraft,
      );
      setStatus(next);
      setSettingsOpen(false);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `保存设置失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function togglePerceptionPause() {
    if (!status) return;
    try {
      const paused = (status.perceptionPausedUntil ?? 0) > Date.now();
      const next = paused
        ? await window.deskmate.resumePerception()
        : await window.deskmate.pausePerception(15);
      setStatus(next);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `切换感知状态失败：${String(error)}`, at: now() },
      ]);
    }
  }

  async function openMemory() {
    setMemoryOpen(true);
    setMemoryBusy(true);
    try {
      setFacts(await window.deskmate.getMemoryFacts());
    } catch (error) {
      setFacts([]);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `读取记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function loadCompanion(silent = false) {
    if (!silent) {
      setCompanionBusy(true);
      setCompanionError('');
    }
    try {
      setCompanion(await window.deskmate.getCompanionToday());
    } catch (error) {
      if (!silent) setCompanionError(`读取今天失败：${String(error)}`);
    } finally {
      if (!silent) setCompanionBusy(false);
    }
  }

  async function openCompanion() {
    setCompanionOpen(true);
    await loadCompanion();
    window.setTimeout(() => anchorInputRef.current?.focus(), 120);
  }

  async function addAnchor() {
    const text = newAnchor.trim();
    if (!text || companionBusy) return;
    setCompanionBusy(true);
    setCompanionError('');
    try {
      setCompanion(await window.deskmate.addAnchor(text, newAnchorKind));
      setNewAnchor('');
    } catch (error) {
      setCompanionError(`添加锚点失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  function startAnchorEdit(anchor: CompanionToday['anchors'][number]) {
    setEditingAnchorId(anchor.id);
    setAnchorEditText(anchor.text);
    setAnchorEditKind(anchor.kind);
  }

  async function saveAnchorEdit() {
    if (!editingAnchorId || !anchorEditText.trim() || companionBusy) return;
    setCompanionBusy(true);
    setCompanionError('');
    try {
      setCompanion(
        await window.deskmate.updateAnchor(
          editingAnchorId,
          anchorEditText.trim(),
          anchorEditKind,
        ),
      );
      setEditingAnchorId(null);
      setAnchorEditText('');
    } catch (error) {
      setCompanionError(`编辑锚点失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  async function deleteAnchor(id: string) {
    if (companionBusy) return;
    setCompanionBusy(true);
    try {
      setCompanion(await window.deskmate.deleteAnchor(id));
    } catch (error) {
      setCompanionError(`删除锚点失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  async function addCommitment() {
    const text = newCommitment.trim();
    if (!text || companionBusy) return;
    setCompanionBusy(true);
    setCompanionError('');
    try {
      setCompanion(await window.deskmate.addCommitment(text));
      setNewCommitment('');
    } catch (error) {
      setCompanionError(`添加承诺失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  async function completeCommitment(id: string, done: boolean) {
    if (companionBusy) return;
    setCompanionBusy(true);
    try {
      setCompanion(await window.deskmate.completeCommitment(id, done));
    } catch (error) {
      setCompanionError(`更新承诺失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  async function deleteCommitment(id: string) {
    if (companionBusy) return;
    setCompanionBusy(true);
    try {
      setCompanion(await window.deskmate.deleteCommitment(id));
    } catch (error) {
      setCompanionError(`删除承诺失败：${String(error)}`);
    } finally {
      setCompanionBusy(false);
    }
  }

  async function forgetFact(id: string) {
    setMemoryBusy(true);
    try {
      const next = await window.deskmate.forgetFact(id);
      setStatus(next);
      setFacts((prev) => prev.filter((fact) => fact.id !== id));
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `删除记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function addMemory() {
    const text = newFact.trim();
    if (!text || memoryBusy) return;
    setMemoryBusy(true);
    try {
      const next = await window.deskmate.addMemory(text, newKind);
      setStatus(next);
      setFacts(await window.deskmate.getMemoryFacts());
      setNewFact('');
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `添加记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function pinFact(id: string, pinned: boolean) {
    setMemoryBusy(true);
    try {
      const next = await window.deskmate.pinFact(id, pinned);
      setStatus(next);
      setFacts((prev) =>
        prev
          .map((fact) => (fact.id === id ? { ...fact, pinned } : fact))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
      );
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `更新记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  function startEdit(fact: MemoryFact) {
    setEditingId(fact.id);
    setEditText(fact.text);
    setEditKind(fact.kind);
  }

  async function saveEdit() {
    if (!editingId || !editText.trim() || memoryBusy) return;
    setMemoryBusy(true);
    try {
      const next = await window.deskmate.updateMemory(editingId, editText.trim(), editKind);
      setStatus(next);
      setFacts(await window.deskmate.getMemoryFacts());
      setEditingId(null);
      setEditText('');
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `编辑记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function toggleAutoMemory() {
    if (!status) return;
    try {
      const next = await window.deskmate.setAutoMemory(!status.autoMemory);
      setStatus(next);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `切换自动记忆失败：${String(error)}`, at: now() },
      ]);
    }
  }

  async function exportMemory() {
    try {
      const file = await window.deskmate.exportMemory();
      setExportPath(file ? `已导出：${file}` : '已取消导出');
    } catch (error) {
      setExportPath(`导出失败：${String(error)}`);
    }
  }

  async function clearMemory() {
    if (memoryBusy) return;
    if (!window.confirm('清除全部长期记忆和聊天记录？')) return;
    setMemoryBusy(true);
    try {
      const next = await window.deskmate.clearMemory();
      setStatus(next);
      setFacts([]);
      setMessages([{ role: 'assistant', text: '记忆清空了。我们重新认识一下。', at: now() }]);
      setMemoryOpen(false);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `清除记忆失败：${String(error)}`, at: now() },
      ]);
    } finally {
      setMemoryBusy(false);
    }
  }

  async function sendText(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    const userMessage: ChatMessage = { role: 'user', text, at: now() };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setBusy(true);

    try {
      const reply = await window.deskmate.chat(text, messages);
      setSource(reply.source);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: reply.text, at: now() },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `出错了：${String(error)}`, at: now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;
  const dndOn = Boolean(status?.dnd);
  const voiceOn = status?.voiceEnabled !== false;
  const screenLabel =
    status?.screenStatus === 'granted'
      ? '屏幕已授权'
      : status?.screenStatus === 'denied' || status?.screenStatus === 'restricted'
        ? '屏幕权限被拒'
        : status?.screenStatus === 'unavailable'
          ? '非 macOS，屏幕不可用'
          : status?.screenStatus === 'not-determined'
            ? '等待屏幕授权'
            : '屏幕状态未知';
  const rawApp = meaningful(state?.app);
  const locked = rawApp.toLowerCase() === 'loginwindow';
  const appName = locked ? '屏幕已锁定' : rawApp || '等待扫描';
  const windowTitle = locked ? '解锁后自动恢复感知' : meaningful(state?.windowTitle) || '窗口标题不可用';
  const activity = locked
    ? '你离开了一会儿。解锁后我会继续看着。'
    : meaningful(state?.activity) || '还没有扫描。点一下“扫描屏幕”，我看看你在做什么。';
  const appInitial = locked ? '锁' : (rawApp || '同').trim().slice(0, 1).toUpperCase();
  const noForeground = !rawApp || rawApp === 'Desktop';
  const perceptionPaused = (status?.perceptionPausedUntil ?? 0) > Date.now();
  const analyzedAt = state?.lastAnalyzedAt ?? state?.lastScanAt;
  const stateStale = Boolean(analyzedAt && Date.now() - analyzedAt > 5 * 60_000);
  const liveLabel = perceptionPaused
    ? '感知已暂停'
    : locked
      ? '待解锁'
      : dndOn
        ? '勿扰中'
        : stateStale
          ? '可能过期'
          : status?.apiStatus === 'ok'
            ? '感知中'
            : '待连接';
  const apiDot =
    status?.apiStatus === 'ok'
      ? 'ok'
      : status?.apiStatus === 'invalid' || status?.apiStatus === 'error'
        ? 'bad'
        : 'warn';
  const testLabel =
    state?.testResult === 'pass' ? '通过' : state?.testResult === 'fail' ? '失败' : '未知';
  const testClass =
    state?.testResult === 'pass'
      ? 'metric-value ok-text'
      : state?.testResult === 'fail'
        ? 'metric-value bad-text'
        : 'metric-value dim-text';
  const query = memoryQuery.trim().toLowerCase();
  const filteredFacts = facts.filter((fact) => {
    if (memoryFilter === 'pinned') return fact.pinned;
    if (memoryFilter !== 'all') return fact.kind === memoryFilter;
    return true;
  });
  const visibleFacts = query
    ? filteredFacts.filter(
        (fact) =>
          fact.text.toLowerCase().includes(query) ||
          MEMORY_KIND_LABEL[fact.kind].includes(query),
      )
    : filteredFacts;
  const filterCounts = {
    all: facts.length,
    project: facts.filter((fact) => fact.kind === 'project').length,
    preference: facts.filter((fact) => fact.kind === 'preference').length,
    fact: facts.filter((fact) => fact.kind === 'fact').length,
    pinned: facts.filter((fact) => fact.pinned).length,
  };
  const autoMemory = status?.autoMemory !== false;
  const confidence = state?.confidence ?? 0;
  const scanDuration = state?.scanDurationMs ?? 0;
  const evidenceCount = state?.evidence?.length ?? 0;
  const captureLabel =
    state?.captureKind === 'display'
      ? `整屏${state.displayName ? ` · ${state.displayName}` : ''}`
      : state?.captureKind === 'window'
        ? '前台窗口'
        : '';
  const scanStats = status?.scanStats ?? { total: 0, analyzed: 0 };
  const openCommitmentCount =
    companion?.commitments.filter((item) => item.status === 'open').length ?? 0;
  const memoryFilters = [
    { key: 'all' as const, label: '全部', count: filterCounts.all },
    { key: 'project' as const, label: '项目', count: filterCounts.project },
    { key: 'preference' as const, label: '偏好', count: filterCounts.preference },
    { key: 'fact' as const, label: '事实', count: filterCounts.fact },
    { key: 'pinned' as const, label: '置顶', count: filterCounts.pinned },
  ];

  return (
    <div className="panel-root">
      <header className="panel-header">
        <div className="brand-lockup">
          <div className="brand-mark">同</div>
          <div className="brand-copy">
            <div className="brand">
              同桌 <span>DESKMATE</span>
            </div>
            <div className="subtitle">你的桌面工作搭子</div>
          </div>
        </div>
        <div className="header-actions">
          {status && (
            <span className={statusClass(status.apiStatus)} title={status.apiMessage}>
              <i className="status-dot" />
              {statusLabel(status.apiStatus)}
            </span>
          )}
          <button
            className="icon-button"
            onClick={() => void openSettings()}
            title="设置"
            aria-label="设置"
          >
            ⚙
          </button>
          <button
            className="icon-button"
            onClick={() => void window.deskmate.closePanel()}
            title="收起"
            aria-label="收起"
          >
            ×
          </button>
        </div>
      </header>

      <main className="panel-main">
        <section className="card now-card">
          <div className="now-head">
            <span className="eyebrow">此刻</span>
            <div className="context-badges">
              {source && <span className="source-tag">{sourceLabel(source)}</span>}
              <span
                className={`live-pill ${dndOn || locked || perceptionPaused || stateStale ? 'paused' : 'live'}`}
              >
                {liveLabel}
              </span>
            </div>
          </div>

          <div className="now-app">
            <div className={`app-badge ${locked ? 'locked' : ''}`}>{appInitial}</div>
            <div className="app-copy">
              <div className="context-app">{appName}</div>
              <div className="context-window">{windowTitle}</div>
            </div>
          </div>

          <p className="activity">{activity}</p>

          <div className="metrics">
            <div className="metric">
              <span>测试</span>
              <strong className={testClass}>{testLabel}</strong>
            </div>
            <div className="metric">
              <span>专注</span>
              <strong className="metric-value">
                {state?.focusMin ?? 0}
                <em> min</em>
              </strong>
            </div>
            <div className="metric">
              <span>最近扫描</span>
              <strong className="metric-value">{formatClock(state?.lastScanAt)}</strong>
            </div>
          </div>

          <details className="context-insight diagnostics" title={state?.evidence?.join('\n') || undefined}>
            <summary>诊断</summary>
            <div className="diagnostics-grid">
              {captureLabel && <span className="capture-chip">{captureLabel}</span>}
              {noForeground && <span className="stale-text">未读前台应用</span>}
              <span>{state?.ocrLines ? `OCR ${state.ocrLines} 行` : '视觉分析'}</span>
              <span>{confidence ? `置信度 ${Math.round(confidence * 100)}%` : '置信度 —'}</span>
              {scanDuration > 0 && <span>{Math.round(scanDuration / 100) / 10}s</span>}
              {evidenceCount > 0 && <span>{evidenceCount} 条证据</span>}
              <span>
                扫描 {scanStats.total} 次 · 分析 {scanStats.analyzed} 次
              </span>
              <span>视觉 {status?.visionCallsThisHour ?? 0} 次/小时</span>
              {stateStale && <span className="stale-text">状态可能过期</span>}
            </div>
          </details>

          <div className="context-foot">
            <span className="context-api" title={status?.apiMessage}>
              <i className={`api-dot ${apiDot}`} />
              {status?.apiMessage ?? '读取中…'}
            </span>
            <span>{screenLabel}</span>
          </div>
        </section>

        <section className="card today-card">
          <div className="today-head">
            <div>
              <span className="eyebrow">今天</span>
              <p className="today-sub">只记值得记的瞬间，不做流水账。</p>
            </div>
            <button className="text-button" onClick={() => void openCompanion()}>
              记一下
            </button>
          </div>

          <div className="today-list">
            {companion?.anchors.length ? (
              companion.anchors.slice(0, 3).map((anchor) => (
                <div className="today-item" key={anchor.id}>
                  <span className={`memory-kind ${anchor.kind}`}>
                    {ANCHOR_KIND_LABEL[anchor.kind]}
                  </span>
                  <span className="today-text">{anchor.text}</span>
                  <time>{formatClock(anchor.at)}</time>
                </div>
              ))
            ) : (
              <p className="muted">
                今天还没有锚点。点“记一下”，或跟我说说今天做了什么。
              </p>
            )}
          </div>

          <div className="today-foot">
            <span>{openCommitmentCount} 件答应的事</span>
            <button className="text-button" onClick={() => void openCompanion()}>
              查看今天
            </button>
          </div>
        </section>

        <section className="card action-card">
          <div className="action-grid">
            <button className="action action-scan" disabled={busy} onClick={() => void scanScreen()}>
              <span className="action-icon">⌕</span>
              <span className="action-copy">
                <strong>扫描屏幕</strong>
                <small>抓取聚焦显示器整屏</small>
              </span>
              <span className="action-arrow">→</span>
            </button>
            <button className="action action-demo pass" disabled={busy} onClick={() => void runDemo('pass')}>
              <span className="action-icon">✓</span>
              <span className="action-copy">
                <strong>模拟通过</strong>
                <small>红 → 绿</small>
              </span>
            </button>
            <button className="action action-demo fail" disabled={busy} onClick={() => void runDemo('fail')}>
              <span className="action-icon">!</span>
              <span className="action-copy">
                <strong>模拟失败</strong>
                <small>测试提醒</small>
              </span>
            </button>
          </div>

          <div className="utility-row">
            <button className={`toggle ${dndOn ? 'on' : ''}`} onClick={() => void toggleDnd()}>
              <span className="toggle-dot" />
              勿扰 <b>{dndOn ? '开' : '关'}</b>
            </button>
            <button className="toggle" onClick={() => void openMemory()}>
              <span className="toggle-dot" />
              记忆 <b>{status?.memoryCount ?? 0}</b>
            </button>
            <button className="toggle" onClick={() => void openCompanion()}>
              <span className="toggle-dot" />
              今天 <b>{companion?.anchors.length ?? 0}</b>
            </button>
            <button className={`toggle ${voiceOn ? 'on' : ''}`} onClick={() => void toggleVoice()}>
              <span className="toggle-dot" />
              语音 <b>{voiceOn ? '开' : '关'}</b>
            </button>
            <button
              className={`toggle ${perceptionPaused ? 'on' : ''}`}
              onClick={() => void togglePerceptionPause()}
              title={perceptionPaused ? '恢复自动感知' : '暂停自动感知 15 分钟'}
            >
              <span className="toggle-dot" />
              {perceptionPaused ? '恢复感知' : '暂停 15m'}
            </button>
            <button className="text-button" disabled={busy} onClick={() => void testConnection()}>
              测试连接
            </button>
          </div>
        </section>

        <section className="card chat-card">
          <div className="chat-head">
            <div className="chat-title-block">
              <div className="card-title">和同桌说两句</div>
              <div className="chat-sub">{voiceOn ? '语音自动朗读已开启' : '语音已静音'}</div>
            </div>
            {source && <span className="source-tag">{sourceLabel(source)}</span>}
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.map((message, index) => (
              <div
                key={`${message.at}-${index}`}
                className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className="message-role">{message.role === 'user' ? '你' : '同桌'}</div>
                <div className="message-text">{message.text}</div>
              </div>
            ))}
            {busy && (
              <div className="typing">
                <span className="typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                同桌正在想…
              </div>
            )}
          </div>

          {messages.length < 4 && (
            <div className="prompt-chips">
              <button onClick={() => void sendText('我现在该干嘛？')}>我现在该干嘛？</button>
              <button onClick={() => void sendText('总结一下我屏幕上的内容')}>总结屏幕</button>
            </div>
          )}

          <div className="composer">
            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              maxLength={1000}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendText(input);
                }
              }}
              placeholder="例如：我现在该干嘛？"
              disabled={busy}
            />
            <button
              className="send-button"
              disabled={busy || !input.trim()}
              onClick={() => void sendText(input)}
              title="发送"
              aria-label="发送"
            >
              ↑
            </button>
          </div>
          <div className="composer-hint">Enter 发送 · Shift+Enter 换行</div>
        </section>
      </main>

      <footer className="panel-footer">
        <span className="footer-brand">
          <i className="footer-dot" />
          Haru · Live2D
        </span>
        <span>{voiceOn ? '语音开启' : '语音静音'} · macOS</span>
      </footer>

      {settingsOpen && (
        <div className="sheet-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="memory-sheet settings-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>设置</h2>
                <p>只影响主动说话和感知，不会主动弹出面板。</p>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭">
                ×
              </button>
            </div>

            <div className="settings-section">
              <label htmlFor="excluded-apps">隐私排除的应用</label>
              <p>前台是这些应用时，不截图、不调用视觉模型。每行一个，按名称包含匹配。</p>
              <textarea
                id="excluded-apps"
                value={excludedDraft}
                onChange={(event) => setExcludedDraft(event.target.value)}
                rows={5}
                placeholder={'1Password\nKeychain Access\nSystem Settings'}
              />
            </div>

            <div className="settings-section">
              <label htmlFor="voice-name">陪伴声音</label>
              <p>音色来自 macOS `say`，语速 120–260。可以先用“测试”听一句。</p>
              <div className="settings-row">
                <select
                  id="voice-name"
                  value={voiceDraft}
                  onChange={(event) => setVoiceDraft(event.target.value)}
                  disabled={settingsBusy}
                >
                  {voiceOptions.length === 0 && <option value="Tingting">Tingting</option>}
                  {voiceOptions.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} · {voice.locale}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  min={120}
                  max={260}
                  step={10}
                  value={rateDraft}
                  onChange={(event) => setRateDraft(Number(event.target.value))}
                  disabled={settingsBusy}
                  aria-label="语速"
                />
                <span className="settings-value">{rateDraft}</span>
                <button
                  className="text-button"
                  disabled={settingsBusy}
                  onClick={() =>
                    void window.deskmate.setVoiceSettings(voiceDraft, rateDraft).then((next) => {
                      setStatus(next);
                      window.deskmate.chat('用现在的音色说一句“我在”。', []).catch(console.error);
                    })
                  }
                >
                  测试
                </button>
              </div>
            </div>

            <div className="settings-section">
              <label htmlFor="persona">人格 / 说话方式</label>
              <p>写称呼、语气、边界、绝对不说。留空用默认同桌人格。</p>
              <textarea
                id="persona"
                value={personaDraft}
                onChange={(event) => setPersonaDraft(event.target.value)}
                rows={4}
                placeholder={'叫我老杨。说话短一点，别用“加油”。\n不确定的时候直接说不知道。'}
                disabled={settingsBusy}
              />
            </div>

            <div className="settings-section">
              <label>安静时段</label>
              <p>这段时间不主动说话；手动聊天和“记一下”不受影响。</p>
              <div className="settings-row">
                <button
                  className={`toggle ${quietDraftEnabled ? 'on' : ''}`}
                  onClick={() => setQuietDraftEnabled((value) => !value)}
                  aria-pressed={quietDraftEnabled}
                  disabled={settingsBusy}
                >
                  <span className="toggle-dot" />
                  安静时段 <b>{quietDraftEnabled ? '开' : '关'}</b>
                </button>
                <input
                  type="time"
                  value={quietStartDraft}
                  onChange={(event) => setQuietStartDraft(event.target.value)}
                  disabled={settingsBusy || !quietDraftEnabled}
                  aria-label="安静时段开始"
                />
                <span className="settings-value">→</span>
                <input
                  type="time"
                  value={quietEndDraft}
                  onChange={(event) => setQuietEndDraft(event.target.value)}
                  disabled={settingsBusy || !quietDraftEnabled}
                  aria-label="安静时段结束"
                />
              </div>
            </div>

            <div className="settings-note">
              普通观察默认安静：同一活动 10 分钟内不重复，活动变化至少隔 3 分钟；全屏和会议中不主动说话。暂停感知、勿扰和语音开关仍在主面板操作。
            </div>

            <div className="settings-actions">
              <button className="text-button" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button
                className="memory-add"
                onClick={() => void saveSettings()}
                disabled={settingsBusy}
              >
                保存设置
              </button>
            </div>
          </section>
        </div>
      )}

      {companionOpen && (
        <div className="sheet-backdrop" onClick={() => setCompanionOpen(false)}>
          <section className="memory-sheet companion-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>今天</h2>
                <p>{companion?.day ?? '读取中'} · 只记 2–3 个锚点，不做流水账。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setCompanionOpen(false)}
                title="关闭"
              >
                ×
              </button>
            </div>

            {companionError && <div className="settings-note">{companionError}</div>}

            <div className="companion-section">
              <div className="companion-section-head">
                <span>今天的锚点</span>
                <b>{companion?.anchors.length ?? 0}</b>
              </div>
              <div className="memory-list">
                {companion?.anchors.length ? (
                  companion.anchors.map((anchor) => (
                    <article className="memory-item" key={anchor.id}>
                      <div className="memory-main">
                        <div className="memory-meta">
                          <span className={`memory-kind ${anchor.kind}`}>
                            {ANCHOR_KIND_LABEL[anchor.kind]}
                          </span>
                          <span className="memory-source auto">
                            {anchor.source === 'explicit' ? '手动' : '自动'}
                          </span>
                          <time>{formatClock(anchor.at)}</time>
                        </div>
                        {editingAnchorId === anchor.id ? (
                          <div className="memory-edit">
                            <select
                              value={anchorEditKind}
                              onChange={(event) =>
                                setAnchorEditKind(event.target.value as AnchorKind)
                              }
                              disabled={companionBusy}
                            >
                              <option value="work">在做</option>
                              <option value="feeling">心情</option>
                              <option value="open_loop">没完成</option>
                              <option value="moment">瞬间</option>
                            </select>
                            <input
                              value={anchorEditText}
                              onChange={(event) => setAnchorEditText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveAnchorEdit();
                                }
                                if (event.key === 'Escape') {
                                  setEditingAnchorId(null);
                                }
                              }}
                              disabled={companionBusy}
                            />
                            <div className="memory-edit-actions">
                              <button className="text-button" onClick={() => setEditingAnchorId(null)}>
                                取消
                              </button>
                              <button
                                className="memory-add"
                                onClick={() => void saveAnchorEdit()}
                                disabled={companionBusy || !anchorEditText.trim()}
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p>{anchor.text}</p>
                        )}
                      </div>
                      <div className="memory-actions">
                        <button
                          className="memory-edit-button"
                          onClick={() => startAnchorEdit(anchor)}
                          title="编辑这个锚点"
                          disabled={companionBusy}
                        >
                          ✎
                        </button>
                        <button
                          className="memory-delete"
                          onClick={() => void deleteAnchor(anchor.id)}
                          title="删除这个锚点"
                          disabled={companionBusy}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="memory-empty">
                    今天还没有锚点。
                    <br />
                    记一个具体的瞬间，不用写流水账。
                  </div>
                )}
              </div>

              <div className="memory-compose">
                <select
                  value={newAnchorKind}
                  onChange={(event) => setNewAnchorKind(event.target.value as AnchorKind)}
                  disabled={companionBusy}
                  aria-label="锚点类型"
                >
                  <option value="work">在做</option>
                  <option value="feeling">心情</option>
                  <option value="open_loop">没完成</option>
                  <option value="moment">瞬间</option>
                </select>
                <input
                  ref={anchorInputRef}
                  value={newAnchor}
                  onChange={(event) => setNewAnchor(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addAnchor();
                    }
                  }}
                  placeholder="比如：下午把 auth 的 race 修好了…"
                  disabled={companionBusy}
                />
                <button
                  className="memory-add"
                  onClick={() => void addAnchor()}
                  disabled={companionBusy || !newAnchor.trim()}
                >
                  添加
                </button>
              </div>
            </div>

            <div className="companion-section">
              <div className="companion-section-head">
                <span>答应过的事</span>
                <b>{openCommitmentCount}</b>
              </div>
              <div className="memory-list">
                {companion?.commitments.length ? (
                  companion.commitments.map((commitment) => (
                    <article
                      className={`memory-item ${commitment.status === 'done' ? 'done' : ''}`}
                      key={commitment.id}
                    >
                      <div className="memory-main">
                        <div className="memory-meta">
                          <span className={`memory-kind ${commitment.status === 'done' ? 'fact' : 'preference'}`}>
                            {commitment.status === 'done' ? '完成' : '答应'}
                          </span>
                          {commitment.dueHint && (
                            <span className="memory-source auto">{commitment.dueHint}</span>
                          )}
                          <time>{new Date(commitment.at).toLocaleDateString('zh-CN')}</time>
                        </div>
                        <p>{commitment.text}</p>
                      </div>
                      <div className="memory-actions">
                        <button
                          className={`memory-pin ${commitment.status === 'done' ? 'on' : ''}`}
                          onClick={() =>
                            void completeCommitment(commitment.id, commitment.status !== 'done')
                          }
                          title={commitment.status === 'done' ? '标为未完成' : '标为完成'}
                          disabled={companionBusy}
                        >
                          {commitment.status === 'done' ? '✓' : '○'}
                        </button>
                        <button
                          className="memory-delete"
                          onClick={() => void deleteCommitment(commitment.id)}
                          title="删除这条承诺"
                          disabled={companionBusy}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="memory-empty">
                    还没有答应过的事。
                    <br />
                    说一句“今晚把数字发他”，我会记着。
                  </div>
                )}
              </div>

              <div className="memory-compose">
                <input
                  value={newCommitment}
                  onChange={(event) => setNewCommitment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addCommitment();
                    }
                  }}
                  placeholder="今晚/明天要做什么…"
                  disabled={companionBusy}
                />
                <button
                  className="memory-add"
                  onClick={() => void addCommitment()}
                  disabled={companionBusy || !newCommitment.trim()}
                >
                  添加
                </button>
              </div>
            </div>

            {companion?.recapText && (
              <div className="settings-note">今晚的一句：{companion.recapText}</div>
            )}

            <div className="sheet-foot">
              <span>
                {companion?.anchors.length ?? 0} 个锚点 · {openCommitmentCount} 件未完成
              </span>
              <button className="text-button" onClick={() => setCompanionOpen(false)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}

      {memoryOpen && (
        <div className="sheet-backdrop" onClick={() => setMemoryOpen(false)}>
          <section className="memory-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>长期记忆</h2>
                <p>相关记忆会自动带进对话；置顶的记忆始终优先。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setMemoryOpen(false);
                  setEditingId(null);
                }}
                title="关闭"
              >
                ×
              </button>
            </div>

            <div className="memory-settings-row">
              <button
                className={`toggle ${autoMemory ? 'on' : ''}`}
                onClick={() => void toggleAutoMemory()}
                aria-pressed={autoMemory}
              >
                <span className="toggle-dot" />
                自动记忆 <b>{autoMemory ? '开' : '关'}</b>
              </button>
              <span>从聊天中自动沉淀长期信息</span>
            </div>

            <div className="memory-toolbar">
              <input
                value={memoryQuery}
                onChange={(event) => setMemoryQuery(event.target.value)}
                placeholder="搜索记忆…"
                disabled={memoryBusy}
              />
              <span>{visibleFacts.length} / {facts.length}</span>
            </div>

            <div className="memory-filters">
              {memoryFilters.map((filter) => (
                <button
                  key={filter.key}
                  className={memoryFilter === filter.key ? 'active' : ''}
                  onClick={() => setMemoryFilter(filter.key)}
                >
                  {filter.label}
                  <b>{filter.count}</b>
                </button>
              ))}
            </div>

            <div className="memory-compose">
              <select
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as MemoryKind)}
                disabled={memoryBusy}
                aria-label="记忆类型"
              >
                <option value="fact">事实</option>
                <option value="preference">偏好</option>
                <option value="project">项目</option>
              </select>
              <input
                value={newFact}
                onChange={(event) => setNewFact(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void addMemory();
                  }
                }}
                placeholder="手动添加一条记忆…"
                disabled={memoryBusy}
              />
              <button
                className="memory-add"
                onClick={() => void addMemory()}
                disabled={memoryBusy || !newFact.trim()}
              >
                添加
              </button>
            </div>

            <div className="memory-list">
              {memoryBusy && facts.length === 0 ? (
                <div className="muted">读取中…</div>
              ) : visibleFacts.length === 0 ? (
                <div className="memory-empty">
                  {query ? (
                    <>没有匹配“{memoryQuery}”的记忆。</>
                  ) : memoryFilter !== 'all' ? (
                    <>这个分类下还没有记忆。</>
                  ) : (
                    <>
                      还没有长期记忆。
                      <br />
                      在聊天里说“记住……”，或直接在上方添加。
                    </>
                  )}
                </div>
              ) : (
                visibleFacts.map((fact) => (
                  <article className={`memory-item ${fact.pinned ? 'pinned' : ''}`} key={fact.id}>
                    <div className="memory-main">
                      <div className="memory-meta">
                        <span className={`memory-kind ${fact.kind}`}>
                          {MEMORY_KIND_LABEL[fact.kind]}
                        </span>
                        <span className={`memory-source ${fact.source}`}>
                          {MEMORY_SOURCE_LABEL[fact.source]}
                        </span>
                        {fact.pinned && <span className="memory-pinned">置顶</span>}
                        {fact.useCount > 0 && (
                          <span className="memory-used">用过 {fact.useCount} 次</span>
                        )}
                        <time>{new Date(fact.updatedAt).toLocaleDateString('zh-CN')}</time>
                      </div>

                      {editingId === fact.id ? (
                        <div className="memory-edit">
                          <select
                            value={editKind}
                            onChange={(event) => setEditKind(event.target.value as MemoryKind)}
                            disabled={memoryBusy}
                          >
                            <option value="fact">事实</option>
                            <option value="preference">偏好</option>
                            <option value="project">项目</option>
                          </select>
                          <input
                            value={editText}
                            onChange={(event) => setEditText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void saveEdit();
                              }
                              if (event.key === 'Escape') {
                                setEditingId(null);
                              }
                            }}
                            disabled={memoryBusy}
                          />
                          <div className="memory-edit-actions">
                            <button className="text-button" onClick={() => setEditingId(null)}>
                              取消
                            </button>
                            <button
                              className="memory-add"
                              onClick={() => void saveEdit()}
                              disabled={memoryBusy || !editText.trim()}
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p>{fact.text}</p>
                      )}
                    </div>

                    <div className="memory-actions">
                      <button
                        className="memory-edit-button"
                        onClick={() => startEdit(fact)}
                        title="编辑这条记忆"
                        disabled={memoryBusy}
                      >
                        ✎
                      </button>
                      <button
                        className={`memory-pin ${fact.pinned ? 'on' : ''}`}
                        onClick={() => void pinFact(fact.id, !fact.pinned)}
                        title={fact.pinned ? '取消置顶' : '置顶'}
                        disabled={memoryBusy}
                      >
                        {fact.pinned ? '★' : '☆'}
                      </button>
                      <button
                        className="memory-delete"
                        onClick={() => void forgetFact(fact.id)}
                        title="删除这条记忆"
                        disabled={memoryBusy}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="sheet-foot">
              <span>{exportPath || `${facts.length} 条记忆`}</span>
              <div className="memory-footer-actions">
                <button className="text-button" onClick={() => void exportMemory()}>
                  导出
                </button>
                <button
                  className="text-button danger"
                  onClick={() => void clearMemory()}
                  disabled={memoryBusy || facts.length === 0}
                >
                  清空全部
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
