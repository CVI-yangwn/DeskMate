import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalMacEnvironment, toPixels } from '../src/main/gui/environment.ts';
import { executeComputer } from '../src/main/gui/computerTool.ts';
import { pruneImages, runGuiReact } from '../src/main/gui/react.ts';

const observation = (screenshot = 'data:image/jpeg;base64,AAA') => ({
  screenshot,
  width: 1280,
  height: 800,
  screenWidth: 1000,
  screenHeight: 500,
  app: 'Test',
  title: 'Test',
});

function makeEnv(overrides = {}) {
  const calls = [];
  const env = new LocalMacEnvironment({
    capture: async () => observation(),
    act: async (action, params) => {
      calls.push({ action, params });
      return { success: true, message: `${action} ok` };
    },
    wait: async () => {},
    ...overrides,
  });
  return { env, calls };
}

test('0..999 映射到像素：两端与中点', () => {
  assert.equal(toPixels(0, 1000), 0);
  assert.equal(toPixels(999, 1000), 999);
  assert.equal(toPixels(500, 1000), 500);
  assert.equal(toPixels(500, 500), Math.round((500 / 999) * 499));
  assert.equal(toPixels(-10, 1000), 0);
  assert.equal(toPixels(2000, 1000), 999);
});

test('click 把 0..999 转成真实像素，再交给 act', async () => {
  const { env, calls } = makeEnv();
  await env.observe();
  await env.execute('click', { coordinate: [500, 500] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'click');
  assert.equal(calls[0].params.x, 500);
  assert.equal(calls[0].params.y, Math.round((500 / 999) * 499));
});

test('scroll 方向映射成 dy：down 为负、up 为正', async () => {
  const { env, calls } = makeEnv();
  await env.observe();
  await env.execute('scroll', { direction: 'down', amount: 3, coordinate: [10, 20] });
  await env.execute('scroll', { direction: 'up', amount: 5 });
  assert.equal(calls[0].params.dy, -3);
  assert.equal(calls[0].params.x, Math.round((10 / 999) * 999));
  assert.equal(calls[1].params.dy, 5);
});

test('executeAndObserve 返回动作结果 + 新截图', async () => {
  const { env } = makeEnv();
  const result = await env.executeAndObserve('click', { coordinate: [1, 1] });
  assert.equal(result.success, true);
  assert.equal(result.observation?.screenshot, 'data:image/jpeg;base64,AAA');
  assert.equal(result.observation?.screenWidth, 1000);
});

test('computer 工具：未知动作直接报错，screenshot 返回图片', async () => {
  const { env } = makeEnv();
  const bad = await executeComputer(env, { action: 'jump' });
  assert.match(bad.text, /^ERROR/);
  const shot = await executeComputer(env, { action: 'screenshot' });
  assert.equal(shot.image, 'data:image/jpeg;base64,AAA');
});

test('ReAct：工具调用 -> 带图结果 -> 模型收尾', async () => {
  const { env, calls } = makeEnv();
  const bodies = [];
  const replies = [
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'computer', arguments: '{"action":"click","coordinate":[100,200]}' },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: '已经点好了' } }] },
  ];
  const result = await runGuiReact('点击目标', {
    env,
    model: 'test-model',
    maxSteps: 3,
    complete: async (body) => {
      bodies.push(body);
      return replies[bodies.length - 1];
    },
  });

  assert.equal(result.status, 'done');
  assert.equal(result.final, '已经点好了');
  assert.equal(result.steps, 1);
  assert.equal(result.transcript.length, 1);
  assert.equal(calls[0].action, 'click');

  const toolMessage = bodies[1].messages.find((message) => message.role === 'tool');
  assert.ok(Array.isArray(toolMessage.content));
  assert.equal(toolMessage.content[1].type, 'image_url');
  assert.match(toolMessage.content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('ReAct：一直调工具会在 maxSteps 停止', async () => {
  const { env } = makeEnv();
  const result = await runGuiReact('停不下来', {
    env,
    model: 'test-model',
    maxSteps: 2,
    complete: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'x', type: 'function', function: { name: 'computer', arguments: '{"action":"screenshot"}' } },
            ],
          },
        },
      ],
    }),
  });
  assert.equal(result.status, 'max_steps');
  assert.equal(result.steps, 2);
});

