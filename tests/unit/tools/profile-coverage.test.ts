/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../../src/tools/generated-tools-index.js';
import type {DomainManifest} from '../../../src/tools/manifest.js';

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
});
