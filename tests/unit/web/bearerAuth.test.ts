// tests/unit/web/bearerAuth.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {bearerAuth} from '../../../src/web/middleware/bearerAuth.js';

function mockReq(opts: {remote?: string; auth?: string}) {
  return {
    socket: {remoteAddress: opts.remote ?? '127.0.0.1'},
    headers: opts.auth ? {authorization: opts.auth} : {},
  } as any;
}
function mockRes() {
  const res: any = {statusCode: 200, headers: {}, ended: '', endedBody: ''};
  res.setHeader = (k: string, v: string) => (res.headers[k] = v);
  res.end = (b?: string) => {
    res.ended = 'yes';
    res.endedBody = b ?? '';
  };
  return res;
}

describe('bearerAuth', () => {
  it('loopback + no token => allow', () => {
    const res = mockRes();
    assert.equal(bearerAuth(mockReq({remote: '127.0.0.1'}), res, {bindHost: '127.0.0.1'}), false);
  });
  it('non-loopback + no token => reject 401', () => {
    const res = mockRes();
    assert.equal(bearerAuth(mockReq({remote: '192.168.1.5'}), res, {bindHost: '0.0.0.0', apiToken: 'secret'}), true);
    assert.equal(res.statusCode, 401);
  });
  it('non-loopback + wrong token => reject 401', () => {
    const res = mockRes();
    assert.equal(bearerAuth(mockReq({remote: '192.168.1.5', auth: 'Bearer bad'}), res, {bindHost: '0.0.0.0', apiToken: 'secret'}), true);
    assert.equal(res.statusCode, 401);
  });
  it('non-loopback + correct token => allow', () => {
    const res = mockRes();
    assert.equal(bearerAuth(mockReq({remote: '192.168.1.5', auth: 'Bearer secret'}), res, {bindHost: '0.0.0.0', apiToken: 'secret'}), false);
  });
  it('explicit token set on loopback but missing => reject 401', () => {
    const res = mockRes();
    assert.equal(bearerAuth(mockReq({remote: '127.0.0.1'}), res, {bindHost: '127.0.0.1', apiToken: 'secret'}), true);
    assert.equal(res.statusCode, 401);
  });
});
