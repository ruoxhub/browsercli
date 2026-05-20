/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {DomainManifest} from '../../../src/tools/manifest.js';
import {ToolRegistry} from '../../../src/tools/registry/ToolRegistry.js';

describe('ToolRegistry profile filtering', () => {
  it('includes search tools in workflow profile', () => {
    const manifests: DomainManifest[] = [
      {
        name: 'search-domain',
        description: 'Search tools',
        tools: [
          {
            modulePath: './search-domain/find.js',
            handlerName: 'find',
            profile: 'search',
          },
        ],
      },
    ];

    assert.deepStrictEqual(new ToolRegistry(manifests).listTools('workflow'), [
      {
        domain: 'search-domain',
        modulePath: './search-domain/find.js',
        handlerName: 'find',
        profile: 'search',
        dependencies: undefined,
      },
    ]);
  });

  it('excludes full-only tools from workflow profile', () => {
    const manifests: DomainManifest[] = [
      {
        name: 'heavy-domain',
        description: 'Heavy tools',
        tools: [
          {
            modulePath: './heavy-domain/run.js',
            handlerName: 'run',
            profile: 'full',
          },
        ],
      },
    ];

    assert.deepStrictEqual(
      new ToolRegistry(manifests).listTools('workflow'),
      [],
    );
  });

  it('defaults unspecified domains to workflow', () => {
    const manifests: DomainManifest[] = [
      {
        name: 'default-domain',
        description: 'Default tools',
        tools: [
          {
            modulePath: './default-domain/tool.js',
            handlerName: 'tool',
          },
        ],
      },
    ];

    assert.deepStrictEqual(new ToolRegistry(manifests).listTools('search'), []);
    assert.deepStrictEqual(
      new ToolRegistry(manifests).listTools('workflow')[0]?.profile,
      'workflow',
    );
  });
});