test('ReAct：动作失败时仍把最后截图交给模型', async () => {
  const { env } = makeEnv({
    act: async () => ({ success: false, message: 'nope', error: 'exec-failed' }),
  });
  let secondBody = null;
  const result = await runGuiReact('失败一次', {
    env,
    model: 'test-model',
    maxSteps: 2,
    complete: async (body) => {
      if (!secondBody) {
        secondBody = body;
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { id: 'e', type: 'function', function: { name: 'computer', arguments: '{"action":"click","coordinate":[1,1]}' } },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: '失败，停止' } }] };
    },
  });
  const toolMessage = secondBody.messages.find((message) => message.role === 'tool');
  assert.match(toolMessage.content[0].text, /^ERROR/);
  assert.equal(toolMessage.content[1].type, 'image_url');
  assert.equal(result.status, 'done');
});

test('watcher：第二次命中才动作，动作只执行一次', async () => {
  const { runWatcher } = await import('../src/main/gui/watcher.ts');
  let checks = 0;
  let actions = 0;
  const result = await runWatcher({
    check: async () => {
      checks += 1;
      return { match: checks === 2, evidence: `check ${checks}` };
    },
    act: async () => {
      actions += 1;
      return { status: 'done', final: '清掉了' };
    },
    sleep: async () => {},
    intervalMs: 1,
    maxChecks: 5,
  });
  assert.equal(result.status, 'acted');
  assert.equal(result.checks, 2);
  assert.equal(actions, 1);
  assert.equal(result.action?.final, '清掉了');
});

test('watcher：一直不满足就 no_match，不动作', async () => {
  const { runWatcher } = await import('../src/main/gui/watcher.ts');
  let actions = 0;
  const result = await runWatcher({
    check: async () => ({ match: false, evidence: '没看到' }),
    act: async () => {
      actions += 1;
      return { status: 'done', final: '' };
    },
    sleep: async () => {},
    maxChecks: 3,
  });
  assert.equal(result.status, 'no_match');
  assert.equal(result.checks, 3);
  assert.equal(actions, 0);
});

test('watcher：影子模式命中也不动作', async () => {
  const { runWatcher } = await import('../src/main/gui/watcher.ts');
  let actions = 0;
  const result = await runWatcher({
    check: async () => ({ match: true, evidence: '看到了 7' }),
    act: async () => {
      actions += 1;
      return { status: 'done', final: '' };
    },
    sleep: async () => {},
    shadow: true,
  });
  assert.equal(result.status, 'matched_shadow');
  assert.equal(actions, 0);
});

test('ReAct：不传 maxSteps 时不限制步数（25 步也能走完）', async () => {
  const { env } = makeEnv();
  let calls = 0;
  const result = await runGuiReact('走 25 步', {
    env,
    model: 'test-model',
    complete: async () => {
      calls += 1;
      if (calls <= 25) {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `c${calls}`,
                    type: 'function',
                    function: { name: 'computer', arguments: '{"action":"screenshot"}' },
                  },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: 'done' } }] };
    },
  });
  assert.equal(result.status, 'done');
  assert.equal(result.steps, 25);
});

test('move：只移动鼠标，不点击，坐标按 0..999 映射', async () => {
  const { env, calls } = makeEnv();
  await env.observe();
  await env.execute('move', { coordinate: [100, 200] });
  assert.equal(calls[0].action, 'move');
  assert.equal(calls[0].params.x, 100);
  assert.equal(calls[0].params.y, Math.round((200 / 999) * 499));

  const output = await executeComputer(env, { action: 'move', coordinate: [10, 20] });
  assert.match(output.text, /move/i);
});

test('click 支持右键/双击参数，drag 映射起点与终点', async () => {
  const { env, calls } = makeEnv();
  await env.observe();

  await env.execute('click', { coordinate: [500, 500], button: 'right', num_clicks: 2 });
  assert.equal(calls[0].params.button, 'right');
  assert.equal(calls[0].params.num_clicks, 2);

  await env.execute('drag', {
    start_coordinate: [100, 200],
    coordinate: [800, 600],
  });
  const drag = calls[1].params;
  assert.equal(drag.x1, 100);
  assert.equal(drag.y1, Math.round((200 / 999) * 499));
  assert.equal(drag.x2, 800);
  assert.equal(drag.y2, Math.round((600 / 999) * 499));

  const output = await executeComputer(env, {
    action: 'drag',
    start_coordinate: [10, 10],
    coordinate: [20, 20],
  });
  assert.match(output.text, /drag/i);
});


