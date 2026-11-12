import type { ChatReply, DemoState, Inspection, UtterancePlan } from '../shared/types';

export class MockBrain {
  inspectScreenshot(app: string, title: string): Inspection {
    return {
      app,
      title,
      activity: '（mock）暂时无法分析截图',
      testStatus: 'none',
      progress: 0,
      struggle: 0,
      evidence: [],
      confidence: 0,
    };
  }

  generatePlan(state: DemoState, event: string): UtterancePlan {
    if (event.includes('test-pass')) {
      return {
        say: true,
        displayText: `绿了！${state.file} 终于过了。`,
        speechText: `绿了！${state.file} 终于过了。`,
        emotion: 'celebrate',
        motion: 'celebrate',
        urgency: 'low',
        evidenceIds: ['test-pass'],
        reason: '测试从失败变为通过（mock）',
      };
    }

    if (event.includes('test-fail')) {
      return {
        say: true,
        displayText: `又红了。还是 ${state.file}，要不要先看最近一次报错？`,
        speechText: `又红了。还是 ${state.file}，要不要先看最近一次报错？`,
        emotion: 'comfort',
        motion: 'comfort',
        urgency: 'low',
        evidenceIds: ['test-fail'],
        reason: '测试失败（mock）',
      };
    }

    return {
      say: false,
      displayText: '',
      speechText: '',
      emotion: 'neutral',
      motion: 'idle',
      urgency: 'low',
      evidenceIds: [],
      reason: '没有值得打扰的事件（mock）',
    };
  }

  chat(state: DemoState, message: string): ChatReply {
    const lower = message.toLowerCase();

    if (lower.includes('测试') || lower.includes('test') || lower.includes('红')) {
      return {
        text: `现在 ${state.file} 是${state.testResult === 'pass' ? '绿的' : '红的'}。最近一次是 \`${state.testCommand}\`，你已经专注 ${state.focusMin} 分钟了。`,
        source: 'mock',
      };
    }

    if (lower.includes('状态') || lower.includes('干嘛') || lower.includes('在做什么')) {
      return {
        text: `你在 ${state.project} 的 ${state.file}，测试${
          state.testResult === 'pass' ? '刚过' : '还红着'
        }，已经专注 ${state.focusMin} 分钟。`,
        source: 'mock',
      };
    }

    if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello')) {
      return {
        text: '我在。你先忙，我不吵；需要的时候敲我一下。',
        source: 'mock',
      };
    }

    return {
      text: `我看到了：${state.project} / ${state.file}，测试${
        state.testResult === 'pass' ? '是绿的' : '还是红的'
      }。你想让我帮你看报错，还是先自己捋一下？`,
      source: 'mock',
    };
  }
}
