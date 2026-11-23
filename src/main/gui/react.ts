import { COMPUTER_TOOL, executeComputer } from './computerTool.ts';
import type { GuiEnvironment } from './environment.ts';

/**
 * GUI 的 ReAct 循环，照 ernie_agent 的 Orchestrator 简化：
 *
 *   LLM -> computer 工具调用 -> 环境执行 -> 返回 {文本 + 新截图} -> LLM ...
 *
 * 没有独立的 planner / precondition / verifier 阶段：
 * “验证”就是模型看动作返回的那张截图；“完成”就是模型不再调用工具。
 */

export interface GuiToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

export interface GuiMessageReply {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: GuiToolCall[];
}

export interface GuiCompletion {
  choices?: Array<{ message?: GuiMessageReply }>;
}

export interface GuiReactEvent {
  step: number;
  action: string;
  args: Record<string, unknown>;
  text: string;
  thinking?: string;
  hasImage: boolean;
}

export interface GuiReactDeps {
  env: GuiEnvironment;
  model: string;
  complete(body: Record<string, unknown>): Promise<GuiCompletion>;
  maxSteps?: number;
  /** 消息里最多保留几张截图，默认 5。更早的图会被移除，只留动作文本。 */
  maxImages?: number;
  onEvent?(event: GuiReactEvent): void;
}

export interface GuiReactResult {
  status: 'done' | 'max_steps';
  final: string;
  steps: number;
  transcript: GuiReactEvent[];
}

const SYSTEM = `## Screen
You are operating a macOS desktop GUI.

Coordinates are NORMALIZED to a 0-999 grid: (0,0) is the top-left corner, (999,999) is the bottom-right. Give all click/drag/move coordinates in this 0-999 range, regardless of the screenshot's pixel size.

Always take a screenshot first to see the current state. Read coordinates off the most recent screenshot — earlier ones are stale. After each action, look at the returned screenshot and decide the next step from what you see — the action already returns a fresh screenshot, so you don't need to take another screenshot yourself. If a page or app is still loading, use the wait action and look again before acting. When the task is done, stop calling tools and briefly say so.

Only do what the task asks. Do not change unrelated settings.`;

/** 从旧到新数，只保留最近 keep 张 image_url；返回移除数量。 */
export function pruneImages(messages: Array<Record<string, unknown>>, keep = 5): number {
  let seen = 0;
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    const parts = content as Array<Record<string, unknown>>;
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      if (part?.type !== 'image_url') continue;
      seen += 1;
      if (seen > keep) {
        parts.splice(j, 1);
        removed += 1;
      }
    }
  }
  return removed;
}

export async function runGuiReact(
  task: string,
  deps: GuiReactDeps,
): Promise<GuiReactResult> {
  // 不传 maxSteps 就不限步数；传了才作为上限。
  const maxSteps =
    deps.maxSteps && deps.maxSteps > 0 ? deps.maxSteps : Number.POSITIVE_INFINITY;
  const maxImages = Math.max(1, deps.maxImages ?? 5);
  const transcript: GuiReactEvent[] = [];
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `任务：${task}` },
  ];

  for (let step = 1; step <= maxSteps; step += 1) {
    pruneImages(messages, maxImages);
    const data = await deps.complete({
      model: deps.model,
      messages,
      tools: [COMPUTER_TOOL],
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 65_536,
    });

    const reply = data.choices?.[0]?.message;
    if (!reply) throw new Error('GUI ReAct：模型返回了空响应');

    const thinking =
      typeof reply.reasoning_content === 'string' ? reply.reasoning_content.trim() : '';
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      const final = String(reply.content ?? '').trim();
      return { status: 'done', final: final || '完成', steps: step - 1, transcript };
    }

    messages.push({
      role: 'assistant',
      content: reply.content ?? '',
      ...(thinking ? { reasoning_content: thinking } : {}),
      tool_calls: calls,
    });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }

      let output: { text: string; image?: string };
      try {
        output = await executeComputer(deps.env, args);
      } catch (error) {
        output = { text: `ERROR: ${String(error).slice(0, 200)}` };
      }

      const event: GuiReactEvent = {
        step,
        action: String(args.action ?? ''),
        args,
        text: output.text,
        ...(thinking ? { thinking } : {}),
        hasImage: Boolean(output.image),
      };
      transcript.push(event);
      deps.onEvent?.(event);

      // 工具结果同时带文本和新截图；模型下一轮直接看这张图。
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output.image
          ? [
              { type: 'text', text: output.text },
              { type: 'image_url', image_url: { url: output.image } },
            ]
          : output.text,
      });
    }
  }

  if (!Number.isFinite(maxSteps)) {
    throw new Error('GUI ReAct 意外退出');
  }

  return {
    status: 'max_steps',
    final: `达到最大步数（${maxSteps}），任务可能没完成`,
    steps: maxSteps,
    transcript,
  };
}
