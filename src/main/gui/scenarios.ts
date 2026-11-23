import type { GuiAction, GuiStep, Rect, Risk } from './types.ts';

export interface ScenarioStep extends GuiStep {
  /** 真值框，只给评测用；执行环看不到它 */
  truth: Rect;
  /** 干扰框，模拟“看起来也像”的元素 */
  decoys: Rect[];
}

export interface Scenario {
  id: string;
  title: string;
  app: string;
  steps: ScenarioStep[];
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function step(
  id: string,
  instruction: string,
  action: GuiAction,
  truth: Rect,
  decoys: Rect[],
  risk: Risk,
  expect: string,
): ScenarioStep {
  return { id, instruction, action, risk, expect, truth, decoys };
}

/**
 * 20 条“简单、可见、可验证”的任务，覆盖：
 * 单步点击、输入、滚动、下拉选择、不可逆动作、两步/三步链。
 *
 * 坐标是归一化的，和具体分辨率无关；真值只用于评测，不进入 loop。
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 't01',
    title: '关闭弹窗',
    app: 'Finder',
    steps: [
      step(
        't01-s1',
        '点击右上角的关闭按钮',
        { type: 'click' },
        rect(0.945, 0.02, 0.035, 0.045),
        [rect(0.55, 0.68, 0.1, 0.05)],
        'safe',
        '弹窗消失，回到文档界面',
      ),
    ],
  },
  {
    id: 't02',
    title: '保存文档',
    app: 'TextEdit',
    steps: [
      step(
        't02-s1',
        '点击工具栏的保存按钮',
        { type: 'click' },
        rect(0.86, 0.93, 0.07, 0.045),
        [rect(0.74, 0.93, 0.1, 0.045)],
        'safe',
        '标题栏的未保存圆点消失',
      ),
    ],
  },
  {
    id: 't03',
    title: '重跑测试',
    app: 'VS Code',
    steps: [
      step(
        't03-s1',
        '点击测试面板里的“重新运行”',
        { type: 'click' },
        rect(0.62, 0.72, 0.09, 0.05),
        [rect(0.72, 0.72, 0.07, 0.05)],
        'safe',
        '测试状态变为 running',
      ),
    ],
  },
  {
    id: 't04',
    title: '搜索报错信息',
    app: 'Chrome',
    steps: [
      step(
        't04-s1',
        '点击页面顶部的搜索框',
        { type: 'click' },
        rect(0.25, 0.12, 0.3, 0.05),
        [rect(0.25, 0.18, 0.3, 0.05)],
        'safe',
        '搜索框获得焦点',
      ),
      step(
        't04-s2',
        '在搜索框里输入 CUDA out of memory',
        { type: 'type', text: 'CUDA out of memory' },
        rect(0.25, 0.12, 0.3, 0.05),
        [rect(0.25, 0.18, 0.3, 0.05)],
        'safe',
        '搜索框里出现这段文字',
      ),
    ],
  },
  {
    id: 't05',
    title: '切到终端标签',
    app: 'VS Code',
    steps: [
      step(
        't05-s1',
        '点击底部面板的“终端”标签',
        { type: 'click' },
        rect(0.18, 0.06, 0.09, 0.04),
        [rect(0.28, 0.06, 0.08, 0.04)],
        'safe',
        '终端面板显示出来',
      ),
    ],
  },
  {
    id: 't06',
    title: '允许屏幕录制权限',
    app: 'System Settings',
    steps: [
      step(
        't06-s1',
        '点击权限弹窗里的“允许”',
        { type: 'click' },
        rect(0.58, 0.62, 0.1, 0.05),
        [rect(0.7, 0.62, 0.1, 0.05)],
        'safe',
        '弹窗关闭，开关变为打开',
      ),
    ],
  },
  {
    id: 't07',
    title: '暂停训练',
    app: 'Terminal',
    steps: [
      step(
        't07-s1',
        '点击监控面板的“暂停”',
        { type: 'click' },
        rect(0.72, 0.2, 0.08, 0.045),
        [rect(0.81, 0.2, 0.08, 0.045)],
        'safe',
        '状态从 running 变为 paused',
      ),
    ],
  },
  {
    id: 't08',
    title: '恢复训练',
    app: 'Terminal',
    steps: [
      step(
        't08-s1',
        '点击监控面板的“继续”',
        { type: 'click' },
        rect(0.81, 0.2, 0.08, 0.045),
        [rect(0.72, 0.2, 0.08, 0.045)],
        'safe',
        '状态从 paused 变为 running',
      ),
    ],
  },
  {
    id: 't09',
    title: '导出日志',
    app: 'VS Code',
    steps: [
      step(
        't09-s1',
        '点击日志面板的“导出”',
        { type: 'click' },
        rect(0.7, 0.9, 0.08, 0.045),
        [rect(0.6, 0.9, 0.08, 0.045)],
        'safe',
        '出现保存文件对话框',
      ),
    ],
  },
  {
    id: 't10',
    title: '删除旧构建并确认',
    app: 'Finder',
    steps: [
      step(
        't10-s1',
        '右键菜单里点击“删除”',
        { type: 'click' },
        rect(0.55, 0.78, 0.1, 0.05),
        [rect(0.67, 0.78, 0.1, 0.05)],
        'irreversible',
        '出现确认删除的弹窗',
      ),
      step(
        't10-s2',
        '在确认弹窗里点击“删除”',
        { type: 'click' },
        rect(0.6, 0.6, 0.1, 0.05),
        [rect(0.48, 0.6, 0.1, 0.05)],
        'irreversible',
        '弹窗消失，文件从列表移除',
      ),
    ],
  },
  {
    id: 't11',
    title: '滚动到日志底部',
    app: 'VS Code',
    steps: [
      step(
        't11-s1',
        '在日志区域向下滚动',
        { type: 'scroll', amount: 10 },
        rect(0.4, 0.5, 0.2, 0.2),
        [rect(0.05, 0.3, 0.15, 0.4)],
        'safe',
        '日志滚动到最后一行',
      ),
    ],
  },
  {
    id: 't12',
    title: '打开通知中心',
    app: 'macOS',
    steps: [
      step(
        't12-s1',
        '点击菜单栏右上角的通知图标',
        { type: 'click' },
        rect(0.97, 0.02, 0.025, 0.04),
        [rect(0.9, 0.02, 0.03, 0.04)],
        'safe',
        '通知中心面板展开',
      ),
    ],
  },
  {
    id: 't13',
    title: '关闭当前标签页',
    app: 'Chrome',
    steps: [
      step(
        't13-s1',
        '点击当前标签页上的关闭小叉',
        { type: 'click' },
        rect(0.28, 0.055, 0.015, 0.025),
        [rect(0.31, 0.055, 0.02, 0.025)],
        'safe',
        '标签页关闭，切换到相邻标签',
      ),
    ],
  },
  {
    id: 't14',
    title: '切换 Python 解释器',
    app: 'VS Code',
    steps: [
      step(
        't14-s1',
        '点击状态栏的 Python 解释器',
        { type: 'click' },
        rect(0.08, 0.93, 0.12, 0.04),
        [rect(0.22, 0.93, 0.1, 0.04)],
        'safe',
        '屏幕顶部出现解释器列表',
      ),
      step(
        't14-s2',
        '在列表里选择 Python 3.12',
        { type: 'click' },
        rect(0.12, 0.72, 0.14, 0.04),
        [rect(0.12, 0.78, 0.14, 0.04)],
        'safe',
        '状态栏显示 Python 3.12',
      ),
    ],
  },
  {
    id: 't15',
    title: '刷新页面',
    app: 'Chrome',
    steps: [
      step(
        't15-s1',
        '点击地址栏左边的刷新按钮',
        { type: 'click' },
        rect(0.88, 0.12, 0.04, 0.04),
        [rect(0.82, 0.12, 0.04, 0.04)],
        'safe',
        '页面开始重新加载',
      ),
    ],
  },
  {
    id: 't16',
    title: '复制报错信息',
    app: 'Terminal',
    steps: [
      step(
        't16-s1',
        '点击报错浮层上的“复制”',
        { type: 'click' },
        rect(0.45, 0.35, 0.05, 0.03),
        [rect(0.52, 0.35, 0.05, 0.03)],
        'safe',
        '按钮文字变为“已复制”',
      ),
    ],
  },
  {
    id: 't17',
    title: '打开设置',
    app: 'VS Code',
    steps: [
      step(
        't17-s1',
        '点击左下角的齿轮设置图标',
        { type: 'click' },
        rect(0.93, 0.06, 0.03, 0.035),
        [rect(0.88, 0.06, 0.03, 0.035)],
        'safe',
        '设置面板打开',
      ),
    ],
  },
  {
    id: 't18',
    title: '打开自动保存',
    app: 'VS Code',
    steps: [
      step(
        't18-s1',
        '点击设置里的“自动保存”复选框',
        { type: 'click' },
        rect(0.72, 0.66, 0.025, 0.03),
        [rect(0.76, 0.66, 0.03, 0.03)],
        'safe',
        '复选框出现勾选状态',
      ),
    ],
  },
  {
    id: 't19',
    title: '导出时填写文件名',
    app: 'VS Code',
    steps: [
      step(
        't19-s1',
        '点击保存对话框的文件名输入框',
        { type: 'click' },
        rect(0.5, 0.55, 0.25, 0.05),
        [rect(0.5, 0.62, 0.25, 0.05)],
        'safe',
        '输入框获得焦点',
      ),
      step(
        't19-s2',
        '输入 run-1123.log',
        { type: 'type', text: 'run-1123.log' },
        rect(0.5, 0.55, 0.25, 0.05),
        [rect(0.5, 0.62, 0.25, 0.05)],
        'safe',
        '输入框里出现 run-1123.log',
      ),
    ],
  },
  {
    id: 't20',
    title: '重启 Notebook 内核',
    app: 'Jupyter',
    steps: [
      step(
        't20-s1',
        '点击菜单栏的“内核”',
        { type: 'click' },
        rect(0.24, 0.16, 0.08, 0.04),
        [rect(0.34, 0.16, 0.06, 0.04)],
        'safe',
        '内核菜单展开',
      ),
      step(
        't20-s2',
        '点击菜单里的“重启内核”',
        { type: 'click' },
        rect(0.3, 0.22, 0.1, 0.04),
        [rect(0.3, 0.28, 0.1, 0.04)],
        'irreversible',
        '出现确认重启的弹窗',
      ),
      step(
        't20-s3',
        '在确认弹窗里点击“重启”',
        { type: 'click' },
        rect(0.6, 0.6, 0.1, 0.05),
        [rect(0.48, 0.6, 0.1, 0.05)],
        'irreversible',
        '内核状态变为 restarting',
      ),
    ],
  },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
