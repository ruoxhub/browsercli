/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {preprocessArgv, runCli} from '../../../src/cli/cli.js';
import {CLI_VERSION, type DaemonLike} from '../../../src/cli/daemonClient.js';
import {
  makePipePath,
  type SessionConfig,
} from '../../../src/cli/sessionPaths.js';

function createCapture() {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode: number | undefined;
  return {
    out,
    err,
    get exitCode() {
      return exitCode;
    },
    deps: {
      stdout: (m: string) => out.push(m),
      stderr: (m: string) => err.push(m),
      exit: (code: number) => {
        exitCode = code;
      },
    },
  };
}

describe('yargs CLI entry (chrome-devtools style)', () => {
  it('preprocessArgv shields `--` / lone `-`', () => {
    const shielded = preprocessArgv([
      'evaluate_script',
      '--',
      '() => --not-a-flag',
      '-x',
    ]);
    assert.equal(shielded.restore(shielded.argv[1]), '() => --not-a-flag');
    assert.equal(shielded.restore(shielded.argv[2]), '-x');

    const loneDash = preprocessArgv(['evaluate_script', '-']);
    assert.equal(loneDash.restore(loneDash.argv[1]), '-');
  });

  it('dispatches direct top-level tool commands with leading `-s`', async () => {
    const calls: Array<{
      session: string;
      method: string;
      params?: Record<string, unknown>;
    }> = [];
    const cap = createCapture();

    const makeFakeConnect = (session: string): Promise<DaemonLike> =>
      Promise.resolve({
        async request<T>(
          method: string,
          params?: Record<string, unknown>,
        ): Promise<T> {
          calls.push({session, method, params});
          return {
            structuredContent: {success: true, message: 'done', data: {ok: 1}},
          } as T;
        },
        onEvent: () => () => undefined,
        close: () => undefined,
      });

    const code1 = await runCli(
      [
        '-s=work',
        'evaluate_script',
        '--function',
        '() => 1',
        '--output-format',
        'md',
      ],
      {...cap.deps, connect: s => makeFakeConnect(s)},
    );
    assert.equal(code1, 0);
    assert.match(cap.out.join('\n'), /# evaluate_script/);
    assert.equal(calls[0]?.session, 'work');
    assert.deepEqual(calls[0]?.params, {
      tool: 'evaluate_script',
      params: {function: '() => 1'},
    });

    const code2 = await runCli(
      ['evaluate-script', '--', '() => --x', '--json'],
      {...cap.deps, connect: s => makeFakeConnect(s)},
    );
    assert.equal(code2, 0);
    assert.deepEqual(calls[1]?.params, {
      tool: 'evaluate_script',
      params: {function: '() => --x --json'},
    });

    const capDefault = createCapture();
    const code3 = await runCli(['evaluate_script', '--function', '() => 1'], {
      ...capDefault.deps,
      connect: s => makeFakeConnect(s),
    });
    assert.equal(code3, 0);
    assert.match(capDefault.out.join('\n'), /# evaluate_script/);
    assert.match(capDefault.out.join('\n'), /ok: 1/);
    assert.doesNotMatch(capDefault.out.join('\n'), /```json/);

    const capToonFlag = createCapture();
    const code4 = await runCli(
      ['evaluate_script', '--function', '() => 1', '--toon'],
      {...capToonFlag.deps, connect: s => makeFakeConnect(s)},
    );
    assert.equal(code4, 0);
    assert.match(capToonFlag.out.join('\n'), /ok: 1/);
  });

  it('supports chrome-devtools style positional args alongside backward-compatible flags', async () => {
    const calls: Array<{
      session: string;
      method: string;
      params?: Record<string, unknown>;
    }> = [];

    const makeFakeConnect = (session: string): Promise<DaemonLike> =>
      Promise.resolve({
        async request<T>(
          method: string,
          params?: Record<string, unknown>,
        ): Promise<T> {
          calls.push({session, method, params});
          return {
            structuredContent: {success: true, message: 'ok', data: {ok: 1}},
          } as T;
        },
        onEvent: () => () => undefined,
        close: () => undefined,
      });

    const cases: Array<{
      argv: string[];
      tool: string;
      params: Record<string, unknown>;
      session?: string;
    }> = [
      {argv: ['select_page', '1'], tool: 'select_page', params: {pageId: '1'}},
      {
        argv: ['-s', 'work', 'select_page', '2', '--bringToFront', 'false'],
        tool: 'select_page',
        params: {pageId: '2', bringToFront: false},
        session: 'work',
      },
      {
        argv: ['select_page', '--pageIdx', '3'],
        tool: 'select_page',
        params: {pageIdx: 3},
      },
      {
        argv: ['close_page', '2'],
        tool: 'close_page',
        params: {pageId: '2'},
      },
      {
        argv: ['close_page', 'page-5'],
        tool: 'close_page',
        params: {pageId: 'page-5'},
      },
      {
        argv: ['new_page', 'https://example.com', '--background', 'true'],
        tool: 'new_page',
        params: {url: 'https://example.com', background: true},
      },
      {
        argv: ['new_page', '--url', 'https://example.com'],
        tool: 'new_page',
        params: {url: 'https://example.com'},
      },
      {
        argv: ['resize_page', '1280', '720'],
        tool: 'resize_page',
        params: {width: 1280, height: 720},
      },
      {
        argv: ['resize_page', '1280', '720', '--pageId', '2'],
        tool: 'resize_page',
        params: {width: 1280, height: 720, pageId: '2'},
      },
      {
        argv: ['click', '1_4', '--dblClick', 'true'],
        tool: 'click',
        params: {uid: '1_4', dblClick: true},
      },
      {
        argv: ['click', '1_4', '--pageId', '2'],
        tool: 'click',
        params: {uid: '1_4', pageId: '2'},
      },
      {
        argv: ['navigate_page', 'https://example.com', '--pageId', '2'],
        tool: 'navigate_page',
        params: {url: 'https://example.com', pageId: '2'},
      },
      {
        argv: ['take_snapshot', '--pageId', '2'],
        tool: 'take_snapshot',
        params: {pageId: '2'},
      },
      {
        argv: ['take_snapshot', '--pageId', 'page-2'],
        tool: 'take_snapshot',
        params: {pageId: 'page-2'},
      },
      {
        argv: ['click', 'button#submit'],
        tool: 'click',
        params: {selector: 'button#submit'},
      },
      {
        argv: ['fill', '1_4', '--not-a-flag'],
        tool: 'fill',
        params: {uid: '1_4', value: '--not-a-flag'},
      },
      {
        argv: ['fill', '--uid', '1_4', 'hello'],
        tool: 'fill',
        params: {uid: '1_4', value: 'hello'},
      },
      {
        argv: ['drag', '1_2', '1_5'],
        tool: 'drag',
        params: {fromUid: '1_2', toUid: '1_5'},
      },
      {
        argv: ['click_at', '100', '200'],
        tool: 'click_at',
        params: {x: 100, y: 200},
      },
      {
        argv: ['click_at', '1_4'],
        tool: 'click_at',
        params: {uid: '1_4'},
      },
      {
        argv: ['upload_file', '1_4', './a.png'],
        tool: 'upload_file',
        params: {uid: '1_4', filePath: './a.png'},
      },
      {
        argv: ['upload_file', '1_4', './a.png', './b.png'],
        tool: 'upload_file',
        params: {uid: '1_4', filePaths: ['./a.png', './b.png']},
      },
      {
        argv: ['navigate_page', 'https://example.com'],
        tool: 'navigate_page',
        params: {url: 'https://example.com'},
      },
      {
        argv: ['navigate_page', 'reload', '--ignoreCache', 'true'],
        tool: 'navigate_page',
        params: {type: 'reload', ignoreCache: true},
      },
      {
        argv: ['wait_for', 'Hello', 'World', '--timeout', '3000'],
        tool: 'wait_for',
        params: {text: ['Hello', 'World'], timeout: 3000},
      },
      {
        argv: ['wait_for', '--text', '["Hello","World"]'],
        tool: 'wait_for',
        params: {text: ['Hello', 'World']},
      },
      {
        argv: ['get_network_request', '12'],
        tool: 'get_network_request',
        params: {reqid: 12},
      },
      {
        argv: ['get_script_source', '42', '--filePath', '/tmp/s.js'],
        tool: 'get_script_source',
        params: {scriptId: '42', filePath: '/tmp/s.js'},
      },
    ];

    for (const tc of cases) {
      calls.length = 0;
      const cap = createCapture();
      const code = await runCli(tc.argv, {
        ...cap.deps,
        connect: s => makeFakeConnect(s),
      });
      assert.equal(
        code,
        0,
        `expected exit 0 for ${JSON.stringify(tc.argv)}, stderr=${cap.err.join('\n')}`,
      );
      if (tc.session) {
        assert.equal(calls[0]?.session, tc.session);
      }
      assert.deepEqual(
        calls[0]?.params,
        {tool: tc.tool, params: tc.params},
        `mismatch for ${JSON.stringify(tc.argv)}`,
      );
    }
  });

  it('reports COMMAND_DEPRECATED for retired commands (open/close/list/kill-all/browser)', async () => {
    for (const [cmd, expected] of [
      ['open', 'browsercli start'],
      ['close', 'browsercli stop'],
      ['list', 'browsercli status'],
      ['kill-all', 'browsercli stop --all'],
      ['browser', 'browsercli start'],
    ] as const) {
      const cap = createCapture();
      const code = await runCli([cmd], cap.deps);
      assert.equal(code, 1);
      assert.match(cap.err.join('\n'), /COMMAND_DEPRECATED/);
      assert.ok(cap.err.join('\n').includes(expected));
    }
  });

  describe('status and stop against a live fake daemon socket', () => {
    const daemonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-cli-live-'));
    const session = `live-${process.pid}`;
    let server: net.Server;
    let socketPath: string;

    before(async () => {
      socketPath = makePipePath(crypto.randomBytes(8).toString('hex'), session);
      server = net.createServer(sock => {
        let buf = '';
        sock.on('data', chunk => {
          buf += chunk.toString();
          let idx = buf.indexOf('\n');
          while (idx !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line) {
              const msg = JSON.parse(line) as {id: number; method: string};
              const result =
                msg.method === 'browser.status'
                  ? {connected: true, mode: 'launch', pages: 2}
                  : msg.method === 'stop'
                    ? {stopped: true}
                    : {protocol: 1, version: CLI_VERSION, pid: 999_999};
              sock.write(`${JSON.stringify({id: msg.id, result})}\n`);
            }
            idx = buf.indexOf('\n');
          }
        });
      });
      await new Promise<void>(r => server.listen(socketPath, r));
      fs.writeFileSync(
        path.join(daemonDir, `${session}.session`),
        JSON.stringify({
          name: session,
          version: CLI_VERSION,
          protocol: 1,
          timestamp: Date.now(),
          socketPath,
          pid: 999_999,
        } satisfies SessionConfig),
      );
    });

    after(async () => {
      server.close();
      if (process.platform !== 'win32') {
        await fs.promises.unlink(socketPath).catch(() => undefined);
      }
      fs.rmSync(daemonDir, {recursive: true, force: true});
    });

    it('status --json returns live session and browser status', async () => {
      const cap = createCapture();
      const code = await runCli(['-s', session, 'status', '--json'], {
        ...cap.deps,
        daemonDir,
      });
      assert.equal(code, 0);
      const data = JSON.parse(cap.out.join('\n')) as {
        online: boolean;
        browser: {connected: boolean; pages: number};
      };
      assert.equal(data.online, true);
      assert.equal(data.browser.connected, true);
      assert.equal(data.browser.pages, 2);
    });

    it('stop stops the running session cleanly', async () => {
      const cap = createCapture();
      const code = await runCli(['-s', session, 'stop', '--json'], {
        ...cap.deps,
        daemonDir,
      });
      assert.equal(code, 0);
      const data = JSON.parse(cap.out.join('\n')) as {stopped: boolean};
      assert.equal(data.stopped, true);
    });
  });
});
