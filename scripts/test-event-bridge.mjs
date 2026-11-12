import assert from 'node:assert/strict';
import test from 'node:test';
import { startEventBridge } from '../src/main/eventBridge.ts';

test('event bridge accepts local JSON events and rejects unsafe requests', async () => {
  const calls = [];
  const bridge = await startEventBridge({
    port: 0,
    onTestResult: async (result) => {
      calls.push(result);
      return { ok: true, result };
    },
  });
  const base = `http://127.0.0.1:${bridge.port}`;

  const request = async (path, init = {}) => {
    const response = await fetch(base + path, {
      ...init,
      headers: { connection: 'close', ...(init.headers ?? {}) },
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    assert.deepEqual(await request('/health'), { status: 200, body: { ok: true } });

    const plainText = await request('/event', {
      method: 'POST',
      body: JSON.stringify({ type: 'test.result', result: 'pass' }),
    });
    assert.equal(plainText.status, 415);

    const foreignOrigin = await request('/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ type: 'test.result', result: 'pass' }),
    });
    assert.equal(foreignOrigin.status, 403);

    const invalidBody = await request('/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(invalidBody.status, 400);

    const accepted = await request('/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'test.result', result: 'fail' }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls, ['fail']);
  } finally {
    await bridge.close();
  }
});
