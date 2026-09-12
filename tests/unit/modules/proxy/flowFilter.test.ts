/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  compileFlowFilter,
  matchesFlowFilter,
  type FilterableFlow,
} from '../../../../src/modules/proxy/flowFilter.js';

describe('flowFilter', () => {
  const baseFlow: FilterableFlow = {
    url: 'https://api.example.com/v1/users?page=1',
    method: 'GET',
    statusCode: 200,
    contentType: 'application/json; charset=utf-8',
    requestHeaders: {
      Host: 'api.example.com',
      Authorization: 'Bearer token123',
      'User-Agent': 'TestClient/1.0',
    },
    responseHeaders: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Server': 'nginx/1.24',
    },
    requestBody: '{"query":"active"}',
    responseBody: '{"users":[{"id":1,"name":"Alice"}]}',
    isStatic: false,
    isWebSocket: false,
    clientProcess: {
      pid: 1234,
      name: 'node.exe',
      path: 'C:\\Program Files\\nodejs\\node.exe',
    },
  };

  const assetFlow: FilterableFlow = {
    url: 'https://cdn.example.com/static/app.bundle.js',
    method: 'GET',
    statusCode: 200,
    contentType: 'application/javascript',
    requestHeaders: {Host: 'cdn.example.com'},
    responseHeaders: {'Content-Type': 'application/javascript'},
    isStatic: true,
    isWebSocket: false,
  };

  const errorFlow: FilterableFlow = {
    url: 'https://api.example.com/v1/login',
    method: 'POST',
    statusCode: 500,
    contentType: 'application/json',
    requestHeaders: {Host: 'api.example.com'},
    responseHeaders: {'Content-Type': 'application/json'},
    requestBody: '{"user":"admin","pass":"123456"}',
    responseBody: '{"error":"Internal Server Error"}',
    isStatic: false,
    isWebSocket: false,
    clientProcess: {
      pid: 5678,
      name: 'curl',
    },
  };

  const wsFlow: FilterableFlow = {
    url: 'wss://stream.example.com/ws',
    method: 'GET',
    statusCode: 101,
    isWebSocket: true,
    isStatic: false,
  };

  describe('Unary Operators', () => {
    it('~a 匹配静态资源', () => {
      const match = compileFlowFilter('~a');
      assert.equal(match(assetFlow), true);
      assert.equal(match(baseFlow), false);
    });

    it('!~a 取反排除静态资源', () => {
      const match = compileFlowFilter('!~a');
      assert.equal(match(assetFlow), false);
      assert.equal(match(baseFlow), true);
    });

    it('~e 匹配错误状态', () => {
      const match = compileFlowFilter('~e');
      assert.equal(match(errorFlow), true);
      assert.equal(match(baseFlow), false);
    });

    it('~http 与 ~websocket 匹配协议', () => {
      const matchHttp = compileFlowFilter('~http');
      const matchWs = compileFlowFilter('~websocket');
      assert.equal(matchHttp(baseFlow), true);
      assert.equal(matchHttp(wsFlow), false);
      assert.equal(matchWs(wsFlow), true);
      assert.equal(matchWs(baseFlow), false);
    });

    it('~all 匹配所有流', () => {
      const match = compileFlowFilter('~all');
      assert.equal(match(baseFlow), true);
      assert.equal(match(assetFlow), true);
      assert.equal(match(errorFlow), true);
    });

    it('~q 与 ~s 匹配是否有响应', () => {
      const matchQ = compileFlowFilter('~q');
      const matchS = compileFlowFilter('~s');
      const noRespFlow: FilterableFlow = {
        url: 'https://test.com',
        method: 'GET',
        statusCode: 0,
      };
      assert.equal(matchQ(noRespFlow), true);
      assert.equal(matchQ(baseFlow), false);
      assert.equal(matchS(baseFlow), true);
      assert.equal(matchS(noRespFlow), false);
    });
  });

  describe('Parameter & Regex Operators', () => {
    it('~m 匹配 HTTP Method', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~m GET'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~m get'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~m POST'), false);
      assert.equal(matchesFlowFilter(errorFlow, '~m POST'), true);
      assert.equal(matchesFlowFilter(errorFlow, '~m (GET|POST)'), true);
    });

    it('~c 匹配响应状态码及正则', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~c 200'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~c 500'), false);
      assert.equal(matchesFlowFilter(errorFlow, '~c 500'), true);
      assert.equal(matchesFlowFilter(errorFlow, '~c 5..'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~c 2..'), true);
    });

    it('~u 匹配 URL 正则', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~u /v1/users'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~u page=\\d+'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~u /v2/'), false);
    });

    it('~d 匹配域名 Host', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~d api\\.example\\.com'), true);
      assert.equal(
        matchesFlowFilter(baseFlow, '~d cdn\\.example\\.com'),
        false,
      );
      assert.equal(
        matchesFlowFilter(assetFlow, '~d cdn\\.example\\.com'),
        true,
      );
    });

    it('~b, ~bq, ~bs 匹配正文 Body', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~b active'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~b Alice'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~bq active'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~bq Alice'), false);
      assert.equal(matchesFlowFilter(baseFlow, '~bs Alice'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~bs active'), false);
    });

    it('~h, ~hq, ~hs 匹配 Header', () => {
      assert.equal(
        matchesFlowFilter(baseFlow, '~h "authorization: Bearer"'),
        true,
      );
      assert.equal(matchesFlowFilter(baseFlow, '~hq Bearer'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~hs nginx'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~hq nginx'), false);
    });

    it('~t, ~tq, ~ts 匹配 Content-Type', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~t json'), true);
      assert.equal(matchesFlowFilter(assetFlow, '~t javascript'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~t javascript'), false);
    });

    it('~p 匹配客户端进程', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~p node'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~p 1234'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~p curl'), false);
      assert.equal(matchesFlowFilter(errorFlow, '~p curl'), true);

      // 支持 initiator JSON 格式（前端/会话摘要）
      const initiatorFlow: FilterableFlow = {
        url: 'https://test.com',
        initiator: JSON.stringify({
          type: 'clientProcess',
          pid: 9999,
          name: 'python.exe',
        }),
      };
      assert.equal(matchesFlowFilter(initiatorFlow, '~p python'), true);
      assert.equal(matchesFlowFilter(initiatorFlow, '~p 9999'), true);
    });

    it('裸字符串作为 URL 正则匹配', () => {
      assert.equal(matchesFlowFilter(baseFlow, 'users'), true);
      assert.equal(matchesFlowFilter(baseFlow, 'notfound'), false);
    });
  });

  describe('Logical Combinations & Grouping', () => {
    it('& 显式与隐式 AND 运算', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~m GET & ~c 200'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~m GET ~c 200'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~m GET ~c 500'), false);
      assert.equal(
        matchesFlowFilter(baseFlow, '~d example.com ~m GET /v1/'),
        true,
      );
    });

    it('| OR 运算', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~c 200 | ~c 500'), true);
      assert.equal(matchesFlowFilter(errorFlow, '~c 200 | ~c 500'), true);
      assert.equal(matchesFlowFilter(assetFlow, '~c 404 | ~c 500'), false);
    });

    it('! 与括号组合优先级', () => {
      assert.equal(matchesFlowFilter(baseFlow, '!~a & ~m GET'), true);
      assert.equal(matchesFlowFilter(assetFlow, '!~a & ~m GET'), false);

      // (~c 200 | ~c 201) & ~m POST
      assert.equal(
        matchesFlowFilter(baseFlow, '(~c 200 | ~c 201) & ~m POST'),
        false,
      );
      assert.equal(
        matchesFlowFilter(baseFlow, '(~c 200 | ~c 201) & ~m GET'),
        true,
      );

      // ! (~m POST | ~c 500)
      assert.equal(matchesFlowFilter(baseFlow, '!(~m POST | ~c 500)'), true);
      assert.equal(matchesFlowFilter(errorFlow, '!(~m POST | ~c 500)'), false);
    });
  });

  describe('Edge cases & Fallback', () => {
    it('空字符串或纯空白匹配所有', () => {
      assert.equal(matchesFlowFilter(baseFlow, ''), true);
      assert.equal(matchesFlowFilter(baseFlow, '   '), true);
    });

    it('带引号含空格的内容', () => {
      assert.equal(matchesFlowFilter(baseFlow, '~hq "Bearer token123"'), true);
      assert.equal(matchesFlowFilter(baseFlow, '~b "Alice"'), true);
    });

    it('语法不完整或残缺时不崩溃，优雅匹配', () => {
      assert.doesNotThrow(() => {
        matchesFlowFilter(baseFlow, '~m ');
        matchesFlowFilter(baseFlow, '(');
        matchesFlowFilter(baseFlow, '!(');
        matchesFlowFilter(baseFlow, '~c ');
      });
    });

    it('fallbackFuzzy 选项支持对无 ~ 的搜索进行多字段模糊搜索', () => {
      const matchFuzzy = compileFlowFilter('200', {fallbackFuzzy: true});
      assert.equal(matchFuzzy(baseFlow), true);

      const matchMethod = compileFlowFilter('GET', {fallbackFuzzy: true});
      assert.equal(matchMethod(baseFlow), true);
    });
  });
});
