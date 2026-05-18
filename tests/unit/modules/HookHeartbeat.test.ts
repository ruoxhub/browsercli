import assert from 'node:assert';
import {describe, it, afterEach} from 'node:test';
import {EventEmitter} from 'node:events';

import {HookHeartbeat} from '../../../src/modules/hook/HookHeartbeat.js';

class MockFrame extends EventEmitter {
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
}

class MockPage extends EventEmitter {
  readonly mainFrame = new MockFrame('https://example.com');
  private closed = false;
  evaluateCalls: string[] = [];

  async evaluate(script: string): Promise<void> {
    if (this.closed) throw new Error('Page closed');
    this.evaluateCalls.push(script);
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }
}

describe('HookHeartbeat', () => {
  let heartbeat: HookHeartbeat;
  let page: MockPage;

  afterEach(() => {
    heartbeat?.stop();
  });

  it('should re-inject hook script after framenavigated event', async () => {
    page = new MockPage();
    const hookScript = 'console.log("hook injected")';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    page.emit('framenavigated', page.mainFrame);

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 1);
    assert.strictEqual(page.evaluateCalls[0], hookScript);
  });

  it('should debounce rapid navigations', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    for (let i = 0; i < 5; i++) {
      page.emit('framenavigated', page.mainFrame);
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 1);
  });

  it('should not inject after stop() is called', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();
    heartbeat.stop();

    page.emit('framenavigated', page.mainFrame);
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 0);
  });

  it('should not throw if page is closed during injection', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    page.close();
    page.emit('framenavigated', page.mainFrame);

    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(page.evaluateCalls.length, 0);
  });

  it('should auto-stop when page closes', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    page.close();

    page.emit('framenavigated', page.mainFrame);
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 0);
    assert.strictEqual(heartbeat.isActive(), false);
  });
});
