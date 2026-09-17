/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import test, {describe} from 'node:test';

import {
  ExtensionCDPSession,
  ExtensionSessionManager,
  generateNativeHostManifest,
  getNativeHostPaths,
  JsonRpcPeer,
  NativeMessagingHost,
} from '../../../../src/modules/extension/index.js';
import type {
  JsonRpcMessage,
  TransportSender,
} from '../../../../src/modules/extension/index.js';

describe('Extension Connector - JSON-RPC Peer', () => {
  test('should handle request-response roundtrip successfully', async () => {
    let sentMsg: JsonRpcMessage | null = null;
    const transport: TransportSender = {
      send(msg) {
        sentMsg = msg;
      },
    };

    const peer = new JsonRpcPeer(transport);

    const promise = peer.sendRequest<{value: string}>('testMethod', {
      foo: 'bar',
    });
    assert.ok(sentMsg);
    assert.strictEqual((sentMsg as any).method, 'testMethod');
    assert.strictEqual((sentMsg as any).params.foo, 'bar');

    const reqId = (sentMsg as any).id;

    // Simulate response
    await peer.handleMessage({
      jsonrpc: '2.0',
      id: reqId,
      result: {value: 'success'},
    });

    const result = await promise;
    assert.deepStrictEqual(result, {value: 'success'});
    peer.close();
  });

  test('should handle request timeout', async () => {
    const transport: TransportSender = {
      send() {
        // noop
      },
    };
    const peer = new JsonRpcPeer(transport);

    await assert.rejects(async () => {
      await peer.sendRequest('slowMethod', {}, 50);
    }, /timed out/);
    peer.close();
  });

  test('should dispatch notifications to registered handlers', async () => {
    const transport: TransportSender = {
      send() {
        // noop
      },
    };
    const peer = new JsonRpcPeer(transport);

    let receivedData: any = null;
    const unsub = peer.onNotification('onCustomEvent', data => {
      receivedData = data;
    });

    await peer.handleMessage({
      jsonrpc: '2.0',
      method: 'onCustomEvent',
      params: {num: 42},
    });

    assert.deepStrictEqual(receivedData, {num: 42});
    unsub();
    peer.close();
  });
});

describe('Extension Connector - NativeMessagingHost Protocol', () => {
  test('should frame and deframe 4-byte LE length prefix messages correctly', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const host = new NativeMessagingHost({input, output});

    const receivedMessages: any[] = [];
    host.on('message', msg => {
      receivedMessages.push(msg);
    });

    const payload = {jsonrpc: '2.0', id: 1, method: 'ping'};
    const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(jsonBuf.length, 0);

    // Write chunked data to simulate network stream
    input.write(header);
    input.write(jsonBuf.subarray(0, 5));
    input.write(jsonBuf.subarray(5));

    assert.strictEqual(receivedMessages.length, 1);
    assert.deepStrictEqual(receivedMessages[0], payload);

    // Test send() creates valid 4-byte prefix
    const outChunks: Buffer[] = [];
    output.on('data', chunk => {
      outChunks.push(chunk);
    });

    host.send({jsonrpc: '2.0', id: 2, result: {ok: true}});
    const fullOut = Buffer.concat(outChunks);
    const outLen = fullOut.readUInt32LE(0);
    const outJson = fullOut.subarray(4, 4 + outLen).toString('utf8');
    assert.deepStrictEqual(JSON.parse(outJson), {
      jsonrpc: '2.0',
      id: 2,
      result: {ok: true},
    });

    host.close();
  });
});

describe('Extension Connector - ExtensionSessionManager & CDPSession', () => {
  test('should manage tabs and proxy CDP commands', async () => {
    ExtensionSessionManager.resetInstance();
    const manager = ExtensionSessionManager.getInstance();

    assert.strictEqual(manager.isConnected(), false);

    const transport: TransportSender = {
      send(msg) {
        if ('id' in msg && 'method' in msg) {
          const req = msg as any;
          if (req.method === 'ping') {
            peer.handleMessage({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                status: 'ok',
                attachedTabs: [],
                claimedTabs: [],
                timestamp: 12345,
              },
            });
          } else if (req.method === 'claimUserTab') {
            peer.handleMessage({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                success: true,
                tabId: req.params.tabId,
                title: 'Test Tab',
                url: 'https://example.com',
              },
            });
          } else if (req.method === 'executeCdp') {
            peer.handleMessage({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                cookies: [{name: 'session_id', value: 'secret123'}],
              },
            });
          }
        }
      },
    };

    const peer = new JsonRpcPeer(transport);
    manager.setPeer(peer);
    assert.strictEqual(manager.isConnected(), true);

    const ping = await manager.ping();
    assert.strictEqual(ping.status, 'ok');

    const claimRes = await manager.claimTab(101);
    assert.strictEqual(claimRes.tabId, 101);
    assert.deepStrictEqual(manager.getClaimedTabs(), [101]);

    // Create ExtensionCDPSession for tab 101
    const cdpSession = new ExtensionCDPSession(101, manager);

    let eventFired = false;
    cdpSession.on('Network.responseReceived', params => {
      eventFired = true;
      assert.strictEqual((params as any).requestId, 'req-001');
    });

    // Simulate incoming CDP event notification from browser
    await peer.handleMessage({
      jsonrpc: '2.0',
      method: 'onCDPEvent',
      params: {
        tabId: 101,
        method: 'Network.responseReceived',
        params: {requestId: 'req-001'},
      },
    });

    assert.strictEqual(eventFired, true);

    // Test CDP send command
    const cookiesRes = await cdpSession.send<{cookies: any[]}>(
      'Network.getCookies',
    );
    assert.strictEqual(cookiesRes.cookies[0].value, 'secret123');

    ExtensionSessionManager.resetInstance();
  });
});

describe('Extension Connector - NativeHostManifest', () => {
  test('should generate valid manifest object', () => {
    const manifest: any = generateNativeHostManifest('/path/to/script.cmd', [
      'chrome-extension://my-id/',
    ]);
    assert.strictEqual(manifest.name, 'com.proxycli.reverserextension');
    assert.strictEqual(manifest.path, '/path/to/script.cmd');
    assert.strictEqual(manifest.type, 'stdio');
    assert.deepStrictEqual(manifest.allowed_origins, [
      'chrome-extension://my-id/',
    ]);

    const paths = getNativeHostPaths();
    assert.ok(paths.configDir.length > 0);
    assert.ok(
      paths.manifestPath.endsWith('com.proxycli.reverserextension.json'),
    );
  });
});
