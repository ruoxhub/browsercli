/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  compactAgentPayload,
  withSchemaVersion,
  inferBlockedBy,
  inferOutcomeFromStatus,
  buildTaskDiagnostics,
  buildManageSummaryText,
  REVERSE_AGENT_SCHEMA_VERSION,
} from '../../../../src/tools/shared/response-builder.js';

describe('compactAgentPayload', () => {
  it('returns payload unchanged in verbose mode', () => {
    const payload = {status: 'ok', agentGuidance: {summary: 'test'}};
    const result = compactAgentPayload(payload, 'verbose');
    assert.deepEqual(result, payload);
  });

  it('strips guidance fields in compact mode', () => {
    const payload = {
      status: 'ok',
      agentGuidance: {summary: 'test'},
      nextBestTool: 'some_tool',
      fallbackPlan: {steps: []},
      routeGuard: {},
    };
    const result = compactAgentPayload(payload, 'compact');
    assert.equal(result.detailLevel, 'minimal');
    assert.equal(result.nextBestTool, undefined);
    assert.equal(result.agentGuidance, undefined);
  });
});

describe('withSchemaVersion', () => {
  it('prepends schema version', () => {
    const result = withSchemaVersion({foo: 'bar'});
    assert.equal(result.schemaVersion, REVERSE_AGENT_SCHEMA_VERSION);
    assert.equal(result.foo, 'bar');
  });
});

describe('inferBlockedBy', () => {
  it('maps known reasons', () => {
    assert.equal(inferBlockedBy('blocked'), 'task_state');
    assert.equal(inferBlockedBy('env_error'), 'environment');
    assert.equal(inferBlockedBy('validation_error'), 'input_validation');
  });

  it('returns undefined for unknown reasons', () => {
    assert.equal(inferBlockedBy('something_random'), undefined);
  });
});

describe('inferOutcomeFromStatus', () => {
  it('maps blocked to blocked', () => {
    assert.equal(inferOutcomeFromStatus('blocked'), 'blocked');
  });

  it('maps partial to partial', () => {
    assert.equal(inferOutcomeFromStatus('partial'), 'partial');
  });

  it('defaults to success', () => {
    assert.equal(inferOutcomeFromStatus('completed'), 'success');
  });
});

describe('buildTaskDiagnostics', () => {
  it('includes action and outputMode', () => {
    const result = buildTaskDiagnostics('get', 'verbose', 'task-1');
    assert.equal(result.responseStatus, 'ok');
    assert.equal(result.action, 'get');
    assert.equal(result.outputMode, 'verbose');
    assert.equal(result.taskId, 'task-1');
  });
});

describe('buildManageSummaryText', () => {
  it('summarizes list action', () => {
    const text = buildManageSummaryText('list', {items: [1, 2]});
    assert.ok(text.includes('2'));
  });

  it('summarizes get action', () => {
    const text = buildManageSummaryText('get', {taskId: 'task-1'});
    assert.ok(text.includes('task-1'));
  });
});
