import assert from 'node:assert/strict';
import test from 'node:test';
import { containsSensitive, redactSensitive } from '../src/main/redact.ts';

test('脱敏常见密钥、邮箱、手机号、证件与私钥', () => {
  const input = [
    'key sk-abcdefghijklmnopqrstuvwxyz123456',
    'AKIAABCDEFGHIJKLMNOP',
    'mail alice@example.com',
    'phone 13800138000',
    'id 11010519491231002X',
    'card 4111 1111 1111 1111',
    '-----BEGIN RSA PRIVATE KEY-----',
    'secret',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const output = redactSensitive(input);
  assert.equal(output.includes('sk-abcdefghijklmnop'), false);
  assert.equal(output.includes('AKIAABCDEFGHIJKLMNOP'), false);
  assert.equal(output.includes('alice@example.com'), false);
  assert.equal(output.includes('13800138000'), false);
  assert.equal(output.includes('11010519491231002X'), false);
  assert.equal(output.includes('4111 1111 1111 1111'), false);
  assert.equal(output.includes('secret'), false);
  assert.equal(containsSensitive(output), false);
});

test('普通中文与技术文本不被误伤', () => {
  const input = '今天在 Xcode 修 auth 校验，测试从 3 failed 变成 pass，耗时 45 分钟。';
  assert.equal(redactSensitive(input), input);
  assert.equal(containsSensitive(input), false);
});
