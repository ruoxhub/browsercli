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

  it('search profile no longer includes the meta domain', () => {
    const tools = new ToolRegistry(manifests).listTools('search');
    assert.ok(tools.length >= 1, 'search profile still exposes diagnostics');
    assert.ok(
      tools.every(t => t.domain !== 'meta'),
      'meta domain must be gone from the search profile',
    );
  });

  it('workflow profile excludes full-only domains like debugger and wasm', () => {
    const tools = new ToolRegistry(manifests).listTools('workflow');
    const domains = new Set(tools.map(t => t.domain));
    assert.ok(!domains.has('debugger'), 'debugger should be full-only');
    assert.ok(!domains.has('wasm'), 'wasm should be full-only');
    assert.ok(domains.has('analyzer'), 'analyzer is workflow-tier');
  });

  it('full profile is the union of all domains', () => {
    const tools = new ToolRegistry(manifests).listTools('full');
    const domains = new Set(tools.map(t => t.domain));
    assert.strictEqual(domains.size, manifests.length);
  });
});
