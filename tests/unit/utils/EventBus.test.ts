/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  appEventValidators,
  type AppEventMap,
} from '../../../src/types/events.js';
import {EventBus} from '../../../src/utils/EventBus.js';

describe('EventBus', () => {
  it('emits valid payloads to subscribers', () => {
    const bus = new EventBus<AppEventMap>({validators: appEventValidators});
    let received: AppEventMap['tool:called'] | undefined;

    bus.on('tool:called', payload => {
      received = payload;
    });

    bus.emit('tool:called', {
      name: 'collect_scripts',
      durationMs: 25,
      success: true,
      traceId: 'tr_test_001',
    });

    assert.deepStrictEqual(received, {
      name: 'collect_scripts',
      durationMs: 25,
      success: true,
      traceId: 'tr_test_001',
    });
  });

  it('throws before notifying subscribers when payload validation fails', () => {
    const bus = new EventBus<AppEventMap>({validators: appEventValidators});
    let called = false;

    bus.on('tool:called', () => {
      called = true;
    });

    assert.throws(
      () =>
        bus.emit('tool:called', {
          name: 'collect_scripts',
          durationMs: -1,
          success: true,
          traceId: 'tr_test_002',
        }),
      /Invalid event payload for "tool:called"/,
    );
    assert.strictEqual(called, false);
  });

  it('keeps unvalidated buses backwards compatible', () => {
    const bus = new EventBus<AppEventMap>();
    let received: AppEventMap['tool:called'] | undefined;

    bus.on('tool:called', payload => {
      received = payload;
    });

    bus.emit('tool:called', {
      name: 'collect_scripts',
      durationMs: -1,
      success: true,
      traceId: 'tr_test_003',
    });

    assert.strictEqual(received?.durationMs, -1);
  });

  it('can disable validation even when schemas are configured', () => {
    const bus = new EventBus<AppEventMap>({
      validators: appEventValidators,
      validateOnEmit: false,
    });
    let received: AppEventMap['tool:called'] | undefined;

    bus.on('tool:called', payload => {
      received = payload;
    });

    bus.emit('tool:called', {
      name: 'collect_scripts',
      durationMs: -1,
      success: true,
      traceId: 'tr_test_004',
    });

    assert.strictEqual(received?.durationMs, -1);
  });

  it('emitAsync waits for async subscribers', async () => {
    const bus = new EventBus<AppEventMap>({validators: appEventValidators});
    const calls: string[] = [];

    bus.on('tool:called', async payload => {
      await Promise.resolve();
      calls.push(payload.name);
    });

    await bus.emitAsync('tool:called', {
      name: 'collect_scripts',
      durationMs: 25,
      success: true,
      traceId: 'tr_test_005',
    });

    assert.deepStrictEqual(calls, ['collect_scripts']);
  });

  it('emitAsync rejects when a subscriber fails', async () => {
    const bus = new EventBus<AppEventMap>({validators: appEventValidators});

    bus.on('tool:called', async () => {
      throw new Error('subscriber failed');
    });

    await assert.rejects(
      bus.emitAsync('tool:called', {
        name: 'collect_scripts',
        durationMs: 25,
        success: true,
        traceId: 'tr_test_006',
      }),
      /subscriber failed/,
    );
  });
});
