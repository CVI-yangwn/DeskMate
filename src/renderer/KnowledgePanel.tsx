import { useEffect, useState } from 'react';
import type {
  DreamRun,
  KnowledgeView,
  ProactiveRule,
  WikiPage,
  WikiPageType,
} from '../shared/types';

const TYPE_LABEL: Record<WikiPageType, string> = {
  project: '项目',
  contact: '人物',
  topic: '话题',
};

const DECISION_LABEL: Record<ProactiveRule['decision'], string> = {
  tell_now: '直接说',
  follow_up_later: '晚点说',
  stay_silent: '别说',
};

const KIND_LABEL: Record<string, string> = {
  any: '所有主动消息',
  'test-pass': '测试通过',
  'test-fail': '测试失败',
  observe: '普通观察',
  idle: '空闲提醒',
  return: '回来打招呼',
  'focus-milestone': '专注里程碑',
  'companion:morning': '早间问候',
  'companion:evening': '晚间收尾',
  'intent-predict': '下一步猜测',
};

const RUN_STATUS_LABEL: Record<DreamRun['status'], string> = {
  running: '整理中',
  ok: '完成',
  error: '失败',
  skipped: '跳过',
};

function clock(at?: number): string {
  if (!at) return '还没整理过';
  return new Date(at).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function plain(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
}

function Digest({ text }: { text: string }) {
  return (
    <div className="knowledge-report">
      {text.split('\n').map((line, index) => {
        if (!line.trim()) return <div className="knowledge-report-gap" key={index} />;
        const pieces = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
        return (
          <p key={index}>
            {pieces.map((piece, pieceIndex) =>
              piece.startsWith('**') && piece.endsWith('**') ? (
                <strong key={pieceIndex}>{piece.slice(2, -2)}</strong>
              ) : (
                <span key={pieceIndex}>{piece}</span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}

function PageCard({
  page,
  expanded,
  onToggle,
  onDelete,
}: {
  page: WikiPage;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const open = page.items.filter((item) => item.status === 'open');
  const done = page.items.filter((item) => item.status === 'done');
  return (
    <article className="knowledge-page-card">
      <div className="knowledge-page-head">
        <button className="knowledge-page-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className={`knowledge-type ${page.type}`}>{TYPE_LABEL[page.type]}</span>
          <span className="knowledge-page-name">{page.name}</span>
          <span className="knowledge-page-count">
            {open.length ? `${open.length} 件没做完` : '没有未完成'}
          </span>
          <span className="knowledge-chevron">{expanded ? '−' : '+'}</span>
        </button>
        <button
          className="knowledge-delete"
          title="删除这页"
          onClick={onDelete}
          aria-label={`删除 ${page.name}`}
        >
          ×
        </button>
      </div>

      <p className={`knowledge-summary ${expanded ? 'full' : ''}`}>{plain(page.summary)}</p>

      {expanded && (
        <div className="knowledge-page-body">
          {open.length > 0 && (
            <div className="knowledge-sub">
              <span className="knowledge-sub-title">没做完</span>
              <ul>
                {open.map((item) => (
                  <li key={item.id}>{plain(item.text)}</li>
                ))}
              </ul>
            </div>
          )}
          {done.length > 0 && (
            <details className="knowledge-sub">
              <summary>已完成 {done.length} 件</summary>
              <ul>
                {done.slice(-8).map((item) => (
                  <li key={item.id} className="done">
                    {plain(item.text)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {page.changeLog.length > 0 && (
            <div className="knowledge-sub">
              <span className="knowledge-sub-title">改动</span>
              <ul className="knowledge-changes">
                {page.changeLog.slice(0, 4).map((change) => (
                  <li key={`${change.at}-${change.note}`}>
                    <time>{clock(change.at)}</time> {change.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {page.sources.length > 0 && (
            <div className="knowledge-sub knowledge-sources">
              <span className="knowledge-sub-title">来源</span>
              <ul>
                {page.sources.slice(0, 5).map((source) => (
                  <li key={source.ref} title={source.excerpt || source.label}>
                    {source.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function KnowledgePanel({ lastDreamAt }: { lastDreamAt?: number }) {
  const [view, setView] = useState<KnowledgeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<DreamRun | null>(null);

  async function refresh(): Promise<void> {
    try {
      const next = await window.deskmate.getKnowledge();
      setView(next);
      setLastRun(next.lastRun);
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, [lastDreamAt]);

  async function runNow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const run = await window.deskmate.runDreaming();
      setLastRun(run);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removePage(id: string, name: string): Promise<void> {
    if (!window.confirm(`删除「${name}」？Markdown 文件会保留，之后可以手动再建。`)) return;
    try {
      setView(await window.deskmate.deleteWikiPage(id));
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function toggleRule(rule: ProactiveRule): Promise<void> {
    try {
      setView(await window.deskmate.setRuleActive(rule.id, !rule.active));
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function removeRule(id: string): Promise<void> {
    try {
      setView(await window.deskmate.deleteRule(id));
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function openFolder(): Promise<void> {
    try {
      await window.deskmate.openKnowledgeFolder();
    } catch (cause) {
      setError(String(cause));
    }
  }

  if (!view) {
    return (
      <section className="card knowledge-page">
        <span className="eyebrow">知识</span>
        <p className="muted">正在读知识库…</p>
        {error && <p className="knowledge-error">{error}</p>}
      </section>
    );
  }

  const report = view.reports[0];
  const activeRules = view.rules.filter((rule) => rule.active);
  const pausedRules = view.rules.filter((rule) => !rule.active);
  const run = lastRun ?? view.lastRun;

  return (
    <section className="card knowledge-page">
      <div className="knowledge-head">
        <div>
          <span className="eyebrow">知识</span>
          <p>对话、活动和锚点，每晚收成自己的 wiki。</p>
        </div>
        <button className="memory-add knowledge-run" disabled={busy} onClick={() => void runNow()}>
          {busy ? '整理中…' : '现在整理'}
        </button>
      </div>

      <div className="knowledge-meta">
        <span>{run ? `${RUN_STATUS_LABEL[run.status]} · ${clock(run.finishedAt ?? run.startedAt)}` : '还没整理过'}</span>
        <span>{view.dreamingEnabled ? `自动 ${view.dreamingAt}` : '自动整理已关'}</span>
        <button className="text-button" onClick={() => void openFolder()}>
          打开文件夹
        </button>
      </div>

      {run?.message && <p className="knowledge-run-message">{run.message}</p>}
      {error && <p className="knowledge-error">{error}</p>}

      <div className="knowledge-health">
        <div className="knowledge-health-head">
          <span>记忆健康</span>
          <time>{clock(view.health.checkedAt)}</time>
        </div>
        <div className="knowledge-health-grid">
          <span>{view.health.pages} 页 wiki</span>
          <span>{view.health.messages} 条对话</span>
          <span>{view.health.activityRows} 条活动</span>
          <span>注入 {view.health.injectionChars} 字</span>
          {view.health.unsourcedPages > 0 && (
            <span className="warn">{view.health.unsourcedPages} 页无来源</span>
          )}
          {view.health.prunedSources > 0 && (
            <span className="warn">{view.health.prunedSources} 条来源已过期</span>
          )}
          {view.health.stalePages > 0 && (
            <span className="warn">{view.health.stalePages} 页 90 天没更新</span>
          )}
          {view.health.duplicateOpenItems > 0 && (
            <span className="warn">{view.health.duplicateOpenItems} 条重复未完成</span>
          )}
        </div>
      </div>

      <div className="knowledge-section">
        <div className="knowledge-section-head">
          <span>今天的整理</span>
          {report && <time>{report.day}</time>}
        </div>
        {report ? (
          <Digest text={report.text} />
        ) : (
          <p className="muted">还没生成。晚上会收尾；也可以点“现在整理”。</p>
        )}
      </div>

      <div className="knowledge-section">
        <div className="knowledge-section-head">
          <span>个人 wiki</span>
          <b>{view.pages.length}</b>
        </div>
        {view.pages.length === 0 ? (
          <p className="muted">
            还没有页面。聊上几天、点一次“现在整理”，项目、人和话题会各自有一页。
          </p>
        ) : (
          <div className="knowledge-page-list">
            {view.pages.map((page) => (
              <PageCard
                key={page.id}
                page={page}
                expanded={expanded === page.id}
                onToggle={() => setExpanded(expanded === page.id ? null : page.id)}
                onDelete={() => void removePage(page.id, page.name)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="knowledge-section">
        <div className="knowledge-section-head">
          <span>学到的提醒规则</span>
          <b>{activeRules.length}</b>
        </div>
        {activeRules.length === 0 && pausedRules.length === 0 ? (
          <p className="muted">
            还没有规则。收到提醒后说“以后这类直接说 / 别提醒我 / 晚点再说”，它会记下来。
          </p>
        ) : (
          <div className="knowledge-rule-list">
            {[...activeRules, ...pausedRules].map((rule) => (
              <article className={`knowledge-rule ${rule.active ? '' : 'paused'}`} key={rule.id}>
                <div className="knowledge-rule-main">
                  <span className={`knowledge-decision ${rule.decision}`}>
                    {DECISION_LABEL[rule.decision]}
                  </span>
                  <span className="knowledge-rule-label">{rule.label}</span>
                  <span className="knowledge-rule-kind">
                    {KIND_LABEL[rule.kind] ?? rule.kind}
                    {rule.windowStart && rule.windowEnd
                      ? ` · ${rule.windowStart}–${rule.windowEnd}`
                      : ''}
                  </span>
                  <span className="knowledge-rule-source">{rule.source === 'explicit' ? '你说的' : rule.source === 'feedback' ? '点掉学到的' : '夜间学的'}</span>
                </div>
                {rule.reason && <p>{rule.reason}</p>}
                <div className="knowledge-rule-actions">
                  <button className="text-button" onClick={() => void toggleRule(rule)}>
                    {rule.active ? '暂停' : '恢复'}
                  </button>
                  <button className="text-button danger" onClick={() => void removeRule(rule.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {view.clues.length > 0 && (
          <details className="knowledge-clues">
            <summary>{view.clues.length} 条还没成规则的线索</summary>
            <ul>
              {view.clues.map((clue) => (
                <li key={clue.id}>
                  {clue.label} · {DECISION_LABEL[clue.decision]} · 出现 {clue.seen} 次
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="knowledge-section">
        <div className="knowledge-section-head">
          <span>技能</span>
          <b>{view.skills.length}</b>
        </div>
        <div className="knowledge-skill-list">
          {view.skills.length === 0 && <p className="muted">还没加载到技能。</p>}
          {view.skills.map((skill) => (
            <div className="knowledge-skill" key={skill.name}>
              <strong>
                {skill.name}
                <em>{skill.source === 'user' ? '用户' : '内置'}</em>
              </strong>
              <span>{skill.description}</span>
            </div>
          ))}
        </div>
        <p className="knowledge-foot">
          页面和摘要也会写成 Markdown，放在「打开文件夹」里，随时能看、能删、能版本管理。
        </p>
      </div>

      {view.agentSummary && (
        <details className="knowledge-summary-block">
          <summary>它现在对你的印象</summary>
          <pre>{view.agentSummary}</pre>
        </details>
      )}
    </section>
  );
}
