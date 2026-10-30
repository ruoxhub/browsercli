/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {BrowserConfigInvariantError} from '../../../src/config/browserInvariants.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';
import {
  BrowserConfigRequestError,
  candidateBrowserConfig,
  effectiveBrowserConfig,
  parseBrowserConnectBody,
  parseBrowserDisconnectBody,
} from '../../../src/worker/browserRequests.js';

describe('parseBrowserConnectBody', () => {
  it('returns a ws-target patch and clears stale selectors', () => {
    const patch = parseBrowserConnectBody({
      wsEndpoint: 'ws://new/devtools',
      headless: false,
    });
    assert.strictEqual(patch.wsEndpoint, 'ws://new/devtools');
    assert.strictEqual(patch.headless, false);
    assert.strictEqual(patch.browserURL, undefined);
    assert.strictEqual(patch.channel, undefined);
    assert.strictEqual(patch.executablePath, undefined);
    assert.strictEqual(patch.remoteDebuggingUrl, undefined);
  });

  it('clears stale targets for HTTP and local selectors', () => {
    const http = parseBrowserConnectBody({browserURL: 'https://new:9222'});
    assert.strictEqual(http.browserURL, 'https://new:9222');
    assert.strictEqual(http.wsEndpoint, undefined);
    assert.strictEqual(http.remoteDebuggingUrl, undefined);

    const unadorned = parseBrowserConnectBody({browserURL: '127.0.0.1:53687'});
    assert.strictEqual(unadorned.browserURL, 'http://127.0.0.1:53687');

    const channel = parseBrowserConnectBody({channel: 'stable'});
    assert.strictEqual(channel.channel, 'stable');
    assert.strictEqual(channel.browserURL, undefined);
    assert.strictEqual(channel.executablePath, undefined);
    assert.strictEqual(channel.remoteDebuggingUrl, undefined);

    const path = parseBrowserConnectBody({executablePath: 'new-browser.exe'});
    assert.strictEqual(path.executablePath, 'new-browser.exe');
    assert.strictEqual(path.browserURL, undefined);
    assert.strictEqual(path.channel, undefined);
    assert.strictEqual(path.wsEndpoint, undefined);
  });

  it('rejects conflicts, invalid values, and unknown fields', () => {
    const cases: Array<[unknown, 'VALIDATION' | 'BROWSER_CONFIG_CONFLICT']> = [
      [null, 'VALIDATION'],
      [[], 'VALIDATION'],
      [
        {browserURL: 'http://host:9222', wsEndpoint: 'ws://host/devtools'},
        'BROWSER_CONFIG_CONFLICT',
      ],
      [{channel: 'stable', executablePath: 'a.exe'}, 'BROWSER_CONFIG_CONFLICT'],
      [
        {channel: 'stable', browserURL: 'http://host:9222'},
        'BROWSER_CONFIG_CONFLICT',
      ],
      [{browserURL: 'ftp://host'}, 'VALIDATION'],
      [{wsEndpoint: 'http://host'}, 'VALIDATION'],
      [{executablePath: ''}, 'VALIDATION'],
      [{viewport: {width: 0, height: 720}}, 'VALIDATION'],
      [{wsHeaders: {Authorization: 123}}, 'VALIDATION'],
      [{unknownField: true}, 'VALIDATION'],
    ];

    for (const [body, expectedCode] of cases) {
      assert.throws(
        () => parseBrowserConnectBody(body),
        (error: unknown) =>
          error instanceof BrowserConfigRequestError &&
          error.code === expectedCode,
        `expected ${expectedCode} for ${JSON.stringify(body)}`,
      );
    }
  });

  it('returns an empty patch for an empty body', () => {
    assert.deepEqual(parseBrowserConnectBody({}), {});
  });

  it('accepts the ego mode selectors instead of rejecting them as unknown', () => {
    // The schema is a `.strict()` pick(): an unlisted key is a VALIDATION error,
    // so `browser connect --ego` could never work over IPC without these two.
    assert.deepEqual(parseBrowserConnectBody({ego: true}), {ego: true});
    assert.deepEqual(parseBrowserConnectBody({ego: true, keepPage: true}), {
      ego: true,
      keepPage: true,
    });
    assert.deepEqual(
      parseBrowserConnectBody({ego: 'false'}),
      // The two ego-only keys are present at `undefined` on purpose: the store
      // merges shallowly, so a missing key would keep the previous request's
      // `keepPage`/`egoProfile` alive and wedge the switch back to non-ego.
      {ego: false, keepPage: undefined, egoProfile: undefined},
      'the shared boolean preprocessor applies, like cloak',
    );
  });

  it('rejects keepPage without ego over IPC (I1)', () => {
    // The CLI layer already rejected this, but the invariant lived *only* there:
    // a panel or script posting `browser.connect {keepPage:true}` stored it and
    // `ensureBrowser()` then took the local-launch branch, where `keepPage` is
    // never read. Every entry path needs the guard, this one included.
    for (const body of [
      {keepPage: true},
      {ego: false, keepPage: true},
      {channel: 'stable', keepPage: true},
    ]) {
      assert.throws(
        () => parseBrowserConnectBody(body),
        (error: unknown) => {
          assert.ok(
            error instanceof BrowserConfigRequestError,
            `expected BrowserConfigRequestError for ${JSON.stringify(body)}`,
          );
          assert.strictEqual(error.code, 'VALIDATION');
          assert.match(error.message, /keepPage/);
          assert.match(error.message, /ego/);
          return true;
        },
        JSON.stringify(body),
      );
    }
    // `keepPage: false` is not a request to retain anything, so it is harmless
    // alongside a non-ego target.
    assert.deepEqual(parseBrowserConnectBody({keepPage: false}), {
      keepPage: false,
    });
  });

  it('rejects ego together with each mutually exclusive target (I2)', () => {
    // `BROWSER_CONNECT_USAGE` declares `[... | --ego]`; the four target flags and
    // ego are one group. `ensureBrowser()` gives ego priority, so without this
    // the explicitly supplied endpoint/channel would be silently dropped.
    const targets: Array<Record<string, unknown>> = [
      {browserURL: 'http://127.0.0.1:9222'},
      {wsEndpoint: 'ws://127.0.0.1:1/x'},
      {channel: 'stable'},
      {executablePath: 'C:/browser.exe'},
    ];
    for (const target of targets) {
      const body = {ego: true, ...target};
      assert.throws(
        () => parseBrowserConnectBody(body),
        (error: unknown) => {
          assert.ok(
            error instanceof BrowserConfigRequestError,
            `expected BrowserConfigRequestError for ${JSON.stringify(body)}`,
          );
          assert.strictEqual(error.code, 'BROWSER_CONFIG_CONFLICT');
          assert.match(error.message, /ego/);
          assert.match(error.message, /browser-url/);
          assert.match(error.message, /ws-endpoint/);
          return true;
        },
        JSON.stringify(body),
      );
    }
    // `ego: false` does not select the mode, so the same targets stay legal.
    assert.strictEqual(
      parseBrowserConnectBody({ego: false, channel: 'stable'}).channel,
      'stable',
    );
  });
});

