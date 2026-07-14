/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {runEnvironmentDiagnostics} from '../../../src/diagnostics/environment.js';

describe('runEnvironmentDiagnostics', () => {
  it('returns a report with checks array', () => {
    const report = runEnvironmentDiagnostics();
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.length > 0);
  });

  it('includes node_version check', () => {
    const report = runEnvironmentDiagnostics();
    const nodeCheck = report.checks.find(c => c.name === 'node_version');
    assert.ok(nodeCheck);
    assert.ok(['ok', 'warn', 'fail'].includes(nodeCheck.status));
  });

  it('includes build_output check', () => {
    const report = runEnvironmentDiagnostics();
    const buildCheck = report.checks.find(c => c.name === 'build_output');
    assert.ok(buildCheck);
  });

  it('includes artifacts_dir check', () => {
    const report = runEnvironmentDiagnostics();
    const artifactsCheck = report.checks.find(c => c.name === 'artifacts_dir');
    assert.ok(artifactsCheck);
  });

  it('sets overall status from worst check', () => {
    const report = runEnvironmentDiagnostics();
    const statuses = report.checks.map(c => c.status);
    if (statuses.includes('fail')) {
      assert.equal(report.status, 'fail');
    } else if (statuses.includes('warn')) {
      assert.equal(report.status, 'warn');
    } else {
      assert.equal(report.status, 'ok');
    }
  });

  it('generates a summary string', () => {
    const report = runEnvironmentDiagnostics();
    assert.ok(typeof report.summary === 'string');
    assert.ok(report.summary.length > 0);
  });
});
