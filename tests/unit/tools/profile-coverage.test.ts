/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../../src/tools/generated-tools-index.js';
import type {DomainManifest} from '../../../src/tools/manifest.js';
import {ToolRegistry} from '../../../src/tools/registry/ToolRegistry.js';

const manifests: readonly DomainManifest[] = GENERATED_DOMAIN_MANIFESTS;

describe('Profile coverage', () => {
  it('every domain manifest declares an explicit profile', () => {
    const missing = manifests.filter(m => !m.profile).map(m => m.name);

    assert.deepStrictEqual(
      missing,
      [],
      `Domains without profile: ${missing.join(', ')}`,
    );
  });

  it('search profile yields at least one tool (meta domain present)', () => {
    const searchTools = manifests.flatMap(manifest =>
      manifest.tools.filter(
        tool => (tool.profile ?? manifest.profile) === 'search',
      ),
    );

    assert.ok(
      searchTools.length >= 1,
      'search profile must include at least one tool (meta.search_tools)',
    );
  });

  it('search profile yields exactly the meta domain tools', () => {
    const tools = new ToolRegistry(manifests).listTools('search');
    assert.ok(tools.length >= 1);
    assert.ok(tools.every(t => t.domain === 'meta'));
  });

  it('workflow profile excludes full-only domains like debugger and wasm', () => {
    const tools = new ToolRegistry(manifests).listTools('workflow');
    const domains = new Set(tools.map(t => t.domain));
    assert.ok(!domains.has('debugger'), 'debugger should be full-only');
    assert.ok(!domains.has('wasm'), 'wasm should be full-only');
    assert.ok(domains.has('meta'), 'meta should bubble up to workflow');
    assert.ok(domains.has('analyzer'), 'analyzer is workflow-tier');
  });

  it('full profile is the union of all domains', () => {
    const tools = new ToolRegistry(manifests).listTools('full');
    const domains = new Set(tools.map(t => t.domain));
    assert.strictEqual(domains.size, manifests.length);
  });
});
