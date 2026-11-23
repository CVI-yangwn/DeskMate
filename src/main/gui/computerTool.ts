import type { ToolDefinition } from '../deepseek';
import type { GuiEnvironment } from './environment';

/**
 * 一个统一的 computer 工具，动作集合对齐 ernie_agent 的 computer_use：
 * screenshot / click / type / press_key / hotkey / scroll / wait。
 *
 * 描述里明确写了“动作后自动返回新截图”，这样模型不会多调一次 screenshot。
 */
export const COMPUTER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'computer',
    description:
      '操作 macOS 桌面。动作执行后会自动截一张新图并一起返回，直接看返回的截图决定下一步，不需要再调 screenshot。' +
      '坐标使用 0..999：左上角 (0,0)，右下角 (999,999)；不要假设屏幕分辨率。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'click', 'move', 'drag', 'type', 'press_key', 'hotkey', 'scroll', 'wait'],
          description:
            'screenshot=看当前屏幕；click=点击（可右键/中键/双击）；move=只移动/悬停；drag=拖拽；type=输入文字；press_key=按单个键；hotkey=组合键；scroll=滚动；wait=等待加载。',
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'click/move/scroll 的目标点，drag 的终点；[x, y]，0..999。',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'click 的鼠标键，默认 left。',
        },
        num_clicks: {
          type: 'integer',
          enum: [1, 2, 3],
          description: 'click 次数：1=单击，2=双击，3=三击。默认 1。',
        },
        start_coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'drag 的起点 [x, y]，0..999。',
        },
        text: { type: 'string', description: 'type 要输入的文字。' },
        key: { type: 'string', description: 'press_key 的单个键，例如 return、esc、tab。' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'hotkey 的组合键，例如 ["cmd", "s"]。',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'scroll 方向，默认 down。',
        },
        amount: { type: 'integer', description: 'scroll 格数，默认 3。' },
        duration: { type: 'number', description: 'wait 秒数，默认 1。' },
      },
      required: ['action'],
    },
  },
};

const ACTIONS = new Set(['screenshot', 'click', 'move', 'drag', 'type', 'press_key', 'hotkey', 'scroll', 'wait']);

export interface ComputerOutput {
  text: string;
  image?: string;
}

export async function executeComputer(
  env: GuiEnvironment,
  args: Record<string, unknown>,
): Promise<ComputerOutput> {
  const action = String(args.action ?? '');
  if (!ACTIONS.has(action)) {
    return { text: `ERROR: 不支持的动作 ${action || '(空)'}` };
  }
  const result = await env.executeAndObserve(action, args);
  const text = result.success ? result.message : `ERROR: ${result.error ?? result.message}`;
  return { text, image: result.observation?.screenshot };
}
