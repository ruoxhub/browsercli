/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {mitmConfigureLocalApps} from '../../../../src/tools/proxy/mitmConfigureLocalApps.js';
import {mitmListLocalProcesses} from '../../../../src/tools/proxy/mitmListLocalProcesses.js';

describe('local apps tools', () => {
  it('mitm_list_local_processes 注册元数据完整', () => {
    assert.strictEqual(
      mitmListLocalProcesses.name,
      'mitm_list_local_processes',
    );
    assert.ok(mitmListLocalProcesses.description.length > 0);
    assert.ok(mitmListLocalProcesses.handler);
  });

  it('mitm_configure_local_apps schema 含 enabled/targets', () => {
    assert.strictEqual(
      mitmConfigureLocalApps.name,
      'mitm_configure_local_apps',
    );
    assert.ok(mitmConfigureLocalApps.schema.enabled);
    assert.ok(mitmConfigureLocalApps.schema.targets);
  });
});
