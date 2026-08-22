/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../src/tools/generated-tools-index.js';
import {ToolRegistry} from '../../src/tools/registry/ToolRegistry.js';
import {loadToolMeta, type ToolMeta} from '../../src/tools/tools-meta.js';

const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
const fullProfileTools = registry.listTools('full');

describe('tool-categories (Layer 2)', () => {
  it('every registry domain is represented in the full profile', () => {
    const domains = new Set(fullProfileTools.map(tool => tool.domain));
    for (const manifest of GENERATED_DOMAIN_MANIFESTS) {
      assert.ok(
        domains.has(manifest.name),
        `domain "${manifest.name}" is not represented in the full profile`,
      );
    }
  });

  for (const manifest of GENERATED_DOMAIN_MANIFESTS) {
    it(`${manifest.name} tools load to non-null ToolMeta with valid argSpecs`, async () => {
      const tools = fullProfileTools.filter(
        tool => tool.domain === manifest.name,
      );
      assert.ok(tools.length > 0, `domain ${manifest.name} has no tools`);

      const metas: ToolMeta[] = [];
      for (const entry of tools) {
        const meta = await loadToolMeta(entry);
        assert.ok(
          meta,
          `${manifest.name}:${entry.handlerName} failed to load (conflict / missing export / not defineTool)`,
        );
        assert.equal(typeof meta.name, 'string');
        assert.ok(meta.name.length > 0);
        assert.equal(typeof meta.description, 'string');
        assert.equal(typeof meta.argSpecs, 'object');
        metas.push(meta);
      }

      assert.equal(
        metas.length,
        tools.length,
        `${manifest.name} loaded meta count must equal registry count`,
      );
    });
  }
});
