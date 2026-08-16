/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {getStorage} from '../../../../src/tools/debugger/getStorage.js';

interface StorageContent {
  success?: boolean;
  data: {
    storage: {cookies: Record<string, string>};
    cookieHeader?: string;
    cookieDetails: Array<{httpOnly?: boolean}>;
  };
}

function captureResponse() {
  let content: StorageContent | undefined;
  return {
    response: {
      setStructuredContent(value: StorageContent) {
        content = value;
      },
    },
    get content() {
      return content;
    },
  };
}

describe('get_storage', () => {
  it('exports page cookies, including HttpOnly values, as a Cookie header', async () => {
    const output = captureResponse();
    const page = {
      url: () => 'https://example.com/account',
      context: () => ({
        cookies: async (url: string) => {
          assert.equal(url, 'https://example.com/account');
          return [
            {
              name: 'sessionid',
              value: 'rotated-token',
              domain: 'example.com',
              path: '/',
              expires: -1,
              httpOnly: true,
              secure: true,
              sameSite: 'Lax',
            },
            {
              name: 'theme',
              value: 'dark',
              domain: 'example.com',
              path: '/',
              expires: -1,
              httpOnly: false,
              secure: true,
              sameSite: 'Lax',
            },
          ];
        },
      }),
    };

    await getStorage.handler(
      {params: {type: 'cookies'}} as never,
      output.response as never,
      {
        getSelectedPage: () => page,
        getSelectedFrame: () => {
          throw new Error(
            'cookies-only export must not evaluate page JavaScript',
          );
        },
      } as never,
    );

    assert.equal(output.content?.success, true);
    assert.deepEqual(output.content?.data.storage.cookies, {
      sessionid: 'rotated-token',
      theme: 'dark',
    });
    assert.equal(
      output.content?.data.cookieHeader,
      'sessionid=rotated-token; theme=dark',
    );
    assert.equal(output.content?.data.cookieDetails[0].httpOnly, true);
  });
});
