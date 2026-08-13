import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {describe, it} from 'node:test';

import {TargetSessionRouter} from '../../../src/modules/browser/TargetSessionRouter.js';

class FakeRootSession extends EventEmitter {
  readonly sent: Array<{method: string; params: Record<string, unknown>}> = [];

  async send(method: string, params: Record<string, unknown>): Promise<object> {
    this.sent.push({method, params});
    return {};
  }

  lastChildMessage(): {id: number; method: string} {
    const raw = this.sent.at(-1)?.params.message;
    assert.equal(typeof raw, 'string');
    return JSON.parse(raw as string) as {id: number; method: string};
  }

  receive(sessionId: string, message: object): void {
    this.emit('Target.receivedMessageFromTarget', {
      sessionId,
      message: JSON.stringify(message),
    });
  }
}

describe('TargetSessionRouter', () => {
  it('routes child responses and events by session', async () => {
    const root = new FakeRootSession();
    const router = new TargetSessionRouter(root as never, 100);
    router.registerSession('session-1', 'target-1');
    let eventValue = 0;
    router.on('session-1', 'Debugger.scriptParsed', params => {
      eventValue = params.value as number;
    });
    root.receive('session-2', {
      method: 'Debugger.scriptParsed',
      params: {value: 1},
    });
    root.receive('session-1', {
      method: 'Debugger.scriptParsed',
      params: {value: 2},
    });
    assert.equal(eventValue, 2);

    const pending = router.send<{scriptSource: string}>(
      'session-1',
      'Debugger.getScriptSource',
      {scriptId: '7'},
    );
    const outbound = root.lastChildMessage();
    root.receive('session-1', {
      id: outbound.id,
      result: {scriptSource: 'self.answer = 42;'},
    });
    assert.deepEqual(await pending, {scriptSource: 'self.answer = 42;'});
    router.dispose();
  });

  it('consumes an early-detach tombstone during registration', () => {
    const root = new FakeRootSession();
    const router = new TargetSessionRouter(root as never, 100);
    root.emit('Target.detachedFromTarget', {sessionId: 'early'});
    assert.throws(
      () => router.registerSession('early', 'target-1'),
      /dump_target_scripts/,
    );
    assert.equal(root.sent.length, 0);
    router.dispose();
  });

  it('rejects protocol errors, detach, timeout, duplicates, and root close', async () => {
    const root = new FakeRootSession();
    const router = new TargetSessionRouter(root as never, 5);
    router.registerSession('s1', 't1');
    assert.throws(
      () => router.registerSession('s1', 't2'),
      /Duplicate sessionId/,
    );
    assert.throws(
      () => router.registerSession('s2', 't1'),
      /Duplicate targetId/,
    );

    const protocol = router.send('s1', 'Debugger.enable');
    root.receive('s1', {
      id: root.lastChildMessage().id,
      error: {code: -1, message: 'denied'},
    });
    await assert.rejects(protocol, /denied/);

    const detached = router.send('s1', 'Debugger.enable');
    root.emit('Target.detachedFromTarget', {sessionId: 's1'});
    await assert.rejects(detached, /Session closed/);

    router.registerSession('s2', 't2');
    await assert.rejects(router.send('s2', 'Debugger.enable'), /Timed out/);
    const closed = router.send('s2', 'Debugger.enable');
    root.emit('close');
    await assert.rejects(closed, /Connection closed/);
    assert.equal(root.listenerCount('close'), 0);
    router.dispose();
  });
});
