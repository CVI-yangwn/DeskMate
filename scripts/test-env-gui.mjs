import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGuiEnabled } from '../src/main/gui/config.ts';

test('GUI 默认开启，只有显式关闭值才关闭', () => {
  for (const value of [undefined, '', '1', 'true', 'on', 'yes', ' TRUE ']) {
    assert.equal(parseGuiEnabled(value), true, String(value));
  }
  for (const value of ['0', 'false', 'off', 'no', ' FALSE ']) {
    assert.equal(parseGuiEnabled(value), false, String(value));
  }
});
