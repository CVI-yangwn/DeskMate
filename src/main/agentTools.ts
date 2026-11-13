import type { ToolDefinition } from './deepseek';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        '保存用户明确要求长期记住的事实、偏好、项目名或工作习惯。只在用户表达“记住/以后都/我的项目是”等长期信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要保存的简洁事实，最多 200 字' },
          kind: {
            type: 'string',
            enum: ['project', 'preference', 'fact'],
            description: 'project=项目/仓库，preference=偏好/习惯，fact=其他事实',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '搜索已经保存的长期记忆。回答用户关于偏好、项目或过去约定时先调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_activity',
      description:
        '查询用户过去一段时间（分钟）的活动时间线。用户问“我刚才/过去一小时/上午在干嘛”时先调用；如果 <memory> 里的时间线不够再调用。',
      parameters: {
        type: 'object',
        properties: {
          minutes: {
            type: 'number',
            description: '回溯多少分钟，默认 60，最多 1440',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_screen',
      description:
        '立即扫描当前屏幕，返回前台应用、窗口标题和用户正在做什么。只有需要最新屏幕上下文时才调用，不要频繁调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_dnd',
      description:
        '开启或关闭勿扰。用户说“别打扰/先安静一下/别说话”时开启；说“可以说话了/关闭勿扰”时关闭。',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true 为开启勿扰，false 为关闭' },
        },
        required: ['enabled'],
      },
    },
  },
];
