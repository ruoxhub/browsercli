/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  MitmRuleEngine,
  matchesPredicate,
} from '../../../../src/modules/proxy/rewrite.js';
import type {MitmRewriteRule} from '../../../../src/modules/proxy/types.js';

function view(overrides: Partial<Parameters<typeof matchesPredicate>[1]> = {}) {
  return {
    method: 'POST',
    url: 'https://api.example.com/v1/login',
    headers: {'content-type': 'application/json', 'x-token': 'abc123'},
    requestBody: '{"user":"a"}',
    responseBody: '{"ok":true}',
    statusCode: 200,
    ...overrides,
  };
}

describe('matchesPredicate', () => {
  it('命中 method/urlFilter/host/headerContains/bodyContains 的 AND 组合', () => {
    assert.strictEqual(matchesPredicate({method: 'POST'}, view()), true);
    assert.strictEqual(matchesPredicate({method: 'get'}, view()), false);
    assert.strictEqual(
      matchesPredicate({urlFilter: 'api.example.com'}, view()),
      true,
    );
    assert.strictEqual(matchesPredicate({host: 'example'}, view()), true);
    assert.strictEqual(
      matchesPredicate(
        {headerContains: {name: 'X-Token', value: 'abc'}},
        view(),
      ),
      true,
    );
    assert.strictEqual(matchesPredicate({bodyContains: '"ok"'}, view()), true);
    assert.strictEqual(
      matchesPredicate({method: 'POST', urlFilter: 'other'}, view()),
      false,
    );
  });

  it('statusCode 精确匹配（list 过滤用）', () => {
    assert.strictEqual(matchesPredicate({statusCode: 200}, view()), true);
    assert.strictEqual(matchesPredicate({statusCode: 404}, view()), false);
  });

  it('urlRegex 非法正则视为不命中', () => {
    assert.strictEqual(matchesPredicate({urlRegex: '['}, view()), false);
    assert.strictEqual(matchesPredicate({urlRegex: 'login$'}, view()), true);
  });

  it('filter 支持 mitmproxy 流过滤表达式', () => {
    assert.strictEqual(
      matchesPredicate({filter: '~m POST & ~c 200'}, view()),
      true,
    );
    assert.strictEqual(
      matchesPredicate({filter: '~m GET | ~c 404'}, view()),
      false,
    );
    assert.strictEqual(
      matchesPredicate({filter: '!~a ~d api.example.com'}, view()),
      true,
    );
  });
});

function rule(
  id: string,
  action: MitmRewriteRule['action'],
  pred: Partial<MitmRewriteRule> = {},
): MitmRewriteRule {
  return {id, action, enabled: true, ...pred};
}

function req() {
  return {
    method: 'POST',
    url: 'https://api.example.com/v1/login',
    headers: {'content-type': 'application/json', host: 'api.example.com'},
    body: Buffer.from('{"user":"a"}', 'utf-8'),
  };
}