describe('parseBrowserDisconnectBody', () => {
  it('accepts absent or literal-boolean force', () => {
    assert.strictEqual(parseBrowserDisconnectBody({}), false);
    assert.strictEqual(parseBrowserDisconnectBody({force: true}), true);
    assert.strictEqual(parseBrowserDisconnectBody({force: false}), false);
  });

  it('rejects non-boolean force and extra keys', () => {
    for (const body of [{force: 'true'}, {force: 1}, {force: true, extra: 1}]) {
      assert.throws(
        () => parseBrowserDisconnectBody(body),
        (error: unknown) =>
          error instanceof BrowserConfigRequestError &&
          error.code === 'VALIDATION',
        `expected VALIDATION for ${JSON.stringify(body)}`,
      );
    }
  });
});

describe('effectiveBrowserConfig', () => {
  afterEach(() => {
    resetRuntimeConfigStore({});
  });

  it('merges runtime store browser overrides over the base config', () => {
    resetRuntimeConfigStore({
      browser: {headless: true, wsEndpoint: 'ws://runtime/devtools'},
    });
    const config = effectiveBrowserConfig();
    assert.strictEqual(config.headless, true);
    assert.strictEqual(config.wsEndpoint, 'ws://runtime/devtools');
  });

  it('rejects a store that only carries keepPage (I1)', () => {
    // `handleBrowserConnect` writes the parsed patch into the store and then
    // reads `effectiveBrowserConfig()`. A store seeded from config.json (or a
    // body that slipped past the request layer) must not be able to smuggle a
    // retention policy in without ego mode.
    resetRuntimeConfigStore({browser: {keepPage: true}});
    assert.throws(
      () => effectiveBrowserConfig(),
      (error: unknown) => {
        assert.ok(error instanceof BrowserConfigInvariantError);
        assert.match(error.message, /keepPage/);
        return true;
      },
    );
  });

  it('keeps an ego + keepPage store config usable', () => {
    resetRuntimeConfigStore({browser: {ego: true, keepPage: true}});
    const config = effectiveBrowserConfig();
    assert.strictEqual(config.ego, true);
    assert.strictEqual(config.keepPage, true);
  });

  it('applies the invariant to the config after the store overlay (B2)', () => {
    // The guard inside `getBrowserManagerConfig()` sees `ego: true` from the env
    // and lets this through; the store overlay then flips it to `ego: false` and
    // leaves `keepPage: true`, i.e. exactly the combination the guard exists to
    // reject. `ensureBrowser()` would take the local-launch branch and never read
    // `keepPage` — the silent ignore, one layer below the fixed one.
    process.env.BROWSER_EGO = 'true';
    try {
      resetRuntimeConfigStore({browser: {ego: false, keepPage: true}});
      assert.throws(
        () => effectiveBrowserConfig(),
        (error: unknown) => {
          assert.ok(error instanceof BrowserConfigInvariantError);
          assert.match(error.message, /keepPage/);
          return true;
        },
      );
    } finally {
      delete process.env.BROWSER_EGO;
      resetRuntimeConfigStore({});
    }
  });

  it('rejects the same shape through the connect candidate (B1/B2)', () => {
    // Same overlay, reached the way the daemon reaches it: a connect patch that
    // flips ego off while an earlier request left keepPage in the store.
    process.env.BROWSER_EGO = 'true';
    try {
      resetRuntimeConfigStore({browser: {ego: true, keepPage: true}});
      assert.throws(
        () => candidateBrowserConfig({ego: false}),
        BrowserConfigInvariantError,
      );
      // ...and the store is untouched by the rejected candidate.
      assert.deepStrictEqual(getRuntimeConfigStore().get().browser, {
        ego: true,
        keepPage: true,
      });
    } finally {
      delete process.env.BROWSER_EGO;
      resetRuntimeConfigStore({});
    }
  });
});

