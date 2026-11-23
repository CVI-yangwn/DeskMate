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
        '查询用户过去一段时间（分钟）的活动时间线。用户问“我刚才/过去一小时/上午在干嘛”时先调用；如果 <memory> 里的时间线不够再调用。做周报时用 daysAgo 一天一天取（0=今天，1=昨天）。',
      parameters: {
        type: 'object',
        properties: {
          minutes: {
            type: 'number',
            description: '回溯多少分钟，默认 60，最多 1440',
          },
          daysAgo: {
            type: 'number',
            description: '从几天前开始看，0=今天，1=昨天；做周报时用 0..6，最多 14',
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
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '搜索个人 wiki（项目页、人物页、话题页）。回答“我之前说过/那个项目进展/某某是谁”时先用它；比 search_memory 更适合有上下文的长期知识。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词、项目名、人名' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_wiki_page',
      description:
        '读取一页个人 wiki 的完整内容（摘要、未完成事项、来源）。已知页面名时用；不确定先用 search_knowledge。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '页面名称或 id' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出可用的本地技能（名称、用途、触发场景）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'use_skill',
      description:
        '读取一个技能的完整步骤，然后按它执行。任务匹配技能（日结、调试时间线、会前准备、周报）时先调用；不要凭名字猜内容。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名称' },
        },
        required: ['name'],
      },
    },
  },
];

/**
 * 把整段 GUI ReAct 包成一个工具，交给现有 brain 调用。
 * 模型只看到“任务 -> 结果摘要”，中间的截图/动作在 gui/react.ts 内部循环。
 */
export const GUI_TASK_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gui_task',
    description:
      '在 macOS 桌面上看屏幕并完成一个任务（点击、输入、滚动、按键）。' +
      '当用户要求查看或操作某个可见界面时，直接调用本工具，不要先询问是否允许、是否需要转 GUI 或要不要操作。' +
      '只有目标不明确、或目标 App 没开且打不开时才先问。执行过程中会自动截图并逐步操作，直到完成。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '一句话描述要完成的事，例如“把计算器清零”或“在搜索框输入 hello”。',
        },
        maxSteps: {
          type: 'integer',
          description: '可选的最大步数；不填则不限步数。',
        },
      },
      required: ['task'],
    },
  },
};

export const WATCH_TASK_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'watch_task',
    description:
      '创建一个 GUI 观察任务：每隔一段时间看一次屏幕，判断条件是否成立；成立时执行一段 GUI 操作。' +
      '默认 shadow 模式（只记录、不动作），确认判断可靠后再显式设 shadow=false。',
    parameters: {
      type: 'object',
      properties: {
        condition: {
          type: 'string',
          description: '自然语言条件，例如“计算器显示区是否显示数字 7”。',
        },
        task: {
          type: 'string',
          description: '条件成立后要执行的操作，例如“点击计算器上的清除按钮，让显示区变成 0”。',
        },
        intervalSec: {
          type: 'integer',
          description: '检查间隔秒数，默认 60，最小 10。',
        },
        shadow: {
          type: 'boolean',
          description: 'true=只判断不动作（默认），false=命中后真的操作。',
        },
        once: {
          type: 'boolean',
          description: 'true=成功执行一次后停用（默认），false=持续观察。',
        },
      },
      required: ['condition', 'task'],
    },
  },
};

export const LIST_WATCHERS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_watchers',
    description: '列出当前的 GUI 观察任务（条件、间隔、影子模式、最近一次结果）。',
    parameters: { type: 'object', properties: {} },
  },
};

export const STOP_WATCHER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'stop_watcher',
    description: '按 id 停止并删除一个 GUI 观察任务。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'watch_task 返回的 id。' } },
      required: ['id'],
    },
  },
};
