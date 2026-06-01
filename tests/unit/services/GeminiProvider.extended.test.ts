/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { GeminiProvider } from '../../../src/services/GeminiProvider.js';

interface GeminiProviderHarness {
  cliAvailable?: boolean;
  cliPath: string;
  chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<{ content: string; usage?: unknown }>;
  analyzeImage(imageInput: string, prompt: string, isFilePath?: boolean): Promise<string>;
  formatMessagesForCLI(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string;
  parseCliOutput(output: string): string;
  handleError(error: unknown): Error;
  executeCLI(prompt: string, options?: { model?: string; temperature?: number; maxTokens?: number }, imagePath?: string): Promise<string>;
  checkCLIAvailable(): boolean;
}

interface GeminiProviderConstructor {
  cliAvailabilityCache: Map<string, boolean>;
}

type TimeoutLike = ReturnType<typeof setTimeout>;
type TimeoutCallback = (...args: []) => void;
type TimerOverride = (callback: TimeoutCallback, ms?: number) => TimeoutLike;

function makeCliScript(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe('GeminiProvider extended', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('covers CLI chat success and helper methods', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-ok-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-ok.sh',
      `
if [ "$1" = "--version" ]; then
  echo "1.0.0"
  exit 0
fi
echo "  OK_RESPONSE  "
exit 0
`
    );

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as unknown as GeminiProviderHarness;
    provider.cliAvailable = true;
    const chat = await provider.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
      { model: 'gemini-test', temperature: 0.2, maxTokens: 123 }
    );

    assert.strictEqual(chat.content, 'OK_RESPONSE');
    assert.strictEqual(chat.usage, undefined);
    assert.ok(provider.formatMessagesForCLI([{ role: 'user', content: 'x' }]).includes('User: x'));
    assert.strictEqual(provider.parseCliOutput('  hi\n'), 'hi');
    assert.strictEqual(provider.handleError('x').message.includes('Unknown error'), true);
  });

  it('covers analyzeImage CLI success and file-not-found error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-img-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-img.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "IMAGE_OK"
exit 0
`
    );
    const img = join(dir, 'a.png');
    writeFileSync(img, 'x');

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false });
    const providerHarness = provider as unknown as GeminiProviderHarness;
    providerHarness.cliAvailable = true;
    const ok = await provider.analyzeImage(img, 'describe', true);
    assert.strictEqual(ok, 'IMAGE_OK');

    await assert.rejects(
      async () => provider.analyzeImage(join(dir, 'missing.png'), 'describe', true),
      /Image file not found/
    );
  });

  it('covers executeCLI non-zero exit and cached CLI availability branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-fail-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-fail.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "bad stderr" 1>&2
exit 2
`
    );

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as unknown as GeminiProviderHarness;
    await assert.rejects(async () => provider.executeCLI('prompt'), /exited with code 2/);

    provider.cliAvailable = true;
    provider.cliPath = '/definitely/not/exist';
    assert.strictEqual(provider.checkCLIAvailable(), true);
  });

  it('uses static CLI availability cache across instances', () => {
    const cache = (GeminiProvider as unknown as GeminiProviderConstructor).cliAvailabilityCache;
    cache.set('/tmp/fake-cli', true);

    const provider = new GeminiProvider({ cliPath: '/tmp/fake-cli', useAPI: false }) as unknown as GeminiProviderHarness;
    provider.cliAvailable = undefined;
    assert.strictEqual(provider.checkCLIAvailable(), true);
  });

  it('covers chatCLI/analyzeImageCLI catch branch by throwing non-Error from executeCLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-catch-'));
    tempDirs.push(dir);
    const img = join(dir, 'a.png');
    writeFileSync(img, 'x');

    const provider = new GeminiProvider({ cliPath: 'gemini-cli', useAPI: false }) as unknown as GeminiProviderHarness;
    provider.checkCLIAvailable = () => true;
    provider.executeCLI = async () => {
      throw 'cli-unknown';
    };

    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'x' }]),
      /Unknown error: cli-unknown/,
    );
    await assert.rejects(
      async () => provider.analyzeImage(img, 'x', true),
      /Unknown error: cli-unknown/,
    );
  });

  it('covers executeCLI spawn error branch', async () => {
    const provider = new GeminiProvider({ cliPath: '/definitely/not-exists-cli', useAPI: false }) as unknown as GeminiProviderHarness;
    await assert.rejects(
      async () => provider.executeCLI('prompt'),
      /Failed to execute gemini-cli:/,
    );
  });

  it('covers checkCLIAvailable catch path when spawnSync throws', () => {
    const provider = new GeminiProvider({ cliPath: '\u0000', useAPI: false }) as unknown as GeminiProviderHarness;
    provider.cliAvailable = undefined;
    assert.strictEqual(provider.checkCLIAvailable(), false);
  });

  it('covers executeCLI timeout callback no-op when already settled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-timeout-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-timeout.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "DONE"
exit 0
`,
    );
    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as unknown as GeminiProviderHarness;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutCallback: (() => void) | undefined;
    globalThis.setTimeout = ((cb: TimeoutCallback, _ms?: number) => {
      timeoutCallback = () => cb();
      return originalSetTimeout(() => undefined, 0);
    }) as TimerOverride as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((_: TimeoutLike | undefined) => undefined) as typeof globalThis.clearTimeout;

    try {
      const out = await provider.executeCLI('prompt');
      assert.strictEqual(out, 'DONE');
      assert.ok(timeoutCallback);
      timeoutCallback?.();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('covers executeCLI timeout rejection path', async () => {
    const provider = new GeminiProvider({ cliPath: '/bin/sh', useAPI: false }) as unknown as GeminiProviderHarness;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((cb: TimeoutCallback, _ms?: number) => {
      cb();
      return originalSetTimeout(() => undefined, 0);
    }) as TimerOverride as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((_: TimeoutLike | undefined) => undefined) as typeof globalThis.clearTimeout;

    try {
      await assert.rejects(
        async () => provider.executeCLI('while true; do :; done'),
        /timed out after 60 seconds/,
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  describe('GeminiProvider API mode', () => {
    it('covers API chat success', async () => {
      const originalFetch = globalThis.fetch;
      
      const mockFetchResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'API response text' }]
            }
          }
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 34,
          totalTokenCount: 46
        }
      };

      let requestedUrl = '';
      let requestedBody: any = null;

      globalThis.fetch = (async (url: string, options: any) => {
        requestedUrl = url;
        requestedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => mockFetchResponse,
        } as Response;
      }) as any;

      try {
        const provider = new GeminiProvider({ apiKey: 'mock-gemini-key', useAPI: true, model: 'gemini-1.5-pro' });
        const res = await provider.chat([
          { role: 'system', content: 'system-instruction' },
          { role: 'user', content: 'hello' }
        ], { temperature: 0.5, maxTokens: 100 });

        assert.strictEqual(res.content, 'API response text');
        assert.deepStrictEqual(res.usage, {
          promptTokens: 12,
          completionTokens: 34,
          totalTokens: 46
        });
        assert.ok(requestedUrl.includes('gemini-1.5-pro'));
        assert.ok(requestedUrl.includes('key=mock-gemini-key'));
        assert.deepStrictEqual(requestedBody.systemInstruction, {
          parts: [{ text: 'system-instruction' }]
        });
        assert.deepStrictEqual(requestedBody.contents, [
          { role: 'user', parts: [{ text: 'hello' }] }
        ]);
        assert.strictEqual(requestedBody.generationConfig.temperature, 0.5);
        assert.strictEqual(requestedBody.generationConfig.maxOutputTokens, 100);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('covers API chat error and empty response paths', async () => {
      const originalFetch = globalThis.fetch;

      // 1. Error path
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Error',
          text: async () => 'Error payload details',
        } as Response;
      }) as any;

      try {
        const provider = new GeminiProvider({ apiKey: 'mock-gemini-key', useAPI: true });
        await assert.rejects(
          async () => provider.chat([{ role: 'user', content: 'hello' }]),
          /Gemini API error: 500 Internal Error/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }

      // 2. Empty response path
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ candidates: [] }),
        } as Response;
      }) as any;

      try {
        const provider = new GeminiProvider({ apiKey: 'mock-gemini-key', useAPI: true });
        await assert.rejects(
          async () => provider.chat([{ role: 'user', content: 'hello' }]),
          /No response content from Gemini API/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('covers API analyzeImage success with file path and base64', async () => {
      const originalFetch = globalThis.fetch;

      let requestedBody: any = null;

      globalThis.fetch = (async (url: string, options: any) => {
        requestedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'image analysis text' }]
                }
              }
            ]
          }),
        } as Response;
      }) as any;

      try {
        const provider = new GeminiProvider({ apiKey: 'mock-gemini-key', useAPI: true });
        
        // Test base64 format imageInput
        const res1 = await provider.analyzeImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'describe this');
        assert.strictEqual(res1, 'image analysis text');
        assert.strictEqual(requestedBody.contents[0].parts[0].inlineData.mimeType, 'image/png');
        assert.strictEqual(requestedBody.contents[0].parts[0].inlineData.data, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
        assert.strictEqual(requestedBody.contents[0].parts[1].text, 'describe this');

        // Test normal base64 format imageInput without header
        const res2 = await provider.analyzeImage('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'describe this');
        assert.strictEqual(res2, 'image analysis text');
        assert.strictEqual(requestedBody.contents[0].parts[0].inlineData.mimeType, 'image/png'); // defaults to png

        // Test invalid data URL
        await assert.rejects(
          async () => provider.analyzeImage('data:invalid', 'describe this'),
          /Invalid data URL format/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