test('pruneImages：只保留最近 5 张，动作文本不丢', () => {
  const messages = Array.from({ length: 7 }, (_, index) => ({
    role: 'tool',
    content: [
      { type: 'text', text: `动作 ${index}` },
      { type: 'image_url', image_url: { url: `u${index}` } },
    ],
  }));
  const removed = pruneImages(messages, 5);
  assert.equal(removed, 2);
  const urls = messages.flatMap((message) =>
    message.content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url),
  );
  assert.deepEqual(urls, ['u2', 'u3', 'u4', 'u5', 'u6']);
  assert.equal(messages[0].content.length, 1);
  assert.match(messages[0].content[0].text, /动作 0/);
});

test('ReAct：消息里最多保留 5 张截图', async () => {
  const { env } = makeEnv();
  const counts = [];
  let calls = 0;
  const result = await runGuiReact('连续截图 8 次', {
    env,
    model: 'test-model',
    complete: async (body) => {
      const count = body.messages.reduce(
        (sum, message) =>
          sum +
          (Array.isArray(message.content)
            ? message.content.filter((part) => part.type === 'image_url').length
            : 0),
        0,
      );
      counts.push(count);
      calls += 1;
      if (calls <= 8) {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `c${calls}`,
                    type: 'function',
                    function: { name: 'computer', arguments: '{"action":"screenshot"}' },
                  },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: 'done' } }] };
    },
  });
  assert.equal(result.status, 'done');
  assert.ok(counts.every((count) => count <= 5), JSON.stringify(counts));
  assert.equal(Math.max(...counts), 5);
});

test('ReAct：thinking 保留在 transcript 和 assistant 消息里', async () => {
  const { env } = makeEnv();
  const bodies = [];
  let calls = 0;
  const result = await runGuiReact('看看屏幕', {
    env,
    model: 'test-model',
    complete: async (body) => {
      bodies.push(body);
      calls += 1;
      if (calls === 1) {
        return {
          choices: [
            {
              message: {
                content: '',
                reasoning_content: '先截一张屏看看',
                tool_calls: [
                  {
                    id: 'a',
                    type: 'function',
                    function: { name: 'computer', arguments: '{"action":"screenshot"}' },
                  },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: '看完了', reasoning_content: '确认是桌面' } }] };
    },
  });
  assert.equal(result.status, 'done');
  assert.equal(result.transcript[0].thinking, '先截一张屏看看');
  const assistant = bodies[1].messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.reasoning_content, '先截一张屏看看');
});

test('pruneImages 只删图片，不动 thinking 和动作文本', () => {
  const messages = [
    { role: 'assistant', content: '', reasoning_content: 'think-keep', tool_calls: [] },
    ...Array.from({ length: 7 }, (_, index) => ({
      role: 'tool',
      content: [
        { type: 'text', text: `动作 ${index}` },
        { type: 'image_url', image_url: { url: `u${index}` } },
      ],
    })),
  ];
  pruneImages(messages, 5);
  assert.equal(messages[0].reasoning_content, 'think-keep');
  assert.equal(messages[1].content[0].text, '动作 0');
  assert.equal(messages[1].content.length, 1);
  assert.equal(messages[3].content[1].type, 'image_url');
  const images = messages.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'image_url')
      : [],
  );
  assert.equal(images.length, 5);
});

test('GUI 内层 system 采用 ernie 的 ## Screen 结构', async () => {
  const { env } = makeEnv();
  let system = '';
  const result = await runGuiReact('看一眼屏幕', {
    env,
    model: 'test-model',
    complete: async (body) => {
      system = String(body.messages[0]?.content ?? '');
      return { choices: [{ message: { content: 'ok' } }] };
    },
  });
  assert.equal(result.status, 'done');
  assert.match(system, /## Screen/);
  assert.match(system, /0-999/);
  assert.match(system, /top-left/);
  assert.match(system, /stop calling tools/);
  assert.doesNotMatch(system, /1440x900/);
});