describe('parseBrowserConnectBody with BROWSER_EGO in the environment (B3)', () => {
  afterEach(() => {
    delete process.env.BROWSER_EGO;
  });

  it('accepts {keepPage:true} when the env selects ego', () => {
    // `browsercli browser connect --keep-page` passes the CLI's env-aware check
    // and sends exactly `{keepPage:true}`; the daemon inherits BROWSER_EGO
    // (spawned with no `env` option), so the body alone is not the whole story.
    process.env.BROWSER_EGO = 'true';
    assert.deepStrictEqual(parseBrowserConnectBody({keepPage: true}), {
      keepPage: true,
    });
  });

  it('still rejects {keepPage:true} when the env does not select ego', () => {
    // The body-only reading must not become a blanket allowance: without the env
    // the pair is still the silent no-op the invariant forbids.
    assert.throws(
      () => parseBrowserConnectBody({keepPage: true}),
      (error: unknown) =>
        error instanceof BrowserConfigRequestError &&
        error.code === 'VALIDATION',
    );
    process.env.BROWSER_EGO = 'false';
    assert.throws(() => parseBrowserConnectBody({keepPage: true}));
  });

  it('lets an explicit body ego:false override the env (B3 corollary)', () => {
    // An explicit false in the request is the more specific signal: the merged
    // store value wins over env in `effectiveBrowserConfig()`, so the pair is
    // rejected here rather than left to fail after the write.
    process.env.BROWSER_EGO = 'true';
    assert.throws(
      () => parseBrowserConnectBody({ego: false, keepPage: true}),
      (error: unknown) =>
        error instanceof BrowserConfigRequestError &&
        error.code === 'VALIDATION',
    );
  });
});

