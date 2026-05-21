/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolSearchEngine} from '../../../src/cli/tool-search-engine.js';
import type {ToolMeta} from '../../../src/cli/tools-meta.js';

const tools: ToolMeta[] = [
  {
    name: 'hookCookie',
    description: 'Hook document.cookie getter and setter',
    schema: {},
    argSpecs: {},
    modulePath: './hook/Cookie.js',
    handlerName: 'hookCookie',
    callMode: 'defineTool',
    domain: 'hook',
    profile: 'workflow',
    sceneKeywords: ['cookie', 'runtime', 'hook'],
  },
  {
    name: 'listConsoleMessages',
    description: 'List browser console messages',
    schema: {},
    argSpecs: {},
    modulePath: './console/listConsoleMessages.js',
    handlerName: 'listConsoleMessages',
    callMode: 'defineTool',
    domain: 'console',
    profile: 'workflow',
  },
];

test('ranks scene keyword and domain matches above generic description matches', () => {
  const results = new ToolSearchEngine(tools).search('cookie hook');
  assert.equal(results[0]?.name, 'hookCookie');
});

test('uses argument names as searchable tokens', () => {
  const engine = new ToolSearchEngine([
    {
      ...tools[0],
      name: 'traceSignatureGeneration',
      description: 'Trace signature generation flow',
      argSpecs: {
        urlPattern: {
          type: 'string',
          required: false,
          description: 'URL pattern to filter target requests',
        },
      },
      domain: 'workflow',
      sceneKeywords: ['signature', 'trace'],
    },
  ]);

  assert.equal(
    engine.search('url pattern signature')[0]?.name,
    'traceSignatureGeneration',
  );
});
