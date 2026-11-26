/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {emulate} from '../../../../src/tools/emulation.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('emulate tool', () => {
  it('parses string transforms (geolocation, viewport, extraHttpHeaders) cleanly via schema', () => {
    const geo = emulate.schema.geolocation.parse('37.7749,-122.4194');
    assert.deepEqual(geo, {latitude: 37.7749, longitude: -122.4194});

    const viewport = emulate.schema.viewport.parse('390x844x3,mobile,touch');
    assert.deepEqual(viewport, {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      isLandscape: false,
      hasTouch: true,
    });

    const headers = emulate.schema.extraHttpHeaders.parse(
      '{"X-Token":"secret"}',
    );
    assert.deepEqual(headers, {'X-Token': 'secret'});
  });

  it('rejects invalid geolocation and viewport strings cleanly', () => {
    assert.throws(() => emulate.schema.geolocation.parse('95,0'));
    assert.throws(() => emulate.schema.viewport.parse('0x800'));
    assert.throws(() => emulate.schema.extraHttpHeaders.parse('[1,2]'));
  });

  it('delegates emulate options to context.emulate', async () => {
    let received: Record<string, unknown> | undefined;
    const response = new ToolResponseAccumulator();
    await emulate.handler(
      {
        params: {
          networkConditions: 'Slow 3G',
          cpuThrottlingRate: 4,
          colorScheme: 'dark',
          userAgent: 'CustomUA/1.0',
          viewport: {
            width: 375,
            height: 812,
            isMobile: true,
            isLandscape: false,
            hasTouch: true,
          },
        } as never,
      },
      response,
      {
        getSelectedPage: () => ({}),
        emulate: async (opts: Record<string, unknown>) => {
          received = opts;
        },
      } as never,
    );
    assert.equal(received?.networkConditions, 'Slow 3G');
    assert.equal(received?.cpuThrottlingRate, 4);
    assert.equal(received?.colorScheme, 'dark');
    assert.equal(received?.userAgent, 'CustomUA/1.0');
    assert.equal(
      (response.toJSON().structuredContent as Record<string, unknown>).success,
      true,
    );
  });

  it('parses raw CLI string viewport, geolocation and extraHttpHeaders inside handler', async () => {
    let received: Record<string, unknown> | undefined;
    const response = new ToolResponseAccumulator();
    await emulate.handler(
      {
        params: {
          viewport: '390x844x3,mobile,touch',
          geolocation: '31.23,121.47',
          extraHttpHeaders: '{"X-Debug":"1"}',
        } as never,
      },
      response,
      {
        getSelectedPage: () => ({}),
        emulate: async (opts: Record<string, unknown>) => {
          received = opts;
        },
      } as never,
    );
    assert.deepEqual(received?.viewport, {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      isLandscape: false,
      hasTouch: true,
    });
    assert.deepEqual(received?.geolocation, {
      latitude: 31.23,
      longitude: 121.47,
    });
    assert.deepEqual(received?.extraHttpHeaders, {'X-Debug': '1'});
  });

  it('throws PAGE_REQUIRED when no page is selected', async () => {
    await assert.rejects(
      emulate.handler(
        {params: {colorScheme: 'light'} as never},
        new ToolResponseAccumulator(),
        {getSelectedPage: () => null} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.PAGE_REQUIRED,
    );
  });
});
