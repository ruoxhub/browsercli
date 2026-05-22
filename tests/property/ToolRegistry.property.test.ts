/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import fc from 'fast-check';

import type {DomainManifest} from '../../src/tools/manifest.js';
import {ToolRegistry} from '../../src/tools/registry/ToolRegistry.js';

describe('Property: ToolRegistry profile filtering', () => {
  it('satisfies monotonicity and profile limits', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({minLength: 1, maxLength: 10}),
            description: fc.string(),
            profile: fc.constantFrom('search' as const, 'workflow' as const, 'full' as const),
            tools: fc.array(
              fc.record({
                modulePath: fc.string({minLength: 1}),
                handlerName: fc.string({minLength: 1}),
                profile: fc.option(
                  fc.constantFrom('search' as const, 'workflow' as const, 'full' as const),
                  {nil: undefined},
                ),
              }),
              {maxLength: 10},
            ),
          }),
          {maxLength: 5},
        ),
        manifests => {
          const registry = new ToolRegistry(manifests);

          const searchTools = registry.listTools('search');
          const workflowTools = registry.listTools('workflow');
          const fullTools = registry.listTools('full');

          // 单调性
          assert.ok(searchTools.length <= workflowTools.length);
          assert.ok(workflowTools.length <= fullTools.length);

          // searchTools 只能包含 search profile 的工具
          for (const tool of searchTools) {
            assert.strictEqual(tool.profile, 'search');
          }

          // workflowTools 只能包含 search 或 workflow
          for (const tool of workflowTools) {
            assert.ok(tool.profile === 'search' || tool.profile === 'workflow');
          }
        },
      ),
    );
  });
});

