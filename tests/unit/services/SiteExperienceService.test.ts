
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SiteExperienceService 单元测试
 */
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';

import { DatabaseService } from '../../../src/services/DatabaseService.js';
import { SiteExperienceService } from '../../../src/services/SiteExperienceService.js';

describe('SiteExperienceService', () => {
  let dbService: DatabaseService;
  let service: SiteExperienceService;
  const testDbUrl = 'postgresql://postgres:postgres@localhost:5432/js_reverse_mcp_test';

  before(async () => {
    // 跳过测试如果数据库不可用
    try {
      dbService = new DatabaseService();
      await dbService.connect(testDbUrl);
      await dbService.migrate();
      service = new SiteExperienceService();
    } catch {
      console.warn('PostgreSQL not available, skipping SiteExperienceService tests');
    }
  });

  after(async () => {
    if (dbService) {
      await dbService.disconnect();
    }
  });

  it('should create a site experience', async () => {
    if (!service) return;

    const result = await service.create({
      domain: 'example.com',
      name: 'Example Site',
      aliases: ['示例', 'Example'],
      platformFeatures: 'Platform features description',
      validPatterns: 'Valid patterns description',
      knownPitfalls: 'Known pitfalls description',
    });

    assert.ok(result.id);
    assert.strictEqual(result.domain, 'example.com');
    assert.strictEqual(result.name, 'Example Site');

    // Cleanup
    await service.delete(result.id);
  });

  it('should search by domain', async () => {
    if (!service) return;

    const created = await service.create({
      domain: 'test-example.com',
      name: 'Test Example',
    });

    const results = await service.search({ url: 'https://test-example.com/page' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].domain, 'test-example.com');

    await service.delete(created.id);
  });

  it('should search by name', async () => {
    if (!service) return;

    const created = await service.create({
      domain: 'search-test.com',
      name: 'Search Test Site',
    });

    const results = await service.search({ name: 'Search Test' });
    assert.ok(results.length > 0);

    await service.delete(created.id);
  });

  it('should update a site experience', async () => {
    if (!service) return;

    const created = await service.create({
      domain: 'update-test.com',
      name: 'Update Test',
    });

    const updated = await service.update(created.id, {
      name: 'Updated Name',
      platformFeatures: 'New features',
    });

    assert.ok(updated);
    assert.strictEqual(updated?.name, 'Updated Name');
    assert.strictEqual(updated?.platformFeatures, 'New features');

    await service.delete(created.id);
  });

  it('should delete a site experience', async () => {
    if (!service) return;

    const created = await service.create({
      domain: 'delete-test.com',
      name: 'Delete Test',
    });

    const deleted = await service.delete(created.id);
    assert.strictEqual(deleted, true);

    const found = await service.getById(created.id);
    assert.strictEqual(found, null);
  });

  it('should return null for non-existent ID', async () => {
    if (!service) return;

    const result = await service.getById(99999);
    assert.strictEqual(result, null);
  });
});
