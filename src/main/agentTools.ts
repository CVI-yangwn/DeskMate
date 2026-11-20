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