describe('MitmRuleEngine', () => {
  it('block 规则 terminal 短路', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('b1', {type: 'block', statusCode: 403}, {urlFilter: 'api.example'}),
    );
    const result = engine.beforeRequest(req());
    assert.ok(result);
    assert.strictEqual(result.action, 'block');
    assert.strictEqual(result.statusCode, 403);
    assert.deepStrictEqual(result.appliedRuleIds, ['b1']);
  });

  it('map_local 命中短路返回本地文件，文件缺失则继续', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'maplocal-'));
    const file = path.join(dir, 'mock.js');
    writeFileSync(file, 'MOCK', 'utf-8');
    try {
      const engine = new MitmRuleEngine();
      engine.addRule(
        rule('m1', {
          type: 'map_local',
          urlRegex: '/v1/login',
          localPath: file,
          contentType: 'text/plain',
        }),
      );
      const result = engine.beforeRequest(req());
      assert.ok(result);
      assert.strictEqual(result.action, 'respond');
      const respond = result as Extract<typeof result, {action: 'respond'}>;
      assert.strictEqual(respond.body.toString(), 'MOCK');
      assert.strictEqual(respond.headers?.['content-type'], 'text/plain');
    } finally {
      // 无需清理，临时目录遗留无害
    }

    const engine2 = new MitmRuleEngine();
    engine2.addRule(
      rule('m2', {
        type: 'map_local',
        urlRegex: '/v1/login',
        localPath: path.join(dir, 'missing.js'),
      }),
    );
    // 文件缺失：不命中，返回 undefined
    assert.strictEqual(engine2.beforeRequest(req()), undefined);
  });

  it('modify_header(request) 返回 forward + header 增量', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('h1', {
        type: 'modify_header',
        phase: 'request',
        set: {'x-hook': '1'},
        remove: ['content-type'],
      }),
    );
    const result = engine.beforeRequest(req());
    assert.ok(result);
    assert.strictEqual(result.action, 'forward');
    const fwd = result as Extract<typeof result, {action: 'forward'}>;
    assert.strictEqual(fwd.modification?.setHeaders?.['x-hook'], '1');
    assert.ok(fwd.modification?.removeHeaders?.includes('content-type'));
  });

  it('modify_body(request) 字面替换 → forward 携带新 body', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('b1', {
        type: 'modify_body',
        phase: 'request',
        find: '"user"',
        replace: '"u"',
      }),
    );
    const result = engine.beforeRequest(req());
    assert.ok(result);
    assert.strictEqual(result.action, 'forward');
    const fwd = result as Extract<typeof result, {action: 'forward'}>;
    assert.strictEqual(fwd.modification?.body?.toString(), '{"u":"a"}');
  });

  it('afterResponse modify_body(response) 改写响应体', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('r1', {
        type: 'modify_body',
        phase: 'response',
        find: 'ok',
        replace: 'OK',
      }),
    );
    const result = engine.afterResponse({
      requestId: 'r',
      method: 'GET',
      url: 'https://x.dev',
      requestHeaders: {},
      requestBody: null,
      statusCode: 200,
      headers: {'content-type': 'application/json'},
      body: Buffer.from('{"ok":true}', 'utf-8'),
      truncated: false,
    });
    assert.ok(result);
    assert.strictEqual(result.action, 'forward');
    const fwd = result as Extract<typeof result, {action: 'forward'}>;
    assert.strictEqual(fwd.modification?.body?.toString(), '{"OK":true}');
  });

  it('hasResponseBodyRules 只对 response-phase modify_body 为 true', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('a', {
        type: 'modify_body',
        phase: 'request',
        find: 'x',
        replace: 'y',
      }),
    );
    assert.strictEqual(engine.hasResponseBodyRules(), false);
    engine.addRule(
      rule('b', {
        type: 'modify_body',
        phase: 'response',
        find: 'x',
        replace: 'y',
      }),
    );
    assert.strictEqual(engine.hasResponseBodyRules(), true);
  });

  it('addRule 同 id 覆盖、removeRule/clearRules 生效', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(rule('a', {type: 'block', statusCode: 403}));
    engine.addRule(rule('a', {type: 'block', statusCode: 404}));
    assert.strictEqual(engine.listRules().length, 1);
    const first = engine.listRules()[0]!;
    assert.strictEqual(first.action.type, 'block');
    assert.strictEqual(
      (first.action as Extract<typeof first.action, {type: 'block'}>)
        .statusCode,
      404,
    );

    assert.strictEqual(engine.removeRule('a'), true);
    assert.strictEqual(engine.removeRule('a'), false);
    engine.addRule(rule('b', {type: 'block', statusCode: 403}));
    assert.strictEqual(engine.clearRules(), 1);
  });

  it('map_remote 改 url 生成 forward + url 增量', () => {
    const engine = new MitmRuleEngine();
    engine.addRule(
      rule('rr', {
        type: 'map_remote',
        urlRegex: 'https://api.example.com(.*)',
        replacement: 'https://api.staging.com$1',
      }),
    );
    const result = engine.beforeRequest(req());
    assert.ok(result);
    assert.strictEqual(result.action, 'forward');
    const fwd = result as Extract<typeof result, {action: 'forward'}>;
    assert.strictEqual(
      fwd.modification?.url,
      'https://api.staging.com/v1/login',
    );
  });
});
