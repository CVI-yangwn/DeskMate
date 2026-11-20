// 这里不 import intention.ts：Node 直接跑 .ts 单测时相对导入需要带扩展名，
// 而打包器不需要。十行相似度不值得为它引入耦合。
function compact(text: string): string {
  return text.replace(/[\s，。、；：！？,.;:!?'"“”‘’（）()【】[\]<>《》~-]/g, '');
}

function bigrams(text: string): Set<string> {
  const clean = compact(text);
  const grams = new Set<string>();
  if (clean.length <= 2) {
    if (clean) grams.add(clean);
    return grams;
  }
  for (let i = 0; i < clean.length - 1; i += 1) grams.add(clean.slice(i, i + 2));
  return grams;
}

function textSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * 注意力归属：屏幕上出现的东西 ≠ 用户在干的事。
 *
 * 单帧判断很容易被通知、聊天、副屏带偏。这里加两道闸：
 * 1) 换了应用才立刻接受（真实的切换）；
 * 2) 同一个应用里冒出来的新说法，要连续出现两次才算数。
 *
 * 只做时间上的平滑，不猜内容——猜内容的部分交给模型。
 */

export interface ActivityGateState {
  committed: string;
  candidate: string;
  hits: number;
  app: string;
  /** 连续被拒次数：模型每次换个说法时，不能永远不确认 */
  rejects: number;
}

export const EMPTY_GATE: ActivityGateState = {
  committed: '',
  candidate: '',
  hits: 0,
  app: '',
  rejects: 0,
};

export interface ActivityProposal {
  activity: string;
  app: string;
}

export interface ActivityDecision {
  state: ActivityGateState;
  /** 确认过的活动；没确认时保持上一句，避免界面来回跳 */
  activity: string;
  /** true 表示可以写进意图与记忆 */
  stable: boolean;
  reason: string;
}

/** 同一件事换个说法就别重新计数了。 */
const SAME_THING = 0.55;

export function gateActivity(
  state: ActivityGateState,
  proposal: ActivityProposal,
  minHits = 2,
): ActivityDecision {
  const text = proposal.activity.replace(/\s+/g, ' ').trim();
  const app = proposal.app.trim();

  if (!text) {
    return { state, activity: state.committed, stable: false, reason: '空活动' };
  }

  if (!state.committed) {
    return {
      state: { committed: text, candidate: '', hits: 0, app, rejects: 0 },
      activity: text,
      stable: true,
      reason: '首次确认',
    };
  }

  if (app && state.app && app !== state.app) {
    return {
      state: { committed: text, candidate: '', hits: 0, app, rejects: 0 },
      activity: text,
      stable: true,
      reason: '切换应用',
    };
  }

  if (textSimilarity(text, state.committed) >= SAME_THING) {
    return {
      state: { committed: text, candidate: '', hits: 0, app: app || state.app, rejects: 0 },
      activity: text,
      stable: true,
      reason: '同一件事',
    };
  }

  if (state.candidate && textSimilarity(text, state.candidate) >= SAME_THING) {
    const hits = state.hits + 1;
    if (hits >= minHits) {
      return {
        state: { committed: text, candidate: '', hits: 0, app: app || state.app, rejects: 0 },
        activity: text,
        stable: true,
        reason: `连续 ${hits} 次`,
      };
    }
    return {
      state: { ...state, candidate: text, hits, app: app || state.app, rejects: 0 },
      activity: state.committed,
      stable: false,
      reason: `待确认 ${hits}/${minHits}`,
    };
  }

  // 模型每次换个说法时，“连续两次相同”永远等不到。
  // 连续三帧都在说新东西，那就不是噪声，是画面真的变了。
  const rejects = state.rejects + 1;
  if (rejects >= 3) {
    return {
      state: { committed: text, candidate: '', hits: 0, app: app || state.app, rejects: 0 },
      activity: text,
      stable: true,
      reason: `连续 ${rejects} 帧都在变`,
    };
  }

  return {
    state: { ...state, candidate: text, hits: 1, app: app || state.app, rejects },
    activity: state.committed,
    stable: false,
    reason: '新说法，待确认',
  };
}
