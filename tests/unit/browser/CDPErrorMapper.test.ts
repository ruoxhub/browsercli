/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  mapCDPError,
  isCDPSessionGone,
  wrapCDPCall,
} from '../../../src/modules/browser/CDPErrorMapper.js';

describe('CDPErrorMapper', () => {
  describe('mapCDPError', () => {
    it('should map "Session closed" to CDP_SESSION_CLOSED', () => {
      const result = mapCDPError(
        new Error('Session closed. Most likely the page has been closed.'),
      );
      assert.strictEqual(result.name, 'CDP_SESSION_CLOSED');
    });

    it('should map "Target closed" to CDP_TARGET_CLOSED', () => {
      const result = mapCDPError(new Error('Target closed'));
      assert.strictEqual(result.name, 'CDP_TARGET_CLOSED');
    });

    it('should map "Cannot find context" to CDP_CONTEXT_GONE', () => {
      const result = mapCDPError(
        new Error('Cannot find context with specified id'),
      );
      assert.strictEqual(result.name, 'CDP_CONTEXT_GONE');
    });

    it('should map "Execution context was destroyed" to CDP_CONTEXT_GONE', () => {
      const result = mapCDPError(new Error('Execution context was destroyed'));
      assert.strictEqual(result.name, 'CDP_CONTEXT_GONE');
    });

    it('should map Protocol timeout to CDP_TIMEOUT', () => {
      const result = mapCDPError(
        new Error('Protocol error (Runtime.evaluate): Timeout'),
      );
      assert.strictEqual(result.name, 'CDP_TIMEOUT');
    });

    it('should map net::ERR_ to CDP_NETWORK_ERROR', () => {
      const result = mapCDPError(new Error('net::ERR_CONNECTION_REFUSED'));
      assert.strictEqual(result.name, 'CDP_NETWORK_ERROR');
    });

    it('should pass through unknown errors unchanged', () => {
      const original = new Error('Something completely different');
      const result = mapCDPError(original);
      assert.strictEqual(result, original);
    });

    it('should handle non-Error input', () => {
      const result = mapCDPError('string error about Session closed');
      assert.strictEqual(result.name, 'CDP_SESSION_CLOSED');
    });
  });

  describe('isCDPSessionGone', () => {
    it('should return true for session closed errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('Session closed')), true);
    });

    it('should return true for target closed errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('Target closed')), true);
    });

    it('should return true for connection closed errors', () => {
      assert.strictEqual(
        isCDPSessionGone(new Error('Connection closed')),
        true,
      );
    });

    it('should return false for unrelated errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('timeout')), false);
    });
  });

  describe('wrapCDPCall', () => {
    it('should return result on success', async () => {
      const result = await wrapCDPCall(async () => 42);
      assert.strictEqual(result, 42);
    });

    it('should throw mapped error on failure', async () => {
      await assert.rejects(
        () =>
          wrapCDPCall(async () => {
            throw new Error('Session closed');
          }),
        (err: Error) => err.name === 'CDP_SESSION_CLOSED',
      );
    });
  });
});