describe('candidateBrowserConfig asserts only the final merged config (C1)', () => {
  const savedEgo = process.env.BROWSER_EGO;
  const savedKeepPage = process.env.BROWSER_KEEP_PAGE;

  afterEach(() => {
    if (savedEgo === undefined) delete process.env.BROWSER_EGO;
    else process.env.BROWSER_EGO = savedEgo;
    if (savedKeepPage === undefined) delete process.env.BROWSER_KEEP_PAGE;
    else process.env.BROWSER_KEEP_PAGE = savedKeepPage;
    resetRuntimeConfigStore({});
  });

  it('accepts an env keepPage completed by the request ego (C1)', () => {
    // The regression: the env-layer builder asserted the invariant before the
    // request patch was applied, so `connect --ego` could not rescue
    // BROWSER_KEEP_PAGE=true — the exact advice the error message gives.
    delete process.env.BROWSER_EGO;
    process.env.BROWSER_KEEP_PAGE = 'true';
    resetRuntimeConfigStore({});
    const candidate = candidateBrowserConfig({ego: true});
    assert.strictEqual(candidate.config.ego, true);
    assert.strictEqual(candidate.config.keepPage, true);
    candidate.commit();
    // The request's `ego` was written; `keepPage` stays in the env layer, so the
    // post-commit read is the proof that both halves survive together.
    assert.strictEqual(getRuntimeConfigStore().get().browser?.ego, true);
    assert.strictEqual(effectiveBrowserConfig().keepPage, true);
    assert.strictEqual(effectiveBrowserConfig().ego, true);
  });

  it('accepts a store keepPage completed by the request ego (C1)', () => {
    delete process.env.BROWSER_EGO;
    delete process.env.BROWSER_KEEP_PAGE;
    resetRuntimeConfigStore({browser: {keepPage: true}});
    const candidate = candidateBrowserConfig({ego: true});
    assert.strictEqual(candidate.config.keepPage, true);
    assert.strictEqual(candidate.config.ego, true);
  });

  it('still rejects keepPage when ego is absent from every layer (C1)', () => {
    // The other direction: with no ego in env, store or patch the intermediate
    // and the final object agree, so the rejection must survive the move.
    delete process.env.BROWSER_EGO;
    process.env.BROWSER_KEEP_PAGE = 'true';
    resetRuntimeConfigStore({});
    assert.throws(
      () => candidateBrowserConfig({keepPage: true}),
      BrowserConfigInvariantError,
    );
    // ...and the request layer still refuses it one layer earlier.
    assert.throws(
      () => parseBrowserConnectBody({keepPage: true, ego: undefined}),
      BrowserConfigRequestError,
    );
  });

  it('commit writes the validated object instead of re-merging (loose end 1)', () => {
    // Preview and commit used to be two separate merges, safe only because no
    // `await` sat between them. A writer that sneaks in between them must not
    // change what gets committed: `commit()` stores the object that was
    // validated, byte for byte.
    delete process.env.BROWSER_EGO;
    delete process.env.BROWSER_KEEP_PAGE;
    resetRuntimeConfigStore({});
    const {commit, config} = candidateBrowserConfig({
      ego: true,
      keepPage: true,
    });
    assert.strictEqual(config.ego, true);

    // Stand-in for a future `await` reopening the check-then-act window.
    getRuntimeConfigStore().update({browser: {headless: false}});

    commit();
    // The validated snapshot wins: the interleaved `headless: false` was not
    // merged in, because `commit()` writes the previewed object verbatim.
    assert.deepStrictEqual(getRuntimeConfigStore().get().browser, {
      ego: true,
      keepPage: true,
    });
  });

  it('suppresses env-supplied ego profile/keepPage when connecting to explicit target', () => {
    process.env.BROWSER_EGO_PROFILE = 'Profile 1';
    process.env.BROWSER_KEEP_PAGE = 'true';
    resetRuntimeConfigStore({});
    try {
      const {config} = candidateBrowserConfig({
        browserURL: 'http://127.0.0.1:9222',
      });
      assert.strictEqual(config.browserURL, 'http://127.0.0.1:9222');
      assert.strictEqual(config.egoProfile, undefined);
      assert.strictEqual(config.keepPage, undefined);
    } finally {
      delete process.env.BROWSER_EGO_PROFILE;
      delete process.env.BROWSER_KEEP_PAGE;
      resetRuntimeConfigStore({});
    }
  });

  it('suppresses env-supplied target when connecting to ego', () => {
    process.env.BROWSER_URL = 'http://127.0.0.1:9222';
    resetRuntimeConfigStore({});
    try {
      const {config} = candidateBrowserConfig({
        ego: true,
      });
      assert.strictEqual(config.ego, true);
      assert.strictEqual(config.browserURL, undefined);
    } finally {
      delete process.env.BROWSER_URL;
      resetRuntimeConfigStore({});
    }
  });
});
