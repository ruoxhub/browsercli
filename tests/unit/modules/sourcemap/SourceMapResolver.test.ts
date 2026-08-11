import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {describe, it} from 'node:test';

import {
  assertPublicAddress,
  decodeDataUri,
  readBoundedBody,
} from '../../../../src/modules/sourcemap/SourceMapResolver.js';
import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';

describe('SourceMapResolver network boundaries', () => {
  it('decodes base64 and percent data URIs', () => {
    assert.equal(
      decodeDataUri('data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==', 100),
      '{"version":3}',
    );
    assert.equal(
      decodeDataUri('data:application/json,%7B%22version%22%3A3%7D', 100),
      '{"version":3}',
    );
  });

  it('blocks private and mapped-private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.1.1',
      '::1',
      'fc00::1',
    ]) {
      assert.throws(() => assertPublicAddress(address), SourceMapError);
    }
  });

  it('aborts a streamed body at the byte limit', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    await assert.rejects(
      readBoundedBody(body, 10),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'FETCH_TOO_LARGE',
    );
  });
});
