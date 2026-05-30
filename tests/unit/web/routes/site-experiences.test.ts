/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, afterEach, describe, it } from 'node:test';

import { siteExperienceService } from '../../../../src/services/SiteExperienceService.js';
import { createSiteExperienceRoutes } from '../../../../src/web/routes/site-experiences.js';
import { RestRouter } from '../../../../src/web/RestRouter.js';
import type { SiteExperience } from '../../../../src/database/schema.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(k: string, v: string): void;
  end(payload: string): void;
  headersSent: boolean;
}

function mockReq(method: string, url: string): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  return e;
}

function mockReqWithBody(method: string, url: string, bodyObj: any): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  
  process.nextTick(() => {
    e.emit('data', Buffer.from(JSON.stringify(bodyObj)));
    e.emit('end');
  });

  return e;
}

function mockRes(): MockRes {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(payload: string) {
      this.body = payload;
      this.headersSent = true;
    },
  };
}

const mockRecord: SiteExperience = {
  id: 1,
  domain: 'test.com',
  name: '测试站点',
  aliases: ['alias.test.com'],
  platformFeatures: 'platform',
  validPatterns: 'patterns',
  knownPitfalls: 'pitfalls',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createSiteExperienceRoutes', () => {
  let router: RestRouter;
  
  // 保存原始方法
  const originalListAll = siteExperienceService.listAll;
  const originalSearch = siteExperienceService.search;
  const originalGetById = siteExperienceService.getById;
  const originalGetByDomain = siteExperienceService.getByDomain;
  const originalCreate = siteExperienceService.create;
  const originalUpdate = siteExperienceService.update;
  const originalDelete = siteExperienceService.delete;

  beforeEach(() => {
    router = new RestRouter();
    router.mount(createSiteExperienceRoutes());
  });

  afterEach(() => {
    // 恢复方法
    siteExperienceService.listAll = originalListAll;
    siteExperienceService.search = originalSearch;
    siteExperienceService.getById = originalGetById;
    siteExperienceService.getByDomain = originalGetByDomain;
    siteExperienceService.create = originalCreate;
    siteExperienceService.update = originalUpdate;
    siteExperienceService.delete = originalDelete;
  });

  it('GET /api/site-experiences returns all records when no query parameters are provided', async () => {
    siteExperienceService.listAll = async () => [mockRecord];

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/site-experiences'),
      res as unknown as ServerResponse,
      '/api/site-experiences',
    );

    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.length, 1);
    assert.strictEqual(parsed.data[0].domain, 'test.com');
  });

  it('GET /api/site-experiences?url=xxx calls search', async () => {
    siteExperienceService.search = async (params) => {
      assert.strictEqual(params.url, 'query.com');
      return [mockRecord];
    };

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/site-experiences?url=query.com'),
      res as unknown as ServerResponse,
      '/api/site-experiences',
    );

    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
  });

  it('GET /api/site-experiences/:id returns specific record', async () => {
    siteExperienceService.getById = async (id) => {
      assert.strictEqual(id, 1);
      return mockRecord;
    };

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/site-experiences/1'),
      res as unknown as ServerResponse,
      '/api/site-experiences/1',
    );

    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.id, 1);
  });

  it('GET /api/site-experiences/:id returns 404 when not found', async () => {
    siteExperienceService.getById = async () => null;

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/site-experiences/999'),
      res as unknown as ServerResponse,
      '/api/site-experiences/999',
    );

    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 404);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'NOT_FOUND');
  });

  it('POST /api/site-experiences creates record successfully', async () => {
    siteExperienceService.getByDomain = async () => null;
    siteExperienceService.create = async (data) => {
      assert.strictEqual(data.domain, 'new.com');
      assert.strictEqual(data.name, '新站点');
      return {
        ...mockRecord,
        id: 2,
        domain: data.domain,
        name: data.name,
      };
    };

    const res = mockRes();
    const req = mockReqWithBody('POST', '/api/site-experiences', {
      domain: 'new.com',
      name: '新站点',
      aliases: [],
    });

    const matched = await router.dispatch(
      req,
      res as unknown as ServerResponse,
      '/api/site-experiences',
    );

    assert.strictEqual(matched, true);
    // 等待异步流执行完
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.id, 2);
    assert.strictEqual(parsed.data.domain, 'new.com');
  });

  it('POST /api/site-experiences returns 409 when domain already exists', async () => {
    siteExperienceService.getByDomain = async () => mockRecord;

    const res = mockRes();
    const req = mockReqWithBody('POST', '/api/site-experiences', {
      domain: 'test.com',
      name: '重复站点',
    });

    const matched = await router.dispatch(
      req,
      res as unknown as ServerResponse,
      '/api/site-experiences',
    );

    assert.strictEqual(matched, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(res.statusCode, 409);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'ALREADY_EXISTS');
  });

  it('PUT /api/site-experiences/:id updates record successfully', async () => {
    siteExperienceService.update = async (id, data) => {
      assert.strictEqual(id, 1);
      assert.strictEqual(data.name, '已更新名字');
      return {
        ...mockRecord,
        name: '已更新名字',
      };
    };

    const res = mockRes();
    const req = mockReqWithBody('PUT', '/api/site-experiences/1', {
      name: '已更新名字',
    });

    const matched = await router.dispatch(
      req,
      res as unknown as ServerResponse,
      '/api/site-experiences/1',
    );

    assert.strictEqual(matched, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.name, '已更新名字');
  });

  it('DELETE /api/site-experiences/:id deletes record successfully', async () => {
    siteExperienceService.delete = async (id) => {
      assert.strictEqual(id, 1);
      return true;
    };

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('DELETE', '/api/site-experiences/1'),
      res as unknown as ServerResponse,
      '/api/site-experiences/1',
    );

    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.id, 1);
  });
});
