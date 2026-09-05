/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {matchesProcessName} from '../../../../src/modules/proxy/processMatch.js';

describe('matchesProcessName', () => {
  it('大小写不敏感的精确匹配', () => {
    assert.strictEqual(matchesProcessName('wechat.exe', 'WeChat.exe'), true);
    assert.strictEqual(matchesProcessName('WeChat.exe', 'wechat.EXE'), true);
    assert.strictEqual(
      matchesProcessName('wechat.exe', 'wechatapp.exe'),
      false,
    );
  });

  it('target 无扩展名时自动补 .exe', () => {
    assert.strictEqual(matchesProcessName('wechat', 'WeChat.exe'), true);
    assert.strictEqual(matchesProcessName('curl', 'curl.exe'), true);
  });

  it('带路径的 target 取 basename 后匹配', () => {
    assert.strictEqual(
      matchesProcessName(
        'C:\\Program Files\\Tencent\\WeChat.exe',
        'WeChat.exe',
      ),
      true,
    );
    assert.strictEqual(matchesProcessName('/usr/bin/curl', 'curl'), true);
  });

  it('name 带路径时也取 basename', () => {
    assert.strictEqual(
      matchesProcessName('WeChat.exe', 'C:\\x\\WeChat.exe'),
      true,
    );
  });

  it('空串不匹配', () => {
    assert.strictEqual(matchesProcessName('', 'WeChat.exe'), false);
    assert.strictEqual(matchesProcessName('wechat', ''), false);
  });
});
