import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WatcherStore } from '../src/main/gui/watcherStore.ts';
import { WatcherService } from '../src/main/gui/watcherService.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-watcher-'));
  return new WatcherStore(path.join(dir, 'watchers.json'));
}

test('WatcherStore：新增、持久化、重新加载', () => {
  const store = tempStore();
  const record = store.add({
    condition: '显示 7',
    task: '点清除',
    intervalMs: 60_000,
    shadow: true,
  });
  assert.match(record.id, /^w-/);
  assert.equal(record.enabled, true);
  assert.equal(record.shadow, true);

  const reloaded = new WatcherStore(store['file']);
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.get(record.id)?.condition, '显示 7');

  assert.equal(reloaded.remove(record.id), true);
  assert.equal(reloaded.list().length, 0);
});

test('WatcherService：命中后执行一次并自动停用', async () => {
  const store = tempStore();
  const record = store.add({
    condition: '显示 7',
    task: '点清除',
    intervalMs: 60_000,
    shadow: false,
    once: true,
  });
  store.update(record.id, { intervalMs: 60 });

  let actions = 0;
  const service = new WatcherService({
    store,
    check: async () => ({ match: true, evidence: '看到 7 了' }),
    act: async () => {
      actions += 1;
      return { status: 'done', final: '清成 0 了' };
    },
  });
  service.start();
  await sleep(250);
  service.stop();

  const after = store.get(record.id);
  assert.equal(actions, 1);
  assert.equal(after?.enabled, false);
  assert.equal(after?.lastResult, 'acted');
  assert.equal(after?.lastAction, '清成 0 了');
  assert.ok((after?.runs ?? 0) >= 1);
});

test('WatcherService：影子模式命中不动作，也不停用', async () => {
  const store = tempStore();
  const record = store.add({
    condition: '显示 7',
    task: '点清除',
    intervalMs: 60_000,
    shadow: true,
  });
  store.update(record.id, { intervalMs: 60 });

  let actions = 0;
  const service = new WatcherService({
    store,
    check: async () => ({ match: true, evidence: '看到 7 了' }),
    act: async () => {
      actions += 1;
      return { status: 'done', final: '' };
    },
  });
  service.start();
  await sleep(250);
  service.stop();

  const after = store.get(record.id);
  assert.equal(actions, 0);
  assert.equal(after?.lastResult, 'matched_shadow');
  assert.equal(after?.enabled, true);
});

test('WatcherService：条件不满足时继续观察', async () => {
  const store = tempStore();
  const record = store.add({
    condition: '显示 7',
    task: '点清除',
    intervalMs: 60_000,
    shadow: false,
  });
  store.update(record.id, { intervalMs: 60 });

  const service = new WatcherService({
    store,
    check: async () => ({ match: false, evidence: '没看到' }),
    act: async () => ({ status: 'done', final: '' }),
  });
  service.start();
  await sleep(250);
  service.stop();

  const after = store.get(record.id);
  assert.equal(after?.lastResult, 'no_match');
  assert.equal(after?.enabled, true);
  assert.ok((after?.runs ?? 0) >= 2);
});
