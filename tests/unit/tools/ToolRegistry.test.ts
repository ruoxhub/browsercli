/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {DomainManifest} from '../../../src/tools/manifest.js';
import {ToolRegistry} from '../../../src/tools/registry/ToolRegistry.js';

describe('ToolRegistry', () => {
  it('lists tools from manifests', () => {
    const mockManifests: DomainManifest[] = [
      {
        name: 'sample_domain',
        description: 'sample',
        profile: 'workflow',
        tools: [
          {
            modulePath: './sample.js',
            handlerName: 'sampleTool',
            profile: 'workflow',
          },
          {
            modulePath: './another.js',
            handlerName: 'anotherTool',
          },
        ],
      },
    ];

    const registry = new ToolRegistry(mockManifests);
    const tools = registry.listTools();

    assert.strictEqual(tools.length, 2);
    assert.strictEqual(tools[0].domain, 'sample_domain');
    assert.strictEqual(tools[0].handlerName, 'sampleTool');
    assert.strictEqual(tools[0].profile, 'workflow');
    assert.strictEqual(tools[1].handlerName, 'anotherTool');
    assert.strictEqual(tools[1].profile, 'workflow'); // 回退到 manifest.profile
  });

  it('filters tools by profile level', () => {
    const mockManifests: DomainManifest[] = [
      {
        name: 'domain_a',
        description: 'a',
        profile: 'full',
        tools: [
          {
            modulePath: './t1.js',
            handlerName: 'toolWorkflowLow',
            profile: 'workflow',
          },
          {
            modulePath: './t2.js',
            handlerName: 'toolWorkflow',
            profile: 'workflow',
          },
          {modulePath: './t3.js', handlerName: 'toolFull', profile: 'full'},
        ],
      },
    ];

    const registry = new ToolRegistry(mockManifests);

    // workflow profile 应该包含 workflow 级别的工具
    const workflowTools = registry.listTools('workflow');
    assert.strictEqual(workflowTools.length, 2);
    assert.ok(workflowTools.some(t => t.handlerName === 'toolWorkflowLow'));
    assert.ok(workflowTools.some(t => t.handlerName === 'toolWorkflow'));

    // full profile 应该包含全部
    const fullTools = registry.listTools('full');
    assert.strictEqual(fullTools.length, 3);
  });

  it('handles default fallback profiles correctly', () => {
    const mockManifests: DomainManifest[] = [
      {
        name: 'domain_b',
        description: 'b',
        tools: [{modulePath: './t.js', handlerName: 'toolFallback'}],
      },
    ];

    const registry = new ToolRegistry(mockManifests);
    const tools = registry.listTools();
    assert.strictEqual(tools[0].profile, 'workflow'); // 默认回退为 'workflow'
  });

  it('preserves requirements from manifest tool entries', () => {
    const mockManifests: DomainManifest[] = [
      {
        name: 'sample_domain',
        description: 'sample',
        profile: 'workflow',
        tools: [
          {
            modulePath: './click.js',
            handlerName: 'click',
            requirements: {
              browser: 'connected',
              page: 'selected',
              frame: 'selected',
              debugger: 'running',
            },
          },
          {
            modulePath: './no_req.js',
            handlerName: 'noReq',
          },
        ],
      },
    ];

    const registry = new ToolRegistry(mockManifests);
    const tools = registry.listTools('full');

    assert.deepStrictEqual(tools[0].requirements, {
      browser: 'connected',
      page: 'selected',
      frame: 'selected',
      debugger: 'running',
    });
    assert.strictEqual(tools[1].requirements, undefined);
  });
});
