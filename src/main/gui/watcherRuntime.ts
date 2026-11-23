import type { GuiEnvironment } from './environment.ts';
import { runGuiReact } from './react.ts';
import type { GuiCompletion } from './react.ts';

export interface WatcherRuntime {
  check(condition: string): Promise<{ match: boolean; evidence: string }>;
  act(task: string): Promise<{ status: string; final: string }>;
}

function parseVerdict(text: string): { match: boolean; evidence: string } {
  const found = /\{[\s\S]*\}/.exec(text);
  if (!found) return { match: false, evidence: 'judge 没有返回 JSON' };
  try {
    const parsed = JSON.parse(found[0]) as { match?: unknown; evidence?: unknown };
    return { match: parsed.match === true, evidence: String(parsed.evidence ?? '') };
  } catch {
    return { match: false, evidence: 'judge JSON 解析失败' };
  }
}

/** 把真实环境接到 watcher：check 看一张图判断，act 跑一段 ReAct。 */
export function createWatcherRuntime(
  env: GuiEnvironment,
  model: string,
  complete: (body: Record<string, unknown>) => Promise<GuiCompletion>,
): WatcherRuntime {
  return {
    async check(condition) {
      const observation = await env.observe();
      const data = await complete({
        model,
        temperature: 0,
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content:
              '你是屏幕条件判断器。只根据当前截图判断条件是否成立，不要推测，也不要执行动作。' +
              '只输出 JSON：{"match":true|false,"evidence":"一句话"}。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `条件：${condition}\n当前截图是否满足？` },
              { type: 'image_url', image_url: { url: observation.screenshot } },
            ],
          },
        ],
      });
      return parseVerdict(String(data.choices?.[0]?.message?.content ?? ''));
    },

    async act(task) {
      const result = await runGuiReact(task, { env, model, complete });
      return { status: result.status, final: result.final };
    },
  };
}
